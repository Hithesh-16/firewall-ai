/**
 * File Scan Service
 *
 * Scans individual files through the full scanner pipeline.
 * Reuses ALL existing scanners — no new scanning logic.
 *
 * Design:
 * - Single Responsibility: Orchestrates scanners for file content
 * - Open/Closed: New scanners added to the pipeline without changing this file
 * - Dependency Inversion: Depends on scanner interfaces, not implementations
 * - "Scan, don't manage": Reads files, scans content, returns results. No storage.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { scanSecrets } from "./secretScanner";
import { scanPII } from "./piiScanner";
import { scanEntropy } from "./entropyScanner";
import { adjustSeverity } from "./contextScanner";
import { scanPromptInjection } from "./promptInjectionScanner";
import { evaluatePolicy } from "../policy/policyEngine";
import { redact } from "../redactor/redactor";
import { checkFileScope } from "../scope/fileScope";
import { buildLineStarts, locatePosition, maskValue } from "./findingLocator";
import type { FileScanResult, PolicyConfig, PolicyAction } from "../types";

// ── Types ──────────────────────────────────────────────────────────────────

export interface ScanFileOptions {
  /** Include redacted content in the result (default: false) */
  includeRedacted?: boolean;
}

export interface ScanFileError {
  filePath: string;
  error: string;
  code:
    | "FILE_NOT_FOUND"
    | "FILE_TOO_LARGE"
    | "FILE_BLOCKED"
    | "FILE_READ_ERROR";
}

// ── Core Scan Function ─────────────────────────────────────────────────────

/**
 * Scan a single file through the full scanner pipeline.
 *
 * Pipeline: fileScope check → read file → scanSecrets → scanPII → scanEntropy
 *           → adjustSeverity → scanPromptInjection → evaluatePolicy → (optional) redact
 *
 * @returns FileScanResult on success, ScanFileError on failure
 */
export function scanFileContent(
  filePath: string,
  policy: PolicyConfig,
  options: ScanFileOptions = {},
): FileScanResult | ScanFileError {
  const startTime = Date.now();
  const absolutePath = path.resolve(filePath);

  // 1. File scope check (blocklist/allowlist)
  const scopeResult = checkFileScope(absolutePath, policy.file_scope);
  if (!scopeResult.allowed) {
    return {
      filePath: scopeResult.path,
      error: scopeResult.reason ?? "File blocked by scope policy",
      code: "FILE_BLOCKED",
    };
  }

  // 2. Check file exists and size
  let stats: fs.Stats;
  try {
    stats = fs.statSync(absolutePath);
  } catch {
    return {
      filePath,
      error: `File not found or not accessible: ${filePath}`,
      code: "FILE_NOT_FOUND",
    };
  }

  const maxSizeBytes = policy.file_scope.max_file_size_kb * 1024;
  if (stats.size > maxSizeBytes) {
    return {
      filePath,
      error: `File exceeds max size (${policy.file_scope.max_file_size_kb}KB): ${(stats.size / 1024).toFixed(1)}KB`,
      code: "FILE_TOO_LARGE",
    };
  }

  // 3. Read file content
  let content: string;
  try {
    content = fs.readFileSync(absolutePath, "utf-8");
  } catch (err) {
    return {
      filePath,
      error: `Failed to read file: ${err instanceof Error ? err.message : "unknown error"}`,
      code: "FILE_READ_ERROR",
    };
  }

  // 4. Compute content hash (SHA-256 for cache key)
  const fileHash = crypto.createHash("sha256").update(content).digest("hex");

  // 5. Run scanner pipeline
  const secretResult = scanSecrets(content);
  const piiResult = scanPII(content);

  // Entropy detection
  const entropyMatches = scanEntropy(content);
  if (entropyMatches.length > 0) {
    secretResult.secrets.push(...entropyMatches);
    secretResult.hasSecrets = secretResult.secrets.length > 0;
  }

  // Context-aware severity adjustments
  for (const s of secretResult.secrets) {
    try {
      const adj = adjustSeverity(s.value, s.type, s.severity, [filePath]);
      if (adj?.adjustedSeverity && adj.adjustedSeverity !== s.severity) {
        s.severity = adj.adjustedSeverity;
      }
    } catch {
      // ignore adjustment errors
    }
  }
  for (const p of piiResult.pii) {
    try {
      const adj = adjustSeverity(p.value, p.type, p.severity, [filePath]);
      if (adj?.adjustedSeverity && adj.adjustedSeverity !== p.severity) {
        p.severity = adj.adjustedSeverity;
      }
    } catch {
      // ignore
    }
  }

  // 6. Policy evaluation
  const decision = evaluatePolicy(secretResult, piiResult, policy, []);

  // 7. Prompt injection check
  const piConfig = policy.prompt_injection;
  if (piConfig?.enabled !== false) {
    const piResult = scanPromptInjection(content, piConfig?.threshold ?? 60);
    if (piResult.isInjection) {
      decision.action = "BLOCK";
      decision.riskScore = Math.max(decision.riskScore, piResult.score);
      decision.reasons.push(
        `Prompt injection detected (score: ${piResult.score})`,
      );
    }
  }

  // For file scans, REQUIRE_APPROVAL is treated as BLOCK (no interactive prompt for file scans)
  const fileAction: "ALLOW" | "BLOCK" | "REDACT" =
    decision.action === "REQUIRE_APPROVAL" ? "BLOCK" : decision.action;

  // 8. Optional redaction
  let redactedContent: string | undefined;
  if (options.includeRedacted && fileAction === "REDACT") {
    const redactionInput = [
      ...secretResult.secrets.map((s) => ({ type: s.type, value: s.value })),
      ...piiResult.pii.map((p) => ({ type: p.type, value: p.value })),
    ];
    redactedContent = redact(content, redactionInput);
  }

  // Compute (line, column) for every finding from a single line-start
  // table. Mask raw values so they never cross the wire.
  const lineStarts = buildLineStarts(content);

  return {
    filePath,
    fileHash,
    fileSize: stats.size,
    action: fileAction,
    riskScore: decision.riskScore,
    reasons: decision.reasons,
    secretsFound: secretResult.secrets.length,
    piiFound: piiResult.pii.length,
    entropyFound: entropyMatches.length,
    secrets: secretResult.secrets.map((s) => {
      const loc = locatePosition(lineStarts, s.position);
      return {
        type: s.type,
        severity: s.severity,
        position: s.position,
        length: s.length,
        line: loc.line,
        column: loc.column,
        masked: maskValue(s.value, s.type),
      };
    }),
    pii: piiResult.pii.map((p) => {
      const loc = locatePosition(lineStarts, p.position);
      return {
        type: p.type,
        severity: p.severity,
        position: p.position,
        length: p.length,
        line: loc.line,
        column: loc.column,
        masked: maskValue(p.value, p.type),
      };
    }),
    redactedContent,
    cached: false,
    scanDurationMs: Date.now() - startTime,
  };
}

// ── Type Guard ─────────────────────────────────────────────────────────────

export function isScanError(
  result: FileScanResult | ScanFileError,
): result is ScanFileError {
  return "error" in result && "code" in result;
}
