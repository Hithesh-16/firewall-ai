/**
 * MCP Scan Pipeline
 *
 * Runs the full scanner pipeline on arbitrary text (tool inputs or outputs).
 * Reuses @ai-firewall/scanner — no new scanning logic.
 *
 * SOLID:
 * - SRP: Only scans text and returns results. No logging, no routing, no HTTP.
 * - OCP: New scanners added to @ai-firewall/scanner are automatically included.
 * - DIP: Depends on scanner interfaces from the shared package, not proxy internals.
 */

import {
  scanSecrets,
  scanPII,
  scanEntropy,
  scanPromptInjection,
  normalizeUnicode,
  type SecretScanResult,
  type PiiScanResult,
  type SecretMatch,
  type ScanPipelineResult,
} from "@ai-firewall/scanner";

// ── Types ──────────────────────────────────────────────────────────────────

export interface McpScanOptions {
  /** Direction of the data flow (for audit context) */
  direction: "input" | "output";
  /** Prompt injection threshold (default: 60) */
  injectionThreshold?: number;
  /** Whether to include redacted text in result */
  includeRedacted?: boolean;
}

export interface McpScanResult extends ScanPipelineResult {
  /** Direction scanned */
  direction: "input" | "output";
  /** Redacted text (if requested and action is REDACT) */
  redactedText?: string;
  /** Duration of the scan in ms */
  scanTimeMs: number;
}

// ── Risk Score Calculation ─────────────────────────────────────────────────

/**
 * Compute weighted risk score from scan results.
 * NOTE: MCP weights are INTENTIONALLY stricter than policyEngine.ts (high=25 vs 20).
 * MCP tool outputs are less trusted — secrets in tool responses are higher risk
 * than secrets in user prompts (which the user typed intentionally).
 */
function computeRiskScore(
  secrets: SecretScanResult,
  pii: PiiScanResult,
  entropyCount: number,
  injectionScore: number
): number {
  let score = 0;

  for (const s of secrets.secrets) {
    switch (s.severity) {
      case "critical": score += 40; break;
      case "high": score += 25; break;
      case "medium": score += 10; break;
    }
  }

  for (const p of pii.pii) {
    switch (p.severity) {
      case "critical": score += 30; break;
      case "high": score += 20; break;
      case "medium": score += 8; break;
    }
  }

  score += entropyCount * 15;
  score += injectionScore;

  return Math.min(score, 100);
}

/**
 * Determine action from risk score.
 * Simplified version — proxy's policyEngine uses policy rules for full decision.
 */
function determineAction(
  riskScore: number,
  hasCritical: boolean
): "ALLOW" | "BLOCK" | "REDACT" {
  if (hasCritical || riskScore >= 70) return "BLOCK";
  if (riskScore >= 30) return "REDACT";
  return "ALLOW";
}

// ── Core Scan Function ─────────────────────────────────────────────────────

/**
 * Run the full scanner pipeline on text.
 * Used for both MCP tool inputs and outputs.
 *
 * @param text - Text to scan (serialized tool arguments or tool response)
 * @param options - Scan configuration
 * @returns Scan results with action, risk score, and findings
 */
export function scanMcpContent(
  text: string,
  options: McpScanOptions
): McpScanResult {
  const startTime = Date.now();

  // Unicode normalization: strip confusables before scanning (ASI04 defense)
  const normResult = normalizeUnicode(text);
  const normalizedText = normResult.normalizedText;

  // Run all scanners on normalized text
  const secretResult = scanSecrets(normalizedText);
  const piiResult = scanPII(normalizedText);
  const entropyMatches = scanEntropy(normalizedText);

  // Merge entropy into secrets (same as ai.route.ts pattern)
  if (entropyMatches.length > 0) {
    secretResult.secrets.push(...entropyMatches);
    secretResult.hasSecrets = secretResult.secrets.length > 0;
  }

  // Prompt injection (primarily for inputs, but also check outputs for indirect injection)
  const piResult = scanPromptInjection(
    normalizedText,
    options.injectionThreshold ?? 60
  );

  // Compute risk
  const riskScore = computeRiskScore(
    secretResult,
    piiResult,
    entropyMatches.length,
    piResult.isInjection ? piResult.score : 0
  );

  const hasCritical = secretResult.secrets.some(
    (s) => s.severity === "critical"
  );
  const action = determineAction(riskScore, hasCritical);

  // Collect reasons
  const reasons: string[] = [];
  if (secretResult.hasSecrets) {
    const types = [...new Set(secretResult.secrets.map((s) => s.type))];
    reasons.push(`Secrets detected: ${types.join(", ")}`);
  }
  if (piiResult.hasPII) {
    const types = [...new Set(piiResult.pii.map((p) => p.type))];
    reasons.push(`PII detected: ${types.join(", ")}`);
  }
  if (piResult.isInjection) {
    reasons.push(`Prompt injection (score: ${piResult.score})`);
  }
  if (normResult.hasAnomalies) {
    reasons.push(`Unicode anomalies: ${normResult.findings.length} findings`);
  }

  // Optional redaction
  let redactedText: string | undefined;
  if (options.includeRedacted && action === "REDACT") {
    redactedText = redactText(text, secretResult.secrets, piiResult.pii);
  }

  return {
    action,
    riskScore,
    secretsFound: secretResult.secrets.length,
    piiFound: piiResult.pii.length,
    entropyFound: entropyMatches.length,
    injectionScore: piResult.score,
    isInjection: piResult.isInjection,
    reasons,
    secrets: secretResult.secrets,
    pii: piiResult.pii,
    direction: options.direction,
    redactedText,
    scanTimeMs: Date.now() - startTime,
  };
}

// ── Inline Redaction ───────────────────────────────────────────────────────

function redactText(
  text: string,
  secrets: SecretMatch[],
  pii: Array<{ type: string; value: string }>
): string {
  let redacted = text;
  const allMatches = [
    ...secrets.map((s) => ({ type: s.type, value: s.value })),
    ...pii.map((p) => ({ type: p.type, value: p.value })),
  ];

  // Sort by value length descending to avoid partial replacements
  allMatches.sort((a, b) => b.value.length - a.value.length);

  for (const match of allMatches) {
    if (!match.value) continue;
    const token = `[REDACTED_${match.type.replace(/[^A-Z0-9_]/g, "_")}]`;
    redacted = redacted.split(match.value).join(token);
  }

  return redacted;
}
