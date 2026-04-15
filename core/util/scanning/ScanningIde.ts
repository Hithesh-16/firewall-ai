/**
 * ScanningIde — the central file-scanning chokepoint.
 *
 * Wraps any `IDE` implementation with a `Proxy` that intercepts
 * content-touching methods (`readFile`, `readRangeInFile`,
 * `getCurrentFile`) and routes them through the AI Firewall
 * scanner. Every other `IDE` method passes through unchanged.
 *
 * Callers tag their reads with a `ScanPurpose` via the parallel
 * `readFileWith` / `readRangeInFileWith` / `getCurrentFileWith`
 * methods. The plain `IDE` methods default to `"llm"` — the safe
 * default for any caller that forgets to classify itself.
 *
 * Design rules:
 *   - Backwards-compatible: structurally still an `IDE`, so every
 *     existing `readFile(uri)` caller keeps working with zero
 *     changes.
 *   - No network on the hot path: `"autocomplete"` only consults
 *     the local decision cache; the proxy is never called
 *     synchronously from that purpose.
 *   - Never breaks indexing: `"indexing"` BLOCKs return "" rather
 *     than throwing, so one bad file can't kill a batch.
 *   - Config loaders bypass entirely (defense-in-depth: a
 *     hardcoded allowlist below forces `"config"` for the
 *     firewall's own rule files regardless of caller tag).
 *
 * This decorator does NOT yet scan `writeFile` / `showVirtualFile`
 * contents — that requires a text-scan endpoint separate from
 * `/api/scan/file` (which reads from disk). Tracked as a follow-up.
 */

import type { IDE, Range } from "../../index.js";
import {
  scanFileViaProxy,
  type FileScanDecision,
  type FileScanFinding,
} from "../fileScanProxy.js";
import {
  bypassesScan,
  DEFAULT_SCAN_PURPOSE,
  shouldEmitReport,
  type ScanPurpose,
} from "./ScanPurpose.js";
import {
  FileBlockedByScanError,
  type ScanReport,
} from "./FileBlockedByScanError.js";
import { publishScanReport } from "./scanReportChannel.js";
import { getCachedDecision, setCachedDecision } from "./scanDecisionCache.js";
import { findingInRange, sliceByLines } from "./sliceByLines.js";

// ── Config-loader allowlist (forced `"config"` regardless of tag) ─────
//
// Defense-in-depth: these paths are read by the firewall's own
// config / rule / ignore loaders. Scanning them at `"llm"` could
// cause self-referential REDACTs that corrupt the loader. A caller
// that accidentally tags one of these as `"llm"` is overridden.

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
];

