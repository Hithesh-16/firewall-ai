/**
 * Policy Enforcement Middleware
 *
 * Fastify preHandler hook that runs the scanner pipeline and enforces
 * policy decisions. Extracts enforcement logic from ai.route.ts into
 * reusable middleware.
 *
 * SOLID:
 * - SRP: Only scans and enforces. No routing, no forwarding.
 * - DIP: Depends on evaluatePolicy() interface, not on route logic.
 */

import type { FastifyRequest, FastifyReply } from "fastify";
import { loadPolicyConfig } from "../config";
import { evaluatePolicy } from "../policy/policyEngine";
import { mergeProjectPolicy } from "../policy/projectPolicy";
import { resolveEffectivePolicy } from "../policy/policyChain";
import { scanSecrets } from "../scanner/secretScanner";
import { scanPII } from "../scanner/piiScanner";
import { scanEntropy } from "../scanner/entropyScanner";
import { adjustSeverity } from "../scanner/contextScanner";
import { scanPromptInjection } from "../scanner/promptInjectionScanner";
import { validateFilePaths } from "../scope/fileScope";
import { getEffectiveFilePolicy } from "../policy/fileRestrictionService";
import { mergeMessagesToText } from "../schemas/chatSchemas";
import type {
  PolicyDecision,
  SecretScanResult,
  PiiScanResult,
  ChatCompletionRequest,
} from "../types";

// ── File path extraction from message content ─────────────────────────

const FILE_PATH_PATTERNS = [
  /^\/\/\s*File:\s*(.+)$/gm,                       // // File: /path/to/file
  /^#\s*File:\s*(.+)$/gm,                           // # File: /path/to/file
  /```\w*\s+(\S+\.\w{1,10})\s*\n/g,                 // ```ts src/index.ts
  /^---\s*(\S+\.\w{1,10})\s*---$/gm,               // --- config.json ---
  /^\+\+\+\s+[ab]\/(.+)$/gm,                       // +++ b/src/file.ts (diff format)
  /^diff --git a\/(.+)\s+b\//gm,                    // diff --git a/file b/file
];

/**
 * Extracts file paths mentioned in message content as a fallback
 * when metadata.filePaths is not provided by the client.
 * This prevents bypass by omitting file paths from metadata.
 */
function extractFilePathsFromMessages(
  messages: Array<{ content: string | unknown }>
): string[] {
  const paths = new Set<string>();

  for (const msg of messages) {
    const text = typeof msg.content === "string" ? msg.content : "";
    for (const pattern of FILE_PATH_PATTERNS) {
      // Reset regex lastIndex for global patterns
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(text)) !== null) {
        const path = match[1]?.trim();
        if (path && path.length > 1 && path.length < 500) {
          paths.add(path);
        }
      }
    }
  }

  return Array.from(paths);
}

// ── Scan Context (attached to request for downstream use) ─────────────

export interface ScanContext {
  decision: PolicyDecision;
  secretResult: SecretScanResult;
  piiResult: PiiScanResult;
  entropyCount: number;
  rawText: string;
  redactionRequired: boolean;
  contextReasons: string[];
}

// Augment Fastify request type
declare module "fastify" {
  interface FastifyRequest {
    scanContext?: ScanContext;
  }
}

// ── Middleware Factory ─────────────────────────────────────────────────

interface PolicyEnforcerOptions {
  /** Paths to skip enforcement on (e.g., /health) */
  skipPaths?: string[];
}

/**
 * Creates a Fastify preHandler hook that runs the full scanner pipeline
 * and enforces BLOCK/REDACT/ALLOW decisions.
 *
 * - BLOCK → 403 response, request stops
 * - REQUIRE_APPROVAL → treated as BLOCK until Phase 3 wires approval service
 * - REDACT → marks scanContext.redactionRequired for downstream
 * - ALLOW → pass-through
 * - Scanner failure → 503 + Retry-After (default-deny)
 */
