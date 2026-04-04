/**
 * Rule File Scan Service
 *
 * Scans IDE rule files (.cursorrules, .continuerules, CLAUDE.md, etc.)
 * that are loaded as trusted system prompts. These files are a prime
 * attack vector (ASI04: Rules File Backdoor) because injections in them
 * execute with system-level privilege.
 *
 * Runs: Unicode normalization → prompt injection → secret scan.
 *
 * SOLID:
 * - SRP: Only scans rule file content and returns results.
 * - OCP: New rule file names added to KNOWN_RULE_FILES without logic changes.
 * - DIP: Depends on scanner interfaces from @ai-firewall/scanner.
 */

import fs from "node:fs";
import path from "node:path";
import {
  normalizeUnicode,
  scanPromptInjection,
  scanSecrets,
  scanPII,
} from "@ai-firewall/scanner";

// ── Types ──────────────────────────────────────────────────────────────────

export type RuleFileSource =
  | ".continuerules"
  | ".cursorrules"
  | ".windsurfrules"
  | "CLAUDE.md"
  | "AGENTS.md"
  | ".github/copilot-instructions.md"
  | ".aifirewall.md"
  | "custom";

export interface RuleFileScanRequest {
  filePath: string;
  content: string;
  source: RuleFileSource;
}

export interface RuleFileScanResult {
  filePath: string;
  source: RuleFileSource;
  action: "ALLOW" | "BLOCK" | "WARN";
  riskScore: number;
  injectionDetected: boolean;
  injectionScore: number;
  secretsFound: number;
  piiFound: number;
  unicodeAnomalies: number;
  reasons: string[];
  scanTimeMs: number;
}

// ── Known Rule Files ───────────────────────────────────────────────────────

export const KNOWN_RULE_FILES = [
  ".aifirewallrules",
  ".continuerules",
  ".cursorrules",
  ".windsurfrules",
  ".ai-firewall/rules",
  ".continue/rules",
  "CLAUDE.md",
  "AGENTS.md",
  ".github/copilot-instructions.md",
  ".aifirewall.md",
  ".ai-firewall.md",
];

// ── Core Scan Function ─────────────────────────────────────────────────────

/**
 * Scan a single rule file through the security pipeline.
 *
 * Uses stricter thresholds than normal chat scanning because rule files
 * become system prompts — injections here have maximum impact.
 */
export function scanRuleFile(
  request: RuleFileScanRequest,
  injectionThreshold = 40,
): RuleFileScanResult {
  const startTime = Date.now();
  const reasons: string[] = [];

  // Step 1: Unicode normalization (catches hidden chars, confusables)
  const normResult = normalizeUnicode(request.content);
  const normalizedText = normResult.normalizedText;
  if (normResult.hasAnomalies) {
    reasons.push(
      `Unicode anomalies: ${normResult.findings.length} (${[...new Set(normResult.findings.map((f) => f.type))].join(", ")})`,
    );
  }

  // Step 2: Prompt injection detection (stricter threshold for rule files)
  const piResult = scanPromptInjection(normalizedText, injectionThreshold);
  if (piResult.isInjection) {
    reasons.push(
      `Prompt injection detected (score: ${piResult.score}, patterns: ${piResult.matches.map((m) => m.pattern).join(", ")})`,
    );
  }

  // Step 3: Secret scan (rule files should never contain secrets)
  const secretResult = scanSecrets(normalizedText);
  if (secretResult.hasSecrets) {
    const types = [...new Set(secretResult.secrets.map((s) => s.type))];
    reasons.push(`Secrets found in rule file: ${types.join(", ")}`);
  }

  // Step 4: PII scan
  const piiResult = scanPII(normalizedText);
  if (piiResult.hasPII) {
    const types = [...new Set(piiResult.pii.map((p) => p.type))];
    reasons.push(`PII found in rule file: ${types.join(", ")}`);
  }

  // Risk scoring (stricter for rule files)
  let riskScore = 0;
  riskScore += piResult.score; // Direct injection score contribution
  for (const s of secretResult.secrets) {
    riskScore +=
      s.severity === "critical" ? 40 : s.severity === "high" ? 25 : 10;
  }
  riskScore += normResult.findings.length * 5; // Unicode anomalies add risk
  riskScore = Math.min(riskScore, 100);

  // Action determination
  const hasCriticalSecret = secretResult.secrets.some(
    (s) => s.severity === "critical",
  );
  let action: "ALLOW" | "BLOCK" | "WARN";
  if (piResult.isInjection || hasCriticalSecret || riskScore >= 60) {
    action = "BLOCK";
  } else if (riskScore >= 20) {
    action = "WARN";
  } else {
    action = "ALLOW";
  }

  return {
    filePath: request.filePath,
    source: request.source,
    action,
    riskScore,
    injectionDetected: piResult.isInjection,
    injectionScore: piResult.score,
    secretsFound: secretResult.secrets.length,
    piiFound: piiResult.pii.length,
    unicodeAnomalies: normResult.findings.length,
    reasons,
    scanTimeMs: Date.now() - startTime,
  };
}

// ── Batch Scan ─────────────────────────────────────────────────────────────

/**
 * Scan multiple rule files.
 */
export function scanRuleFiles(
  requests: RuleFileScanRequest[],
  injectionThreshold = 40,
): RuleFileScanResult[] {
  return requests.map((req) => scanRuleFile(req, injectionThreshold));
}

// ── Workspace Scanner ──────────────────────────────────────────────────────

/**
 * Detect file source type from filename.
 */
function detectSource(filename: string): RuleFileSource {
  const base = path.basename(filename);
  if (base === ".continuerules") return ".continuerules";
  if (base === ".cursorrules") return ".cursorrules";
  if (base === ".windsurfrules") return ".windsurfrules";
  if (base === "CLAUDE.md") return "CLAUDE.md";
  if (base === "AGENTS.md") return "AGENTS.md";
  if (filename.endsWith(".github/copilot-instructions.md"))
    return ".github/copilot-instructions.md";
  if (base === ".aifirewall.md" || base === ".ai-firewall.md")
    return ".aifirewall.md";
  return "custom";
}

/**
 * Scan all known rule files in a workspace directory.
 * Reads each file that exists and runs the scanner pipeline.
 *
 * Returns results only for files that exist.
 */
export function scanWorkspaceRuleFiles(
  directory: string,
  injectionThreshold = 40,
): RuleFileScanResult[] {
  const results: RuleFileScanResult[] = [];

  for (const rulePath of KNOWN_RULE_FILES) {
    const fullPath = path.resolve(directory, rulePath);
    try {
      if (!fs.existsSync(fullPath)) continue;
      const stat = fs.statSync(fullPath);
      if (!stat.isFile() || stat.size > 512 * 1024) continue; // Skip dirs and >512KB files

      const content = fs.readFileSync(fullPath, "utf-8");
      const result = scanRuleFile(
        { filePath: fullPath, content, source: detectSource(rulePath) },
        injectionThreshold,
      );
      results.push(result);
    } catch {
      // File read error — skip silently (don't block startup)
    }
  }

  return results;
}
