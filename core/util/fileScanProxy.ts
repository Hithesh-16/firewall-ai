/**
 * Proxy-side file scanning utility.
 *
 * Calls the proxy's POST /api/scan/file endpoint before file reads
 * to enforce BLOCK/REDACT decisions from the security pipeline.
 * Fail-open: if the proxy is unreachable, returns ALLOW.
 *
 * Callers should now go through the central `ScanningIde` decorator
 * in `core/util/scanning/` rather than invoking this directly. The
 * decorator uses a `ScanPurpose` tag to decide whether to call this
 * helper synchronously, skip it (config/raw), or consult the local
 * decision cache only (autocomplete hot path).
 */

import type { ScanPurpose } from "./scanning/ScanPurpose.js";

const PROXY_BASE_URL = process.env.AF_PROXY_URL ?? "http://localhost:8080";
const SCAN_FILE_ENDPOINT = `${PROXY_BASE_URL}/api/scan/file`;
const SCAN_TIMEOUT_MS = 5000;
const FAST_SCAN_TIMEOUT_MS = 1000;

export interface FileScanFinding {
  type: string;
  severity: string;
  category: "secret" | "pii";
  /** 1-based line number in the scanned file. */
  line: number;
  /** 1-based column on `line`. */
  column: number;
  /** Pre-masked display value — never the raw secret. */
  masked: string;
}

export interface FileScanDecision {
  action: "ALLOW" | "BLOCK" | "REDACT";
  riskScore: number;
  reasons: string[];
  redactedContent?: string;
  /** The path the proxy actually scanned (echoed back). */
  filePath?: string;
  /** Per-finding details with file location. Empty when no findings. */
  findings?: FileScanFinding[];
}

const FAIL_OPEN: FileScanDecision = {
  action: "ALLOW",
  riskScore: 0,
  reasons: [],
  findings: [],
};

/** Options for {@link scanFileViaProxy}. */
export interface ScanFileViaProxyOptions {
  readonly fetchFn?: typeof fetch;
  readonly projectRoot?: string;
  readonly bearerToken?: string;
  /**
   * Tag the call with a `ScanPurpose` so the proxy can log it and
   * (once the cache-only route lands) apply purpose-specific fast
   * paths. Defaults to `"llm"` when omitted.
   */
  readonly purpose?: ScanPurpose;
  /**
   * Ask the proxy for a cached-only response (204 on miss). Used by
   * the `autocomplete` path to avoid a synchronous pipeline run.
   * Fails open on miss.
   */
  readonly cacheOnly?: boolean;
  /**
   * Override the request timeout. The `indexing` purpose uses a
   * short (1s) budget so a stalled proxy can't jam a big batch.
   */
  readonly timeoutMs?: number;
}

/**
 * Scan a file via the proxy before reading it.
 *
 * Back-compat: the 4-arg positional signature still works for
 * callers that haven't migrated to the options object yet.
 */
export async function scanFileViaProxy(
  filePath: string,
  optionsOrFetch?: ScanFileViaProxyOptions | typeof fetch,
  projectRoot?: string,
  bearerToken?: string,
): Promise<FileScanDecision> {
  // Normalise the two call shapes. The positional form was the
  // original signature; the options form is what the decorator
  // and the migrated callers use.
  const opts: ScanFileViaProxyOptions =
    typeof optionsOrFetch === "function" || optionsOrFetch === undefined
      ? {
          fetchFn: optionsOrFetch as typeof fetch | undefined,
          projectRoot,
          bearerToken,
        }
      : optionsOrFetch;

  const doFetch = opts.fetchFn ?? globalThis.fetch;
  if (!doFetch) {
    return FAIL_OPEN;
  }

  const purpose: ScanPurpose = opts.purpose ?? "llm";
  const timeoutMs =
    opts.timeoutMs ??
    (purpose === "indexing" ? FAST_SCAN_TIMEOUT_MS : SCAN_TIMEOUT_MS);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-AF-Scan-Purpose": purpose,
    };
    if (opts.bearerToken) {
      headers["Authorization"] = `Bearer ${opts.bearerToken}`;
    }
    if (opts.cacheOnly) {
      headers["X-AF-Scan-Cache-Only"] = "1";
    }

    const response = await doFetch(SCAN_FILE_ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify({
        filePath,
        includeRedacted: true,
        ...(opts.projectRoot ? { projectRoot: opts.projectRoot } : {}),
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    // Cache-only miss: proxy returns 204 No Content (once it
    // supports the header). Treat as fail-open so autocomplete
    // never blocks waiting for a scan.
    if (response.status === 204) {
      return FAIL_OPEN;
    }

    if (!response.ok) {
      // 4xx/5xx from proxy — fail-open
      return FAIL_OPEN;
    }

    const data = await response.json();

    if (data && typeof data.action === "string") {
      return {
        action: data.action,
        riskScore: data.riskScore ?? 0,
        reasons: data.reasons ?? [],
        redactedContent: data.redactedContent,
        filePath: typeof data.filePath === "string" ? data.filePath : filePath,
        findings: flattenFindings(data),
      };
    }

    return FAIL_OPEN;
  } catch {
    // Network error, timeout, parse error — fail-open
    return FAIL_OPEN;
  }
}

/**
 * Flatten the proxy's `secrets[]` and `pii[]` arrays into a single
 * `findings[]` keyed by category. Drops entries that are missing the
 * line/column info (older proxies that don't yet emit it) so we can
 * roll the client out ahead of the server without crashing.
 */
function flattenFindings(data: {
  secrets?: Array<{
    type?: string;
    severity?: string;
    line?: number;
    column?: number;
    masked?: string;
  }>;
  pii?: Array<{
    type?: string;
    severity?: string;
    line?: number;
    column?: number;
    masked?: string;
  }>;
}): FileScanFinding[] {
  const out: FileScanFinding[] = [];

  for (const s of data.secrets ?? []) {
    if (typeof s.line !== "number" || typeof s.column !== "number") continue;
    out.push({
      type: s.type ?? "UNKNOWN",
      severity: s.severity ?? "medium",
      category: "secret",
      line: s.line,
      column: s.column,
      masked: s.masked ?? "",
    });
  }
  for (const p of data.pii ?? []) {
    if (typeof p.line !== "number" || typeof p.column !== "number") continue;
    out.push({
      type: p.type ?? "UNKNOWN",
      severity: p.severity ?? "medium",
      category: "pii",
      line: p.line,
      column: p.column,
      masked: p.masked ?? "",
    });
  }

  // Sort by line, then column — so the UI shows them in file order.
  out.sort((a, b) => a.line - b.line || a.column - b.column);
  return out;
}
