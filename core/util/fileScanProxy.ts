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

export interface FileScanDecision {
  action: "ALLOW" | "BLOCK" | "REDACT";
  riskScore: number;
  reasons: string[];
  redactedContent?: string;
}

const FAIL_OPEN: FileScanDecision = {
  action: "ALLOW",
  riskScore: 0,
  reasons: [],
};

/**
 * Scan a file via the proxy before reading it.
 *
 * @param filePath - Absolute or relative path to the file
 * @param fetchFn - Optional fetch function (e.g. extras.fetch from core tools)
 * @param projectRoot - Optional project root for policy merging
 * @returns FileScanDecision with action, riskScore, reasons, and optional redactedContent
 */
export async function scanFileViaProxy(
  filePath: string,
  fetchFn?: typeof fetch,
  projectRoot?: string,
): Promise<FileScanDecision> {
  const doFetch = fetchFn ?? globalThis.fetch;
  if (!doFetch) {
    return FAIL_OPEN;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SCAN_TIMEOUT_MS);

    const response = await doFetch(SCAN_FILE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
      };
    }

    return FAIL_OPEN;
  } catch {
    // Network error, timeout, parse error — fail-open
    return FAIL_OPEN;
  }
}
