/**
 * Pre-flight Scan Route
 *
 * POST /api/scan — Scans chat messages for secrets/PII/injection BEFORE
 * they are sent to the LLM. Called by core/llm/firewallScan.ts.
 *
 * Returns:
 * - action: ALLOW/BLOCK/REDACT
 * - sanitizedMessages (if REDACT)
 * - X-AF-* headers (for extractScanHeaders in fetch layer)
 *
 * This is the CRITICAL path that makes the toast notifications work:
 *   firewallPreflightScan() → POST /api/scan → X-AF-* headers
 *   → extractScanHeaders() → onScanResult listeners → GUI banner + toast
 */

import { FastifyInstance } from "fastify";
import { z } from "zod";
import { loadPolicyConfig } from "../config";
import { evaluatePolicy } from "../policy/policyEngine";
import { redact } from "../redactor/redactor";
import { scanPII } from "../scanner/piiScanner";
import { scanSecrets } from "../scanner/secretScanner";
import { scanEntropy } from "../scanner/entropyScanner";
import { adjustSeverity } from "../scanner/contextScanner";
import { scanPromptInjection } from "../scanner/promptInjectionScanner";

const scanSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.string(),
        content: z.string(),
      }),
    )
    .min(1),
  model: z.string().optional(),
});

export async function registerPreflightScanRoute(
  app: FastifyInstance,
): Promise<void> {
  app.post("/api/scan", async (request, reply) => {
    const parsed = scanSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "Invalid payload", details: parsed.error.flatten() });
    }

    const { messages, model } = parsed.data;
    const policy = loadPolicyConfig();
    const rawText = messages.map((m) => m.content).join("\n");

    // Run full scanner pipeline
    const secretResult = scanSecrets(rawText);
    const piiResult = scanPII(rawText);

    const entropyMatches = scanEntropy(rawText);
    if (entropyMatches.length > 0) {
      secretResult.secrets.push(...entropyMatches);
      secretResult.hasSecrets = secretResult.secrets.length > 0;
    }

    // Context adjustments
    for (const s of secretResult.secrets) {
      try {
        const adj = adjustSeverity(s.value, s.type, s.severity, undefined);
        if (adj?.adjustedSeverity && adj.adjustedSeverity !== s.severity) {
          s.severity = adj.adjustedSeverity;
        }
      } catch (e) {
        request.log.warn(
          { err: e, type: s.type },
          "secret severity adjustment failed",
        );
      }
    }
    for (const p of piiResult.pii) {
      try {
        const adj = adjustSeverity(p.value, p.type, p.severity, undefined);
        if (adj?.adjustedSeverity && adj.adjustedSeverity !== p.severity) {
          p.severity = adj.adjustedSeverity;
        }
      } catch (e) {
        request.log.warn(
          { err: e, type: p.type },
          "pii severity adjustment failed",
        );
      }
    }

    const decision = evaluatePolicy(secretResult, piiResult, policy);

    // Prompt injection
    const piConfig = policy.prompt_injection;
    if (piConfig?.enabled !== false) {
      const piResult = scanPromptInjection(rawText, piConfig?.threshold ?? 60);
      if (piResult.isInjection) {
        decision.action = "BLOCK";
        decision.riskScore = Math.max(decision.riskScore, piResult.score);
        decision.reasons.push(
          `Prompt injection detected (score: ${piResult.score})`,
        );
      }
    }

    // Set X-AF-* headers — these are what extractScanHeaders() reads
    // to fire the onScanResult listeners → GUI banner + VS Code toast
    reply.header("X-AF-Action", decision.action);
    reply.header("X-AF-Risk-Score", String(decision.riskScore));
    reply.header("X-AF-Secrets-Count", String(secretResult.secrets.length));
    reply.header("X-AF-PII-Count", String(piiResult.pii.length));
    reply.header("X-AF-Entropy-Count", String(entropyMatches.length));

    const redactedTypes = [
      ...secretResult.secrets.map((s) => s.type),
      ...piiResult.pii.map((p) => p.type),
    ];
    if (redactedTypes.length > 0) {
      reply.header("X-AF-Redacted-Types", redactedTypes.join(","));
    }

    // Build findings array with masked values for display
    const findings = [
      ...secretResult.secrets.map((s) => ({
        type: s.type,
        severity: s.severity,
        category: "secret" as const,
        maskedValue: maskValue(s.value, s.type),
      })),
      ...piiResult.pii.map((p) => ({
        type: p.type,
        severity: p.severity,
        category: "pii" as const,
        maskedValue: maskValue(p.value, p.type),
      })),
    ];

    // Encode findings in header for extractScanHeaders
    if (findings.length > 0) {
      // Compact JSON array: [{t,s,c,v},...] to fit in header
      const findingsHeader = JSON.stringify(
        findings.slice(0, 20).map((f) => ({
          t: f.type,
          s: f.severity,
          c: f.category,
          v: f.maskedValue,
        })),
      );
      reply.header("X-AF-Findings", findingsHeader);
    }

    // BLOCK → 403
    if (decision.action === "BLOCK") {
      return reply.status(403).send({
        action: "BLOCK",
        riskScore: decision.riskScore,
        reasons: decision.reasons,
        secretsFound: secretResult.secrets.length,
        piiFound: piiResult.pii.length,
        findings,
      });
    }

    // REDACT → sanitize messages
    let sanitizedMessages = messages;
    if (decision.action === "REDACT") {
      const allMatches = [
        ...secretResult.secrets.map((s) => ({ type: s.type, value: s.value })),
        ...piiResult.pii.map((p) => ({ type: p.type, value: p.value })),
      ];
      sanitizedMessages = messages.map((m) => ({
        ...m,
        content: redact(m.content, allMatches),
      }));
    }

    return {
      action: decision.action,
      riskScore: decision.riskScore,
      reasons: decision.reasons,
      secretsFound: secretResult.secrets.length,
      piiFound: piiResult.pii.length,
      entropyFound: entropyMatches.length,
      findings,
      sanitizedMessages:
        decision.action === "REDACT" ? sanitizedMessages : undefined,
    };
  });
}

/**
 * Mask a detected value for safe display — show enough to identify
 * but never expose the full secret.
 */
function maskValue(value: string, type: string): string {
  if (!value || value.length <= 4) return "****";

  // For keys/tokens, show first 4 and last 2 chars
  if (
    type.includes("KEY") ||
    type.includes("TOKEN") ||
    type === "JWT" ||
    type === "BEARER_TOKEN"
  ) {
    return `${value.slice(0, 4)}${"*".repeat(Math.min(value.length - 6, 12))}${value.slice(-2)}`;
  }

  // For emails, mask the local part
  if (type === "EMAIL") {
    const atIndex = value.indexOf("@");
    if (atIndex > 1) {
      return `${value[0]}${"*".repeat(atIndex - 1)}${value.slice(atIndex)}`;
    }
  }

  // For phone/SSN/credit card, show last 4
  if (
    type === "PHONE" ||
    type === "SSN" ||
    type === "CREDIT_CARD" ||
    type === "AADHAAR" ||
    type === "PAN"
  ) {
    return `${"*".repeat(value.length - 4)}${value.slice(-4)}`;
  }

  // Default: show first 3, mask rest
  return `${value.slice(0, 3)}${"*".repeat(Math.min(value.length - 3, 12))}`;
}