function forcedConfigOverride(uri: string, purpose: ScanPurpose): ScanPurpose {
  if (purpose === "raw") return purpose;
  const trimmed = uri.replace(/[?#].*$/, "");
  const slash = trimmed.lastIndexOf("/");
  const basename = slash >= 0 ? trimmed.slice(slash + 1) : trimmed;
  if (FORCED_CONFIG_BASENAMES.has(basename)) return "config";
  for (const suffix of FORCED_CONFIG_SUFFIXES) {
    if (trimmed.endsWith(suffix)) return "config";
  }
  return purpose;
}

// ── Augmented IDE shape (what the decorator exposes) ────────────────

/**
 * The extras the scanning decorator adds on top of the base IDE.
 * Non-interface methods — callers opt in via a structural cast
 * or the `readFileWith` helper below.
 */
export interface ScanningIdeExtras {
  readFileWith(fileUri: string, purpose: ScanPurpose): Promise<string>;
  readRangeInFileWith(
    fileUri: string,
    range: Range,
    purpose: ScanPurpose,
  ): Promise<string>;
  getCurrentFileWith(purpose: ScanPurpose): ReturnType<IDE["getCurrentFile"]>;
  /** Marker so tests / callers can detect a wrapped IDE. */
  readonly __scanningIde: true;
}

export type ScanningIde = IDE & ScanningIdeExtras;

export function isScanningIde(ide: IDE): ide is ScanningIde {
  return (ide as unknown as Partial<ScanningIdeExtras>).__scanningIde === true;
}

// ── Typed helpers for ergonomic call sites ──────────────────────────

/**
 * Read a file through the scanner at the given purpose. Works on
 * both a wrapped and a raw IDE (falls through to plain `readFile`
 * on a raw IDE — useful for unit tests with fake IDEs).
 */
export function readFileWith(
  ide: IDE,
  fileUri: string,
  purpose: ScanPurpose,
): Promise<string> {
  if (isScanningIde(ide)) return ide.readFileWith(fileUri, purpose);
  return ide.readFile(fileUri);
}

export function readRangeInFileWith(
  ide: IDE,
  fileUri: string,
  range: Range,
  purpose: ScanPurpose,
): Promise<string> {
  if (isScanningIde(ide))
    return ide.readRangeInFileWith(fileUri, range, purpose);
  return ide.readRangeInFile(fileUri, range);
}

// ── Core scan decision ──────────────────────────────────────────────

interface DecideOptions {
  readonly uri: string;
  readonly purpose: ScanPurpose;
  readonly projectRoot?: string;
  readonly fetchFn?: typeof fetch;
}

/**
 * Consult cache → proxy (unless cache-only purpose) → fail-open.
 * Does NOT enforce the action or throw. Returns the raw decision.
 */
async function decide(opts: DecideOptions): Promise<FileScanDecision | null> {
  const effectivePurpose = forcedConfigOverride(opts.uri, opts.purpose);
  if (bypassesScan(effectivePurpose)) return null;

  // Cache lookup (mtime not available without a stat; key purely
  // on path+purpose for now — good enough until we add an fs.stat
  // in the decorator. Autocomplete correctness is the guard rail
  // here: a stale cache entry for autocomplete just means a
  // keystroke reads slightly older content, which is harmless.)
  const cacheKeyMtime = 0;
  const cached = getCachedDecision(opts.uri, cacheKeyMtime, effectivePurpose);
  if (cached) return cached;

  // Autocomplete: cache-only. Never call the proxy synchronously.
  if (effectivePurpose === "autocomplete") return null;

  const decision = await scanFileViaProxy(opts.uri, {
    fetchFn: opts.fetchFn,
    projectRoot: opts.projectRoot,
    purpose: effectivePurpose,
  });
  setCachedDecision(opts.uri, cacheKeyMtime, effectivePurpose, decision);
  return decision;
}

function toReport(
  uri: string,
  decision: FileScanDecision,
  findings: readonly FileScanFinding[] = decision.findings ?? [],
): ScanReport {
  return {
    filePath: uri,
    action: decision.action,
    riskScore: decision.riskScore,
    reasons: decision.reasons,
    findings,
  };
}

function emitIfReportable(purpose: ScanPurpose, report: ScanReport): void {
  if (!shouldEmitReport(purpose)) return;
  // ALLOW with no findings is silent — nothing to tell the user.
  if (report.action === "ALLOW" && report.findings.length === 0) return;
  publishScanReport(report);
}

// ── Interception implementations ────────────────────────────────────

async function interceptReadFile(
  inner: IDE,
  fileUri: string,
  purpose: ScanPurpose,
): Promise<string> {
  const effective = forcedConfigOverride(fileUri, purpose);
  const decision = await decide({ uri: fileUri, purpose: effective });
  if (!decision) return inner.readFile(fileUri);

  if (decision.action === "BLOCK") {
    const report = toReport(fileUri, decision);
    if (effective === "llm") {
      emitIfReportable(effective, report);
      throw new FileBlockedByScanError(report);
    }
    // indexing / autocomplete: skip the file silently.
    return "";
  }

  if (decision.action === "REDACT" && decision.redactedContent != null) {
    const report = toReport(fileUri, decision);
    emitIfReportable(effective, report);
    return decision.redactedContent;
  }

  // ALLOW — maybe with informational findings.
  if ((decision.findings ?? []).length > 0) {
    emitIfReportable(effective, toReport(fileUri, decision));
  }
  return inner.readFile(fileUri);
}

async function interceptReadRangeInFile(
  inner: IDE,
  fileUri: string,
  range: Range,
  purpose: ScanPurpose,
): Promise<string> {
  const effective = forcedConfigOverride(fileUri, purpose);
  const decision = await decide({ uri: fileUri, purpose: effective });
  if (!decision) return inner.readRangeInFile(fileUri, range);

  // Filter findings to the requested line window so the report
  // card only mentions things the user actually saw.
  const rangeFindings = (decision.findings ?? []).filter((f) =>
    findingInRange(f, range.start.line, range.end.line),
  );

  if (decision.action === "BLOCK") {
    const report = toReport(fileUri, decision, rangeFindings);
    if (effective === "llm") {
      emitIfReportable(effective, report);
      throw new FileBlockedByScanError(report);
    }
    return "";
  }

  if (decision.action === "REDACT" && decision.redactedContent != null) {
    const report = toReport(fileUri, decision, rangeFindings);
    emitIfReportable(effective, report);
    return sliceByLines(
      decision.redactedContent,
      range.start.line,
      range.end.line,
    );
  }

  if (rangeFindings.length > 0) {
    emitIfReportable(effective, toReport(fileUri, decision, rangeFindings));
  }
  return inner.readRangeInFile(fileUri, range);
}

async function interceptGetCurrentFile(
  inner: IDE,
  purpose: ScanPurpose,
): Promise<Awaited<ReturnType<IDE["getCurrentFile"]>>> {
  const current = await inner.getCurrentFile();
  if (!current) return current;
  // Untitled files aren't on disk — nothing for the proxy's file
  // scanner to read. Pass them through unchanged; they'll get
  // scanned later when their content reaches an LLM request.
  if (current.isUntitled) return current;

  const effective = forcedConfigOverride(current.path, purpose);
  const decision = await decide({ uri: current.path, purpose: effective });
  if (!decision) return current;

  if (decision.action === "BLOCK") {
    const report = toReport(current.path, decision);
    if (effective === "llm") {
      emitIfReportable(effective, report);
      throw new FileBlockedByScanError(report);
    }
    return { ...current, contents: "" };
  }

  if (decision.action === "REDACT" && decision.redactedContent != null) {
    emitIfReportable(effective, toReport(current.path, decision));
    return { ...current, contents: decision.redactedContent };
  }

  if ((decision.findings ?? []).length > 0) {
    emitIfReportable(effective, toReport(current.path, decision));
  }
  return current;
}

// ── Proxy factory ──────────────────────────────────────────────────

/**
 * Wrap an `IDE` with the scanning chokepoint.
 *
 * Generic over the concrete IDE subclass so callers who pass a
 * richer type (e.g. `VsCodeIde` with its own `getRepo` / ide-
 * settings helpers) get that same type back — the `Proxy`
 * forwards every non-intercepted property via `Reflect.get`, so
 * the runtime behaviour matches the static shape.
 *
 * Installed exactly once at each IDE construction site:
 *   - `extensions/vscode/src/extension/VsCodeExtension.ts`
 *   - `binary/src/index.ts` (covers JetBrains + the binary)
 *
 * Everything else in the codebase keeps calling `ide.readFile(uri)`
 * unchanged and automatically gets the safe default (`"llm"`).
 */
export function wrapWithScanner<T extends IDE>(
  inner: T,
  defaultPurpose: ScanPurpose = DEFAULT_SCAN_PURPOSE,
): T & ScanningIdeExtras {
  const extras: ScanningIdeExtras = {
    __scanningIde: true,
    readFileWith(uri, purpose) {
      return interceptReadFile(inner, uri, purpose);
    },
    readRangeInFileWith(uri, range, purpose) {
      return interceptReadRangeInFile(inner, uri, range, purpose);
    },
    getCurrentFileWith(purpose) {
      return interceptGetCurrentFile(inner, purpose);
    },
  };

  return new Proxy(inner, {
    get(target, prop) {
      if (prop === "__scanningIde") return true;
      if (prop === "readFileWith") return extras.readFileWith;
      if (prop === "readRangeInFileWith") return extras.readRangeInFileWith;
      if (prop === "getCurrentFileWith") return extras.getCurrentFileWith;

      if (prop === "readFile") {
        return (uri: string) => interceptReadFile(target, uri, defaultPurpose);
      }
      if (prop === "readRangeInFile") {
        return (uri: string, range: Range) =>
          interceptReadRangeInFile(target, uri, range, defaultPurpose);
      }
      if (prop === "getCurrentFile") {
        return () => interceptGetCurrentFile(target, defaultPurpose);
      }

      // Pass-through for every other IDE method.
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
    has(target, prop) {
      if (
        prop === "__scanningIde" ||
        prop === "readFileWith" ||
        prop === "readRangeInFileWith" ||
        prop === "getCurrentFileWith"
      ) {
        return true;
      }
      return Reflect.has(target, prop);
    },
  }) as T & ScanningIdeExtras;
}
