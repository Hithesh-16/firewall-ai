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
  messages: z.array(
    z.object({
      role: z.string(),
      content: z.string(),
    })
  ).min(1),
  model: z.string().optional(),
});

export async function registerPreflightScanRoute(
  app: FastifyInstance
): Promise<void> {
  app.post("/api/scan", async (request, reply) => {
    const parsed = scanSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
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
      } catch (e) { request.log.warn({ err: e, type: s.type }, "secret severity adjustment failed"); }
    }
    for (const p of piiResult.pii) {
      try {
        const adj = adjustSeverity(p.value, p.type, p.severity, undefined);
        if (adj?.adjustedSeverity && adj.adjustedSeverity !== p.severity) {
          p.severity = adj.adjustedSeverity;
        }
      } catch (e) { request.log.warn({ err: e, type: p.type }, "pii severity adjustment failed"); }
    }

    const decision = evaluatePolicy(secretResult, piiResult, policy);

    // Prompt injection
    const piConfig = policy.prompt_injection;
    if (piConfig?.enabled !== false) {
      const piResult = scanPromptInjection(rawText, piConfig?.threshold ?? 60);
      if (piResult.isInjection) {
        decision.action = "BLOCK";
        decision.riskScore = Math.max(decision.riskScore, piResult.score);
        decision.reasons.push(`Prompt injection detected (score: ${piResult.score})`);
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

    // BLOCK → 403
    if (decision.action === "BLOCK") {
      return reply.status(403).send({
        action: "BLOCK",
        riskScore: decision.riskScore,
        reasons: decision.reasons,
        secretsFound: secretResult.secrets.length,
        piiFound: piiResult.pii.length,
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
      sanitizedMessages: decision.action === "REDACT" ? sanitizedMessages : undefined,
    };
  });
}