export function createPolicyEnforcerHook(options?: PolicyEnforcerOptions) {
  const skipPaths = new Set(options?.skipPaths ?? []);

  return async function policyEnforcerHook(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    const url = request.url.split("?")[0];
    if (skipPaths.has(url)) return;

    const body = request.body as
      | (ChatCompletionRequest & { metadata?: { projectRoot?: string; filePaths?: string[] } })
      | undefined;

    if (!body?.messages) return;

    try {
      // ── Load policy (full inheritance chain: global → org → team → project) ──
      const authCtxForPolicy = request.authContext;
      const policy = resolveEffectivePolicy(
        authCtxForPolicy?.user.orgId ?? null,
        null, // teamId resolved from user context when team_members lookup is available
        body.metadata?.projectRoot
      );

      // ── Scanner pipeline ─────────────────────────────────────
      const rawText = mergeMessagesToText(body.messages);

      // Merge explicit filePaths from metadata with paths extracted from content
      const explicitPaths = body.metadata?.filePaths ?? [];
      const extractedPaths = extractFilePathsFromMessages(body.messages);
      const allFilePaths = [...new Set([...explicitPaths, ...extractedPaths])];

      // Resolve effective file policy: global + org + team + user restrictions
      const authCtx = request.authContext;
      let effectiveFileScope = policy.file_scope;
      if (authCtx?.user.orgId) {
        const effective = getEffectiveFilePolicy(authCtx.user.orgId, null, authCtx.user.id);
        effectiveFileScope = {
          ...policy.file_scope,
          blocklist: [...new Set([...policy.file_scope.blocklist, ...effective.blocklist])],
          allowlist: effective.allowlist.length > 0 ? effective.allowlist : policy.file_scope.allowlist,
        };
      }

      const fileScopeResults = validateFilePaths(
        allFilePaths.length > 0 ? allFilePaths : undefined,
        effectiveFileScope
      );

      const secretResult = scanSecrets(rawText);
      const piiResult = scanPII(rawText);

      // Entropy detection: merge into secretResult
      const entropyMatches = scanEntropy(rawText);
      const entropyCount = entropyMatches.length;
      if (entropyCount > 0) {
        secretResult.secrets.push(...entropyMatches);
        secretResult.hasSecrets = secretResult.secrets.length > 0;
      }

      // Context-aware severity adjustments
      const contextReasons: string[] = [];
      const filePaths = body.metadata?.filePaths;

      for (const s of secretResult.secrets) {
        try {
          const adj = adjustSeverity(s.value, s.type, s.severity, filePaths);
          if (adj?.adjustedSeverity && adj.adjustedSeverity !== s.severity) {
            s.severity = adj.adjustedSeverity;
            contextReasons.push(`${adj.reason} (${s.type})`);
          }
        } catch {
          // Keep original severity — NEVER silently downgrade security
        }
      }

      for (const p of piiResult.pii) {
        try {
          const adj = adjustSeverity(p.value, p.type, p.severity, filePaths);
          if (adj?.adjustedSeverity && adj.adjustedSeverity !== p.severity) {
            p.severity = adj.adjustedSeverity;
            contextReasons.push(`${adj.reason} (${p.type})`);
          }
        } catch {
          // Keep original severity
        }
      }

      // ── Policy evaluation ────────────────────────────────────
      const decision = evaluatePolicy(secretResult, piiResult, policy, fileScopeResults);
      if (contextReasons.length > 0) {
        decision.reasons = [...new Set([...decision.reasons, ...contextReasons])];
      }

      // Prompt injection detection
      const piConfig = policy.prompt_injection;
      if (piConfig?.enabled !== false) {
        const piResult = scanPromptInjection(rawText, piConfig?.threshold ?? 60);
        if (piResult.isInjection) {
          decision.action = "BLOCK";
          decision.riskScore = Math.max(decision.riskScore, piResult.score);
          decision.reasons.push(`Prompt injection detected (score: ${piResult.score})`);
        }
      }

      // ── Enforcement ──────────────────────────────────────────

      // BLOCK: stop request immediately
      if (decision.action === "BLOCK") {
        reply.header("X-AF-Action", "BLOCK");
        reply.header("X-AF-Risk-Score", String(decision.riskScore));

        // Include restriction source levels if available
        const restrictionSources = authCtx?.user.orgId
          ? getEffectiveFilePolicy(authCtx.user.orgId, null, authCtx.user.id).sources
          : [];

        const errorPayload = decision.filesBlocked.length > 0
          ? {
              error: "Request blocked by file scope policy",
              code: "FILE_SCOPE_BLOCKED" as const,
              reasons: decision.reasons,
              files_blocked: decision.filesBlocked,
              restricted_by: restrictionSources.map((s) => s.level),
            }
          : {
              error: "Request blocked due to sensitive data",
              code: "FIREWALL_BLOCKED" as const,
              reasons: decision.reasons,
              risk_score: decision.riskScore,
            };

        return reply.status(403).send(errorPayload);
      }

      // REQUIRE_APPROVAL: call approval service, await human decision
      if (decision.action === "REQUIRE_APPROVAL") {
        try {
          const { requestApproval } = await import("../services/approvalService");
          const userId = (request as any).userId ?? null;
          const { decision: approvalDecision, source } = await requestApproval(
            userId,
            "chat_completion",
            body.model ?? "unknown",
            { riskScore: decision.riskScore, reasons: decision.reasons },
          );

          if (approvalDecision === "deny" || approvalDecision === "deny_always") {
            reply.header("X-AF-Action", "BLOCK");
            reply.header("X-AF-Risk-Score", String(decision.riskScore));

            return reply.status(403).send({
              error: source === "timeout"
                ? "Approval timed out — default deny"
                : "Denied by approval",
              code: "APPROVAL_DENIED" as const,
              reasons: decision.reasons,
              risk_score: decision.riskScore,
            });
          }
          // allow_once or allow_always → proceed (rule already persisted by approvalService)
        } catch {
          // Approval service unavailable — default deny (OWASP)
          reply.header("X-AF-Action", "BLOCK");
          return reply.status(403).send({
            error: "Approval service unavailable — default deny",
            code: "APPROVAL_UNAVAILABLE" as const,
            reasons: decision.reasons,
            risk_score: decision.riskScore,
          });
        }
      }

      // ALLOW or REDACT: attach scan context for downstream use
      request.scanContext = {
        decision,
        secretResult,
        piiResult,
        entropyCount,
        rawText,
        redactionRequired: decision.action === "REDACT",
        contextReasons,
      };
    } catch (err: unknown) {
      // Scanner failure → 503 default-deny (not 500, not pass-through)
      const message = err instanceof Error ? err.message : "Scanner pipeline failure";
      request.log.error({ err }, "Policy enforcer scanner failure — default deny");

      reply.header("Retry-After", "1");
      return reply.status(503).send({
        error: "Security scanner temporarily unavailable",
        code: "SCANNER_FAILURE" as const,
        detail: message,
      });
    }
  };
}
