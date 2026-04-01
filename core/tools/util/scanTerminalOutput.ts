/**
 * Terminal Output Scanner
 *
 * Pure function that scans terminal command output for secrets and PII
 * before it flows into the LLM context window. Redacts detected items
 * with [REDACTED:TYPE] markers.
 *
 * SOLID:
 * - SRP: Only scans and redacts terminal output. No terminal execution logic.
 * - DIP: Depends on @ai-firewall/scanner interfaces, not on proxy.
 */

import { scanSecrets, scanPII } from "@ai-firewall/scanner";
import type { SecretMatch, PiiMatch } from "@ai-firewall/scanner";

export interface TerminalScanResult {
  /** Output with secrets/PII replaced by [REDACTED:TYPE] */
  scannedOutput: string;
  /** All detected findings */
  findings: Array<{ type: string; severity: string }>;
  /** Whether any redaction was applied */
  redacted: boolean;
}

/**
 * Scan terminal output for secrets and PII, redacting any findings.
 *
 * Replaces detected secrets/PII values with `[REDACTED:TYPE]` markers
 * so the LLM receives sanitized output. Sorts replacements by position
 * descending to preserve string indices during replacement.
 */
export function scanTerminalOutput(output: string): TerminalScanResult {
  if (!output || output.trim().length === 0) {
    return { scannedOutput: output, findings: [], redacted: false };
  }

  const secretResult = scanSecrets(output);
  const piiResult = scanPII(output);

  const findings = [
    ...secretResult.secrets.map((s) => ({ type: s.type, severity: s.severity })),
    ...piiResult.pii.map((p) => ({ type: p.type, severity: p.severity })),
  ];

  if (findings.length === 0) {
    return { scannedOutput: output, findings: [], redacted: false };
  }

  // Collect all matches with positions for replacement
  const replacements: Array<{ position: number; length: number; type: string }> = [
    ...secretResult.secrets.map((s: SecretMatch) => ({
      position: s.position,
      length: s.length,
      type: s.type,
    })),
    ...piiResult.pii.map((p: PiiMatch) => ({
      position: p.position,
      length: p.length,
      type: p.type,
    })),
  ];

  // Sort by position descending so replacements don't shift indices
  const sorted = [...replacements].sort((a, b) => b.position - a.position);

  let redacted = output;
  for (const r of sorted) {
    const before = redacted.slice(0, r.position);
    const after = redacted.slice(r.position + r.length);
    redacted = `${before}[REDACTED:${r.type}]${after}`;
  }

  return { scannedOutput: redacted, findings, redacted: true };
}
