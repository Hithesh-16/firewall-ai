import { extractScanHeaders, fetchwithRequestOptions } from "@ai-firewall/fetch";

const SCAN_URL = "http://127.0.0.1:8080/api/scan";
const SCAN_TIMEOUT_MS = 5000;

export interface PreflightScanResult {
  finalBody: string;
  blocked: boolean;
  blockMessage?: string;
}

/**
 * Pre-flight scan: sends request body to the AI Firewall proxy
 * for secret/PII/injection scanning before forwarding to any LLM.
 *
 * - BLOCK  -> returns blocked=true with reason
 * - REDACT -> returns finalBody with sanitised messages
 * - ALLOW  -> returns original body unchanged
 * - Proxy unreachable -> fail-open (returns original body)
 */
export async function firewallPreflightScan(
  body: string,
  model: string,
): Promise<PreflightScanResult> {
  try {
    const parsed = JSON.parse(body);
    const messages = parsed?.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      return { finalBody: body, blocked: false };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SCAN_TIMEOUT_MS);

    try {
      const scanResp = await fetchwithRequestOptions(
        new URL(SCAN_URL),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: messages.map((m: any) => ({
              role: m.role,
              content: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
            })),
            model: parsed.model || model,
          }),
          signal: controller.signal,
        },
        {},
      );

      clearTimeout(timer);

      // Fire scan result listeners so the GUI updates
      extractScanHeaders(scanResp);

      if (scanResp.status === 403) {
        const d = (await scanResp.json()) as any;
        return {
          finalBody: body,
          blocked: true,
          blockMessage:
            "AI Firewall blocked this request (risk: " +
            (d.riskScore ?? 0) +
            "). " +
            (d.reasons || []).join("; "),
        };
      }

      if (scanResp.ok) {
        const d = (await scanResp.json()) as any;
        if (d.action === "REDACT" && d.sanitizedMessages) {
          return {
            finalBody: JSON.stringify({
              ...parsed,
              messages: d.sanitizedMessages,
            }),
            blocked: false,
          };
        }
      }

      return { finalBody: body, blocked: false };
    } finally {
      clearTimeout(timer);
    }
  } catch {
    // Fail-open: if proxy is unreachable, allow the request through
    return { finalBody: body, blocked: false };
  }
}
