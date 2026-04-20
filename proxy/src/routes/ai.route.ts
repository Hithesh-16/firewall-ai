import crypto from "node:crypto";
import axios from "axios";
import { FastifyInstance } from "fastify";
import { loadPolicyConfig, isStrictLocal } from "../config";
import { consumeCredit } from "../gateway/creditService";
import {
  extractTokenUsage,
  formatAnthropicPayload,
  formatGeminiPayload,
  legacyFallback,
  normalizeAnthropicResponse,
  normalizeGeminiResponse,
  resolveGatewayRoute,
  resolveGatewayRouteForUser,
} from "../gateway/gatewayRouter";
import { recordUsage } from "../gateway/usageService";
import {
  callUpstreamWithRetry,
  mapUpstreamError,
} from "../gateway/upstreamCall";
import { countMessageTokens } from "../gateway/tokenCounter";
import { checkContextWindow } from "../gateway/contextWindow";
import { estimateCost } from "../gateway/costEstimator";
import { logRequest } from "../logger/logger";
import { mergeProjectPolicy } from "../policy/projectPolicy";
import { redact } from "../redactor/redactor";
import {
  formatOllamaPayload,
  normalizeOllamaResponse,
  resolveRoute,
  resolveRouteWithCost,
} from "../router/smartRouter";
import { evaluateModelPolicy } from "../policy/modelPolicy";
import { createPolicyEnforcerHook } from "../middleware/policyEnforcer";
import type { ScanContext } from "../middleware/policyEnforcer";
import { requireAuth } from "../auth/authMiddleware";
import { createRateLimitHook } from "../middleware/rateLimiter";
import { isProviderPrefixed, resolveModelId } from "../gateway/modelResolver";
import { ChatCompletionRequest, SecretMatch, PiiMatch } from "../types";
import {
  chatCompletionSchema,
  mergeMessagesToText,
} from "../schemas/chatSchemas";
import { getTeamsForUser } from "../services/teamService";
import {
  scanResponseText,
  extractCompletionText,
  replaceCompletionText,
  setResponseScanHeaders,
  createScanningTransform,
  type ResponseScanConfig,
} from "../middleware/responseScanner";
import { broadcastAll } from "../ws/wsManager";

