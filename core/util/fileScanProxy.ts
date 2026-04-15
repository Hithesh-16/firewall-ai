/**
 * Proxy-side file scanning utility.
 *
 * Calls the proxy's POST /api/scan/file endpoint before file reads
 * to enforce BLOCK/REDACT decisions from the security pipeline.
 * Fail-open: if the proxy is unreachable, returns ALLOW.
 */

const PROXY_BASE_URL = process.env.AF_PROXY_URL ?? "http://localhost:8080";
const SCAN_FILE_ENDPOINT = `${PROXY_BASE_URL}/api/scan/file`;
const SCAN_TIMEOUT_MS = 5000;

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

/**
 * Scan a file via the proxy before reading it.
 *
 * @param filePath - Absolute or relative path to the file
 * @param fetchFn - Optional fetch function (e.g. extras.fetch from core tools)
 * @param projectRoot - Optional project root for policy merging
 * @param bearerToken - Optional auth token so the proxy can resolve role-level policy
 * @returns FileScanDecision with action, riskScore, reasons, and optional redactedContent
 */
export async function scanFileViaProxy(
  filePath: string,
  fetchFn?: typeof fetch,
  projectRoot?: string,
  bearerToken?: string,
): Promise<FileScanDecision> {
  const doFetch = fetchFn ?? globalThis.fetch;
  if (!doFetch) {
    return FAIL_OPEN;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SCAN_TIMEOUT_MS);

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (bearerToken) {
      headers["Authorization"] = `Bearer ${bearerToken}`;
    }

    const response = await doFetch(SCAN_FILE_ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify({
        filePath,
        includeRedacted: true,
        ...(projectRoot ? { projectRoot } : {}),
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

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
