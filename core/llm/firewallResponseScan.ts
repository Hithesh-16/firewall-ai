import {
  extractScanHeaders,
  fetchwithRequestOptions,
} from "@ai-firewall/fetch";

const SCAN_URL = "http://127.0.0.1:8080/api/scan/response";
const SCAN_TIMEOUT_MS = 5000;

export interface ResponseScanResult {
  /** Scanned text (may be redacted if leaks were found). */
  finalText: string;
  /** True when the proxy found secrets/PII and masked them. */
  hadLeaks: boolean;
  secretsFound: number;
  piiFound: number;
}

/**
 * Post-flight scan: sends the LLM's full response text to the proxy so
 * it can detect and mask any leaked secrets/PII (LLM05 defense).
 *
 * - Clean response → returns text unchanged
 * - Leak detected → returns masked text + hadLeaks=true, dashboard event
 *   fires via X-AF-* headers → GUI banner updates
 * - Proxy unreachable or error → fail-open, returns original text
 *
 * Called by core/llm/index.ts after a chat completion finishes so the
 * extension can replace the final message with a sanitized version if
 * the model accidentally echoed a secret from training data or context.
 */
export async function firewallResponseScan(
  text: string,
  model: string,
): Promise<ResponseScanResult> {
  const fallback: ResponseScanResult = {
    finalText: text,
    hadLeaks: false,
    secretsFound: 0,
    piiFound: 0,
  };

  if (!text || text.length === 0) return fallback;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SCAN_TIMEOUT_MS);

    try {
      const resp = await fetchwithRequestOptions(
        new URL(SCAN_URL),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, model }),
          signal: controller.signal,
        },
        {},
      );

      clearTimeout(timer);

      // Fire scan result listeners so the GUI dashboard/banner updates
      extractScanHeaders(resp);

      if (!resp.ok) return fallback;

      const data = (await resp.json()) as {
        action: "ALLOW" | "REDACT";
        sanitizedText?: string;
        secretsFound?: number;
        piiFound?: number;
      };

      if (data.action === "REDACT" && data.sanitizedText) {
        return {
          finalText: data.sanitizedText,
          hadLeaks: true,
          secretsFound: data.secretsFound ?? 0,
          piiFound: data.piiFound ?? 0,
        };
      }

      return fallback;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    // Fail-open: proxy unreachable → return original text
    return fallback;
  }
}