function hashText(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

/** Broadcast a scan_result event to all connected WebSocket clients. */
function emitScanResult(
  action: "ALLOW" | "BLOCK" | "REDACT",
  riskScore: number,
  secretsFound: number,
  piiFound: number,
  entropyFound: number,
  model?: string,
): void {
  broadcastAll({
    type: "scan_result",
    payload: {
      action,
      riskScore,
      secretsFound,
      piiFound,
      entropyFound,
      model,
      timestamp: Date.now(),
    },
    timestamp: Date.now(),
  });
}

function isAnthropicProvider(slug: string): boolean {
  return slug.includes("anthropic") || slug.includes("claude");
}

function isGeminiProvider(slug: string): boolean {
  return slug.includes("google") || slug.includes("gemini");
}

/** Helper: set X-AF-* scan result headers on every response */
function setScanHeaders(
  reply: any,
  action: string,
  riskScore: number,
  secretResult: { secrets: Array<{ type: string }> },
  piiResult: { pii: Array<{ type: string }> },
  entropyCount: number,
  redactedTypes: string[] = [],
): void {
  reply.header("X-AF-Action", action);
  reply.header("X-AF-Risk-Score", String(riskScore));
  reply.header("X-AF-Secrets-Count", String(secretResult.secrets.length));
  reply.header("X-AF-PII-Count", String(piiResult.pii.length));
  reply.header("X-AF-Entropy-Count", String(entropyCount));
  if (redactedTypes.length > 0) {
    reply.header("X-AF-Redacted-Types", redactedTypes.join(","));
  }
}

/** Extract passthrough API key from client Authorization header */
function extractPassthroughKey(request: any): string | undefined {
  const authHeader = request.headers.authorization;
  if (!authHeader) return undefined;
  const token = authHeader.replace(/^Bearer\s+/i, "");
  // Only passthrough real provider keys (not afw_ firewall tokens)
  if (token.startsWith("afw_")) return undefined;
  return token;
}

export async function registerAiRoute(app: FastifyInstance): Promise<void> {
  app.post(
    "/v1/chat/completions",
    {
      preHandler: [
        requireAuth,
        createRateLimitHook(),
        createPolicyEnforcerHook(),
      ],
    },
    async (request, reply) => {
      const startedAt = Date.now();
      const parsed = chatCompletionSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "Invalid request payload",
          details: parsed.error.flatten(),
        });
      }

      // Zod validates strict types at boundary; cast to internal types for downstream compat
      const payload = parsed.data as unknown as ChatCompletionRequest & {
        metadata?: { projectRoot?: string };
      };

      // Phase I.I1 (SECURITY_HARDENING_PLAN.md) — resolve
      // `provider:model` identifiers (e.g. "openai:gpt-4o",
      // "anthropic:claude-sonnet-4-6") so clients can use the
      // deepagents-style unified format. If the model string is
      // prefixed with a known provider, split it; otherwise pass
      // through as a bare model name (existing behaviour).
      if (isProviderPrefixed(payload.model)) {
        const { provider, model } = resolveModelId(payload.model);
        payload.model = model;
        // Stash the resolved provider so the gateway router can
        // use it when looking up the provider entry in the vault.
        (payload as { _resolvedProvider?: string })._resolvedProvider =
          provider;
        reply.header("X-AF-Resolved-Provider", provider);
        reply.header("X-AF-Resolved-Model", model);
      }

      // Extract passthrough API key from client (for when no vault key is configured)
      const passthroughKey = extractPassthroughKey(request);

      // --- Scanner pipeline + enforcement handled by policyEnforcer middleware ---
      // BLOCK/REQUIRE_APPROVAL responses are returned by middleware before reaching here.
      // If we reach this point, decision is ALLOW or REDACT.
      const scanCtx = request.scanContext;
      if (!scanCtx) {
        return reply.status(503).send({
          error: "Security scanner unavailable",
          code: "SCANNER_MISSING",
          detail:
            "Policy enforcer middleware did not run. This is a server configuration error.",
        });
      }

      const policy = loadPolicyConfig();
      const mergedPolicy = mergeProjectPolicy(
        policy,
        payload.metadata?.projectRoot,
      );

      const { decision, secretResult, piiResult, entropyCount, rawText } =
        scanCtx;

      // --- Token Intelligence ---
      const tokenResult = await countMessageTokens(
        payload.messages,
        payload.model,
      );
      // Try the unified user_models table first (per-user model resolution).
      // Falls back to the legacy Phase 4 global providers table for
      // unauthenticated requests or installs that haven't migrated yet.
      const userId = request.authContext?.user?.id;
      const gatewayModel = userId
        ? resolveGatewayRouteForUser(userId, payload.model)
        : resolveGatewayRoute(payload.model);
      const maxCtx = gatewayModel?.model?.maxContextTokens ?? 0;
      const ctxCheck = await checkContextWindow(
        payload.messages,
        payload.model,
        maxCtx,
      );

      reply.header("X-AF-Input-Tokens", String(tokenResult.tokens));
      reply.header("X-AF-Token-Method", tokenResult.method);

      if (!ctxCheck.fits) {
        reply.header("X-AF-Context-Overflow", "true");
        reply.header("X-AF-Context-Tokens", String(ctxCheck.totalTokens));
        reply.header("X-AF-Context-Max", String(ctxCheck.maxContextTokens));
        if (ctxCheck.warningMessage) {
          reply.header("X-AF-Context-Warning", ctxCheck.warningMessage);
        }
      }

      const costEst = await estimateCost(payload.messages, payload.model);
      reply.header("X-AF-Estimated-Cost", String(costEst.totalEstimatedCost));

      const allDetectedTypes = [
        ...secretResult.secrets.map((s) => s.type),
        ...piiResult.pii.map((p) => p.type),
      ];

      // --- Gateway + Smart routing ---
      const gatewayRoute = gatewayModel;

      const costRoutingEnabled =
        mergedPolicy.smart_routing?.cost_routing?.enabled;
      const smartRoute = costRoutingEnabled
        ? resolveRouteWithCost(
            decision.riskScore,
            costEst.totalEstimatedCost,
            payload.model,
            mergedPolicy,
          )
        : resolveRoute(decision.riskScore, payload.model, mergedPolicy);
      const shouldRedact =
        decision.action === "REDACT" ||
        smartRoute.requiresRedaction ||
        (scanCtx?.redactionRequired ?? false);

      const redactionInput = [
        ...secretResult.secrets.map((s) => ({ type: s.type, value: s.value })),
        ...piiResult.pii.map((p) => ({ type: p.type, value: p.value })),
      ];

      let sanitizedText = rawText;
      let outboundMessages = payload.messages;

      if (shouldRedact && redactionInput.length > 0) {
        sanitizedText = redact(rawText, redactionInput);
        outboundMessages = payload.messages.map((message) => ({
          ...message,
          content:
            typeof message.content === "string"
              ? redact(message.content, redactionInput)
              : message.content, // multimodal content — text parts handled via rawText redaction
        }));
      }

      // Per-model policy enforcement
      const modelPolicies = policy.model_policies;
      if (modelPolicies) {
        const mpResult = evaluateModelPolicy(
          payload.model,
          payload.metadata?.filePaths,
          modelPolicies,
        );
        if (!mpResult.allowed) {
          return reply.status(403).send({
            error: mpResult.reason,
            code: "MODEL_POLICY_BLOCKED",
            blockedFiles: mpResult.blockedFiles,
          });
        }
      }

      // === GATEWAY PATH: provider is registered in Phase 4 system ===
      if (gatewayRoute) {
        if (!gatewayRoute.creditCheck.allowed) {
          return reply.status(429).send({
            error: "Credit limit exhausted",
            code: "CREDIT_EXHAUSTED",
            details: gatewayRoute.creditCheck.message,
            limit_type: gatewayRoute.creditCheck.limitType,
            remaining: 0,
          });
        }

        const providerSlug = gatewayRoute.provider.slug;

        // Resolve user identity for audit attribution (before try/catch so
        // it's available in both success and error paths)
        const authUserId = request.authContext?.user?.id;
        const authTokenTeamId = request.authContext?.token?.teamId;
        const resolvedTeamId =
          authTokenTeamId ??
          (authUserId ? getTeamsForUser(authUserId)[0]?.id : undefined);

        try {
          let requestPayload: unknown;
          let headers: Record<string, string> = {
            "Content-Type": "application/json",
          };
          let rawResponseData: Record<string, unknown>;
          let normalizedData: Record<string, unknown>;

          const wantsStream =
            (request.headers.accept as string | undefined)?.includes(
              "text/event-stream",
            ) || (request.body as any)?.stream === true;

          // Response scanning config for streaming (loaded once)
          const streamResponseConfig = (policy as Record<string, unknown>)
            .response_scanning as Partial<ResponseScanConfig> | undefined;

          // Helper: log + emit + set headers for streaming requests that
          // bypass the normal non-streaming logging path.
          const streamAction = shouldRedact ? "REDACT" : "ALLOW";
          const streamRedactedTypes = shouldRedact ? allDetectedTypes : [];
          // Capture non-null refs for the closure
          const gwModel = gatewayRoute.model.modelName;
          const gwProvider = gatewayRoute.provider.name;
          function logStreamRequest(): void {
            const elapsed = Date.now() - startedAt;
            setScanHeaders(
              reply,
              streamAction,
              decision.riskScore,
              secretResult,
              piiResult,
              entropyCount,
              streamRedactedTypes,
            );
            logRequest({
              timestamp: Date.now(),
              model: gwModel,
              provider: gwProvider,
              originalHash: hashText(rawText),
              sanitizedText,
              secretsFound: secretResult.secrets.length,
              piiFound: piiResult.pii.length,
              entropyFound: entropyCount,
              filesBlocked: 0,
              riskScore: decision.riskScore,
              action: streamAction,
              reasons: decision.reasons,
              responseTimeMs: elapsed,
              userId: authUserId,
              teamId: resolvedTeamId,
            });
            emitScanResult(
              streamAction,
              decision.riskScore,
              secretResult.secrets.length,
              piiResult.pii.length,
              entropyCount,
              gwModel,
            );
          }

          if (gatewayRoute.isLocal) {
            requestPayload = formatOllamaPayload(
              gatewayRoute.model.modelName,
              outboundMessages,
            );
            if (wantsStream) {
              logStreamRequest();
              const resp = await callUpstreamWithRetry(
                () =>
                  axios.post(gatewayRoute.providerUrl, requestPayload, {
                    headers,
                    responseType: "stream",
                    timeout: 0,
                  }),
                { provider: gatewayRoute.provider.name, logger: request.log },
              );
              reply.raw.writeHead(resp.status, resp.headers as any);
              if (streamResponseConfig?.enabled) {
                const scanTransform =
                  createScanningTransform(streamResponseConfig);
                (resp.data as any).pipe(scanTransform).pipe(reply.raw);
              } else {
                (resp.data as any).pipe(reply.raw);
              }
              return reply;
            } else {
              const resp = await callUpstreamWithRetry(
                () =>
                  axios.post(gatewayRoute.providerUrl, requestPayload, {
                    headers,
                    timeout: 120_000,
                  }),
                { provider: gatewayRoute.provider.name, logger: request.log },
              );
              rawResponseData = resp.data as Record<string, unknown>;
              normalizedData = normalizeOllamaResponse(
                rawResponseData,
              ) as Record<string, unknown>;
            }
          } else if (isAnthropicProvider(providerSlug)) {
            requestPayload = formatAnthropicPayload(
              gatewayRoute.model.modelName,
              outboundMessages,
            );
            headers["x-api-key"] = gatewayRoute.decryptedKey;
            headers["anthropic-version"] = "2023-06-01";
            if (wantsStream) {
              logStreamRequest();
              const resp = await callUpstreamWithRetry(
                () =>
                  axios.post(gatewayRoute.providerUrl, requestPayload, {
                    headers,
                    responseType: "stream",
                    timeout: 0,
                  }),
                { provider: gatewayRoute.provider.name, logger: request.log },
              );
              reply.raw.writeHead(resp.status, resp.headers as any);
              if (streamResponseConfig?.enabled) {
                const scanTransform =
                  createScanningTransform(streamResponseConfig);
                (resp.data as any).pipe(scanTransform).pipe(reply.raw);
              } else {
                (resp.data as any).pipe(reply.raw);
              }
              return reply;
            } else {
              const resp = await callUpstreamWithRetry(
                () =>
                  axios.post(gatewayRoute.providerUrl, requestPayload, {
                    headers,
                  }),
                { provider: gatewayRoute.provider.name, logger: request.log },
              );
              rawResponseData = resp.data as Record<string, unknown>;
              normalizedData = normalizeAnthropicResponse(
                rawResponseData,
              ) as Record<string, unknown>;
            }
          } else if (isGeminiProvider(providerSlug)) {
            requestPayload = formatGeminiPayload(outboundMessages);
            const url = `${gatewayRoute.providerUrl}?key=${gatewayRoute.decryptedKey}`;
            if (wantsStream) {
              logStreamRequest();
              const resp = await callUpstreamWithRetry(
                () =>
                  axios.post(url, requestPayload, {
                    headers,
                    responseType: "stream",
                    timeout: 0,
                  }),
                { provider: gatewayRoute.provider.name, logger: request.log },
              );
              reply.raw.writeHead(resp.status, resp.headers as any);
              if (streamResponseConfig?.enabled) {
                const scanTransform =
                  createScanningTransform(streamResponseConfig);
                (resp.data as any).pipe(scanTransform).pipe(reply.raw);
              } else {
                (resp.data as any).pipe(reply.raw);
              }
              return reply;
            } else {
              const resp = await callUpstreamWithRetry(
                () => axios.post(url, requestPayload, { headers }),
                { provider: gatewayRoute.provider.name, logger: request.log },
              );
              rawResponseData = resp.data as Record<string, unknown>;
              normalizedData = normalizeGeminiResponse(
                rawResponseData,
              ) as Record<string, unknown>;
            }
          } else {
            requestPayload = {
              model: gatewayRoute.model.modelName,
              messages: outboundMessages,
            };
            headers["Authorization"] = `Bearer ${gatewayRoute.decryptedKey}`;
            if (wantsStream) {
              logStreamRequest();
              const resp = await callUpstreamWithRetry(
                () =>
                  axios.post(gatewayRoute.providerUrl, requestPayload, {
                    headers,
                    responseType: "stream",
                    timeout: 0,
                  }),
                { provider: gatewayRoute.provider.name, logger: request.log },
              );
              reply.raw.writeHead(resp.status, resp.headers as any);
              if (streamResponseConfig?.enabled) {
                const scanTransform =
                  createScanningTransform(streamResponseConfig);
                (resp.data as any).pipe(scanTransform).pipe(reply.raw);
              } else {
                (resp.data as any).pipe(reply.raw);
              }
              return reply;
            } else {
              const resp = await callUpstreamWithRetry(
                () =>
                  axios.post(gatewayRoute.providerUrl, requestPayload, {
                    headers,
                  }),
                { provider: gatewayRoute.provider.name, logger: request.log },
              );
              rawResponseData = resp.data as Record<string, unknown>;
              normalizedData = rawResponseData;
            }
          }

          const elapsed = Date.now() - startedAt;
          const tokenUsage = extractTokenUsage(providerSlug, rawResponseData);
          const cost =
            (tokenUsage.inputTokens / 1000) *
              gatewayRoute.model.inputCostPer1k +
            (tokenUsage.outputTokens / 1000) *
              gatewayRoute.model.outputCostPer1k;

          consumeCredit(
            gatewayRoute.provider.id,
            1,
            "requests",
            gatewayRoute.model.id,
          );
          if (tokenUsage.totalTokens > 0) {
            consumeCredit(
              gatewayRoute.provider.id,
              tokenUsage.totalTokens,
              "tokens",
              gatewayRoute.model.id,
            );
          }

          recordUsage({
            logId: null,
            providerId: gatewayRoute.provider.id,
            modelName: gatewayRoute.model.modelName,
            inputTokens: tokenUsage.inputTokens,
            outputTokens: tokenUsage.outputTokens,
            totalTokens: tokenUsage.totalTokens,
            cost,
            timestamp: Date.now(),
            userId: authUserId,
            teamId: resolvedTeamId,
          });

          const gatewayAction = shouldRedact ? "REDACT" : "ALLOW";
          const redactedTypes = shouldRedact ? allDetectedTypes : [];

          logRequest({
            timestamp: Date.now(),
            model: gatewayRoute.model.modelName,
            provider: gatewayRoute.provider.name,
            originalHash: hashText(rawText),
            sanitizedText,
            secretsFound: secretResult.secrets.length,
            piiFound: piiResult.pii.length,
            entropyFound: entropyCount,
            filesBlocked: 0,
            riskScore: decision.riskScore,
            action: gatewayAction,
            reasons: decision.reasons,
            responseTimeMs: elapsed,
            userId: authUserId,
            teamId: resolvedTeamId,
          });
          emitScanResult(
            gatewayAction,
            decision.riskScore,
            secretResult.secrets.length,
            piiResult.pii.length,
            entropyCount,
            gatewayRoute.model.modelName,
          );

          setScanHeaders(
            reply,
            gatewayAction,
            decision.riskScore,
            secretResult,
            piiResult,
            entropyCount,
            redactedTypes,
          );
          reply.header("X-AF-Tokens-Used", String(tokenUsage.totalTokens));
          reply.header(
            "X-AF-Cost",
            String(Math.round(cost * 1_000_000) / 1_000_000),
          );

          // Response scanning (LLM05 defense) — scan LLM output for leaked secrets/PII
          const responseScanConfig = (policy as Record<string, unknown>)
            .response_scanning as Partial<ResponseScanConfig> | undefined;
          let responsePayload = normalizedData;
          if (responseScanConfig?.enabled) {
            const completionText = extractCompletionText(normalizedData);
            if (completionText) {
              const responseScan = scanResponseText(
                completionText,
                responseScanConfig,
              );
              setResponseScanHeaders(reply, responseScan);
              if (
                responseScan.action === "REDACT" &&
                responseScan.redactedText
              ) {
                responsePayload = replaceCompletionText(
                  normalizedData,
                  responseScan.redactedText,
                ) as Record<string, unknown>;
              }
            }
          }

          return {
            ...responsePayload,
            _firewall: {
              action: gatewayAction,
              secrets_found: secretResult.secrets.length,
              pii_found: piiResult.pii.length,
              entropy_found: entropyCount,
              files_blocked: 0,
              risk_score: decision.riskScore,
              routed_to: gatewayRoute.provider.name,
              model_used: gatewayRoute.model.modelName,
              tokens_used: tokenUsage.totalTokens,
              cost_estimate: Math.round(cost * 1_000_000) / 1_000_000,
              credit_remaining: gatewayRoute.creditCheck.remaining,
            },
          };
        } catch (error) {
          const mapped = mapUpstreamError(error, gatewayRoute.provider.name);

          request.log.error(
            {
              provider: mapped.provider,
              code: mapped.code,
              upstreamStatus: mapped.upstreamStatus,
              upstreamMessage: mapped.upstreamMessage,
            },
            "upstream provider call failed after retries",
          );

          logRequest({
            timestamp: Date.now(),
            model: gatewayRoute.model.modelName,
            provider: gatewayRoute.provider.name,
            originalHash: hashText(rawText),
            sanitizedText,
            secretsFound: secretResult.secrets.length,
            piiFound: piiResult.pii.length,
            entropyFound: entropyCount,
            filesBlocked: 0,
            riskScore: decision.riskScore,
            action: shouldRedact ? "REDACT" : "ALLOW",
            reasons: [`Provider error: ${mapped.code}: ${mapped.message}`],
            responseTimeMs: Date.now() - startedAt,
            userId: authUserId,
            teamId: resolvedTeamId,
          });
          emitScanResult(
            shouldRedact ? "REDACT" : "ALLOW",
            decision.riskScore,
            secretResult.secrets.length,
            piiResult.pii.length,
            entropyCount,
            gatewayRoute.model.modelName,
          );

          reply.header(
            "X-AF-Upstream-Status",
            String(mapped.upstreamStatus ?? ""),
          );
          reply.header("X-AF-Upstream-Code", mapped.code);
          return reply.status(mapped.status).send({
            error: {
              code: mapped.code,
              message: mapped.message,
              provider: mapped.provider,
              retryable: mapped.retryable,
              upstream_status: mapped.upstreamStatus,
            },
          });
        }
      }

      // STRICT_LOCAL: if no local gateway route was found and strict_local is on, block
      if (isStrictLocal()) {
        return reply.status(403).send({
          error:
            "STRICT_LOCAL mode is enabled — only local LLM providers are allowed. No local provider found for this model.",
          code: "STRICT_LOCAL_ENFORCED",
        });
      }

      // === LEGACY PATH: no gateway provider found — use Phase 1-2 env-based routing ===
      // Resolve user identity for audit attribution (same as gateway path)
      const legacyUserId = request.authContext?.user?.id;
      const legacyTokenTeamId = request.authContext?.token?.teamId;
      const legacyTeamId =
        legacyTokenTeamId ??
        (legacyUserId ? getTeamsForUser(legacyUserId)[0]?.id : undefined);

      const legacy = legacyFallback(
        payload.model,
        request.headers.authorization?.replace("Bearer ", ""),
      );

      if (smartRoute.isLocal) {
        try {
          const ollamaPayload = formatOllamaPayload(
            smartRoute.model,
            outboundMessages,
          );
          const ollamaResponse = await axios.post(
            smartRoute.providerUrl,
            ollamaPayload,
            {
              headers: { "Content-Type": "application/json" },
              timeout: 120_000,
            },
          );
          const providerData = normalizeOllamaResponse(
            ollamaResponse.data as Record<string, unknown>,
          ) as Record<string, unknown>;

          const elapsed = Date.now() - startedAt;
          const localAction = shouldRedact ? "REDACT" : "ALLOW";

          logRequest({
            timestamp: Date.now(),
            model: smartRoute.model,
            provider: "local",
            originalHash: hashText(rawText),
            sanitizedText,
            secretsFound: secretResult.secrets.length,
            piiFound: piiResult.pii.length,
            entropyFound: entropyCount,
            filesBlocked: 0,
            riskScore: decision.riskScore,
            action: localAction,
            reasons: decision.reasons,
            responseTimeMs: elapsed,
            userId: legacyUserId,
            teamId: legacyTeamId,
          });
          emitScanResult(
            localAction,
            decision.riskScore,
            secretResult.secrets.length,
            piiResult.pii.length,
            entropyCount,
            smartRoute.model,
          );

          setScanHeaders(
            reply,
            localAction,
            decision.riskScore,
            secretResult,
            piiResult,
            entropyCount,
            shouldRedact ? allDetectedTypes : [],
          );

          return {
            ...providerData,
            _firewall: {
              action: localAction,
              secrets_found: secretResult.secrets.length,
              pii_found: piiResult.pii.length,
              entropy_found: entropyCount,
              files_blocked: 0,
              risk_score: decision.riskScore,
              routed_to: "local_llm",
              model_used: smartRoute.model,
            },
          };
        } catch (error) {
          const message = axios.isAxiosError(error)
            ? (error.response?.data ?? error.message)
            : "Local LLM error";
          return reply
            .status(502)
            .send({ error: "Local LLM request failed", details: message });
        }
      }

      // Auth passthrough: use client's API key if no provider configured
      if (!legacy.apiKey && passthroughKey) {
        legacy.apiKey = passthroughKey;
      }

      if (!legacy.apiKey) {
        return reply.status(400).send({
          error:
            "No provider configured for this model. Register a provider via POST /api/providers, or set OPENAI_API_KEY in .env for legacy mode.",
        });
      }

      // Set scan headers before provider call so they appear even on 502 errors
      const preAction = shouldRedact ? "REDACT" : "ALLOW";
      setScanHeaders(
        reply,
        preAction,
        decision.riskScore,
        secretResult,
        piiResult,
        entropyCount,
        shouldRedact ? allDetectedTypes : [],
      );

      try {
        const cloudPayload = {
          model: smartRoute.model,
          messages: outboundMessages,
        };
        const cloudResponse = await axios.post(
          legacy.providerUrl,
          cloudPayload,
          {
            headers: {
              Authorization: `Bearer ${legacy.apiKey}`,
              "Content-Type": "application/json",
            },
          },
        );
        const providerData = cloudResponse.data as Record<string, unknown>;
        const elapsed = Date.now() - startedAt;
        const legacyAction = shouldRedact ? "REDACT" : "ALLOW";

        logRequest({
          timestamp: Date.now(),
          model: smartRoute.model,
          provider: "openai",
          originalHash: hashText(rawText),
          sanitizedText,
          secretsFound: secretResult.secrets.length,
          piiFound: piiResult.pii.length,
          entropyFound: entropyCount,
          filesBlocked: 0,
          riskScore: decision.riskScore,
          action: legacyAction,
          reasons: decision.reasons,
          responseTimeMs: elapsed,
          userId: legacyUserId,
          teamId: legacyTeamId,
        });
        emitScanResult(
          legacyAction,
          decision.riskScore,
          secretResult.secrets.length,
          piiResult.pii.length,
          entropyCount,
          smartRoute.model,
        );

        setScanHeaders(
          reply,
          legacyAction,
          decision.riskScore,
          secretResult,
          piiResult,
          entropyCount,
          shouldRedact ? allDetectedTypes : [],
        );

        return {
          ...providerData,
          _firewall: {
            action: legacyAction,
            secrets_found: secretResult.secrets.length,
            pii_found: piiResult.pii.length,
            entropy_found: entropyCount,
            files_blocked: 0,
            risk_score: decision.riskScore,
            routed_to: smartRoute.target,
            model_used: smartRoute.model,
          },
        };
      } catch (error) {
        const message = axios.isAxiosError(error)
          ? (error.response?.data ?? error.message)
          : "Unknown provider error";

        logRequest({
          timestamp: Date.now(),
          model: smartRoute.model,
          provider: "openai",
          originalHash: hashText(rawText),
          sanitizedText,
          secretsFound: secretResult.secrets.length,
          piiFound: piiResult.pii.length,
          entropyFound: entropyCount,
          filesBlocked: 0,
          riskScore: decision.riskScore,
          action: shouldRedact ? "REDACT" : "ALLOW",
          reasons: [`Provider error: ${JSON.stringify(message)}`],
          responseTimeMs: Date.now() - startedAt,
          userId: legacyUserId,
          teamId: legacyTeamId,
        });
        emitScanResult(
          shouldRedact ? "REDACT" : "ALLOW",
          decision.riskScore,
          secretResult.secrets.length,
          piiResult.pii.length,
          entropyCount,
          smartRoute.model,
        );

        return reply.status(502).send({
          error: "Upstream provider request failed",
          details: message,
        });
      }
    },
  );
}
