/**
 * CLI parallel to the core `ScanningIde` decorator.
 *
 * The CLI doesn't instantiate an `IDE` — its tools call `fs` APIs
 * directly. This shim wraps those calls with the same scan +
 * enforcement logic the decorator runs, keyed by the same
 * `ScanPurpose` enum so behaviour stays consistent across IDE and
 * CLI surfaces.
 *
 * SOLID:
 *   - SRP: only enforces the scan decision matrix for CLI reads.
 *   - DIP: depends on `scanFileViaProxy` + `FileBlockedByScanError`
 *     types from core — never imports tool-specific logic.
 *   - OCP: new purposes added to `ScanPurpose` slot in without
 *     changes here (the behaviour predicates live on the enum).
 */

import * as fs from "fs";
import {
  scanFileViaProxy,
  type FileScanDecision,
} from "core/util/fileScanProxy.js";
import {
  FileBlockedByScanError,
  type ScanReport,
} from "core/util/scanning/FileBlockedByScanError.js";
import {
  bypassesScan,
  type ScanPurpose,
} from "core/util/scanning/ScanPurpose.js";
import {
  getCachedDecision,
  setCachedDecision,
} from "core/util/scanning/scanDecisionCache.js";

// Keep these two lists in lock-step with the IDE-side decorator at
// `core/util/scanning/ScanningIde.ts` (FORCED_CONFIG_BASENAMES /
// FORCED_CONFIG_SUFFIXES). The CLI parallel was missing the suffix
// list — see SECURITY_HARDENING_PLAN.md finding CH3.
const FORCED_CONFIG_BASENAMES = new Set<string>([
  ".gitignore",
  ".ai-firewallignore",
  ".continueignore",
  "plugin.json",
  "policy.json",
]);

const FORCED_CONFIG_SUFFIXES = [
  "/mcpServers.json",
  "/.ai-firewall/config.yaml",
  "/.ai-firewall/policy.json",
  // Windows separator equivalents — the CLI runs there too.
  "\\mcpServers.json",
  "\\.ai-firewall\\config.yaml",
  "\\.ai-firewall\\policy.json",
];

function forcedConfigOverride(
  filePath: string,
  purpose: ScanPurpose,
): ScanPurpose {
  if (purpose === "raw") return purpose;
  const slash = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  const basename = slash >= 0 ? filePath.slice(slash + 1) : filePath;
  if (FORCED_CONFIG_BASENAMES.has(basename)) return "config";
  for (const suffix of FORCED_CONFIG_SUFFIXES) {
    if (filePath.endsWith(suffix)) return "config";
  }
  return purpose;
}

function toReport(filePath: string, decision: FileScanDecision): ScanReport {
  return {
    filePath,
    action: decision.action,
    riskScore: decision.riskScore,
    reasons: decision.reasons,
    findings: decision.findings ?? [],
  };
}

export interface ScanningReadResult {
  /** Content the caller should feed to the LLM / write back. */
  content: string;
  /**
   * Present when the scan produced non-trivial findings (REDACT,
   * BLOCK, or ALLOW with findings). CLI tools use this to prepend
   * a report banner to their output.
   */
  report?: ScanReport;
}

/**
 * Read a file through the central scanner at the requested purpose.
 *
 * Decision matrix mirrors the `ScanningIde` decorator:
 *   - `config` / `raw` → bypass, raw `fs.readFileSync`
 *   - `autocomplete`   → cache-only (fail-open on miss, raw content)
 *   - `indexing`       → proxy with short timeout, BLOCK → empty string
 *   - `llm` (default)  → proxy, BLOCK → throws `FileBlockedByScanError`
 */
export async function scanningReadFile(
  filePath: string,
  purpose: ScanPurpose = "llm",
): Promise<ScanningReadResult> {
  const effective = forcedConfigOverride(filePath, purpose);

  if (bypassesScan(effective)) {
    return { content: fs.readFileSync(filePath, "utf-8") };
  }

  // Cache lookup (keyed by path + mtime + purpose so a file edit
  // invalidates automatically).
  let mtimeMs = 0;
  try {
    mtimeMs = fs.statSync(filePath).mtimeMs;
  } catch {
    // If stat fails, let the fs.readFileSync below produce the
    // real error — we just skip caching.
  }

  const cached = getCachedDecision(filePath, mtimeMs, effective);
  let decision = cached;

  if (!decision) {
    if (effective === "autocomplete") {
      // Cache-only path: fail-open, no sync proxy call.
      return { content: fs.readFileSync(filePath, "utf-8") };
    }
    decision = await scanFileViaProxy(filePath, { purpose: effective });
    setCachedDecision(filePath, mtimeMs, effective, decision);
  }

  if (decision.action === "BLOCK") {
    const report = toReport(filePath, decision);
    if (effective === "llm") {
      throw new FileBlockedByScanError(report);
    }
    // indexing / autocomplete: skip silently.
    return { content: "" };
  }

  if (decision.action === "REDACT" && decision.redactedContent != null) {
    return {
      content: decision.redactedContent,
      report: toReport(filePath, decision),
    };
  }

  const content = fs.readFileSync(filePath, "utf-8");
  const report =
    (decision.findings ?? []).length > 0
      ? toReport(filePath, decision)
      : undefined;
  return { content, report };
}
