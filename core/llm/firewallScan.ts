import {
  extractScanHeaders,
  fetchwithRequestOptions,
} from "@ai-firewall/fetch";

const SCAN_URL = "http://127.0.0.1:8080/api/scan";
const SCAN_TIMEOUT_MS = 5000;

/**
 * Compact finding shape mirrored from the proxy's `X-AF-Findings`
 * header / 403 BLOCK response body. Lives in core so the GUI can
 * type-narrow against it without importing from the proxy.
 */
export interface FirewallFinding {
  /** Pattern type — e.g. "OPENAI_PROJECT_KEY", "EMAIL", "PROMPT_INJECTION". */
  type: string;
  /** Severity — "critical" | "high" | "medium" | "low" or whatever the scanner emits. */
  severity?: string;
  /** Pre-masked display value the GUI may render (never the raw secret). */
  masked?: string;
}

export interface PreflightScanResult {
  finalBody: string;
  blocked: boolean;
  blockMessage?: string;
  /** When blocked, the structured payload from the proxy (if available). */
  blockDetail?: BlockDetail;
}

export interface BlockDetail {
  riskScore: number;
  reasons: string[];
  findings: FirewallFinding[];
  action: "BLOCK" | "REDACT" | "ALLOW";
}

/**
 * Typed error the LLM layer throws when the firewall blocks a request.
 *
 * Detected by `gui/src/pages/gui/StreamError.tsx` to render a
 * firewall-themed dialog (with masked findings + remediation guidance)
 * instead of the generic "Error handling model response" surface.
 *
 * Subclasses `Error` so any existing `catch (e)` blocks keep working
 * without changes — the structured detail is on `error.detail`.
 */
export class FirewallBlockedRequestError extends Error {
  readonly name = "FirewallBlockedRequestError";
  readonly detail: BlockDetail;

  constructor(message: string, detail: BlockDetail) {
    super(message);
    this.detail = detail;
  }
}

export function isFirewallBlockedRequestError(
  e: unknown,
): e is FirewallBlockedRequestError {
  return e instanceof Error && e.name === "FirewallBlockedRequestError";
}

/**
 * Pre-flight scan: sends request body to the AI Firewall proxy
 * for secret/PII/injection scanning before forwarding to any LLM.
 *
 * - BLOCK  -> returns blocked=true with reason + structured detail
 * - REDACT -> returns finalBody with sanitised messages
 * - ALLOW  -> returns original body unchanged
 * - Proxy unreachable -> fail-open (returns original body)
 *
 * When `forceRedact` is set, the proxy is asked to downgrade any BLOCK
 * decision to REDACT — used after the user explicitly consents to send
 * a sanitised version of a previously-blocked prompt.
 */
export async function firewallPreflightScan(
  body: string,
  model: string,
  forceRedact = false,
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
              content:
                typeof m.content === "string"
                  ? m.content
                  : JSON.stringify(m.content),
            })),
            model: parsed.model || model,
            forceRedact: forceRedact || undefined,
          }),
          signal: controller.signal,
        },
        {},
      );

      clearTimeout(timer);

      // Fire scan result listeners so the GUI updates
      extractScanHeaders(scanResp);

      if (scanResp.status === 403) {
        const d = (await scanResp.json()) as {
          riskScore?: number;
          reasons?: string[];
          findings?: FirewallFinding[];
          secrets?: Array<{ type: string; severity?: string; masked?: string }>;
          pii?: Array<{ type: string; severity?: string; masked?: string }>;
        };
        const detail: BlockDetail = {
          action: "BLOCK",
          riskScore: d.riskScore ?? 0,
          reasons: d.reasons ?? [],
          // Prefer the unified `findings` array; fall back to merging
          // the older shape if the proxy hasn't been redeployed yet.
          findings:
            d.findings ??
            [...(d.secrets ?? []), ...(d.pii ?? [])].map((f) => ({
              type: f.type,
              severity: f.severity,
              masked: f.masked,
            })),
        };
        return {
          finalBody: body,
          blocked: true,
          blockMessage:
            "AI Firewall blocked this request (risk: " +
            detail.riskScore +
            "). " +
            detail.reasons.join("; "),
          blockDetail: detail,
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
