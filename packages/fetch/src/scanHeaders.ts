import type { Response } from "node-fetch";

export interface ScanFinding {
  type: string; // e.g. "AWS_KEY", "EMAIL", "JWT"
  severity: string; // "critical" | "high" | "medium"
  category: "secret" | "pii";
  maskedValue: string; // e.g. "AKIA************7E"
  /** Source file path when the finding came from a file scan. */
  file?: string;
  /** 1-based line number in `file`. */
  line?: number;
  /** 1-based column on `line`. */
  column?: number;
}

export interface FirewallScanResult {
  action: "ALLOW" | "REDACT" | "BLOCK" | "REQUIRE_APPROVAL";
  riskScore: number;
  secretsCount: number;
  piiCount: number;
  entropyCount: number;
  redactedTypes: string[];
  findings: ScanFinding[];
  tokensUsed?: number;
  cost?: number;
  /** Token intelligence (Phase 1) */
  inputTokens?: number;
  estimatedCost?: number;
  tokenMethod?: "tiktoken" | "heuristic";
  contextOverflow?: boolean;
  contextTokens?: number;
  contextMax?: number;
  /** Kilocode-parity token breakdown (Phase UX1).
   *  Populated when the upstream provider surfaces them; zero/undefined
   *  otherwise so the UI auto-hides the columns. */
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
  /** Live context window snapshot for the ContextBar. `contextUsed`
   *  may equal `contextTokens` today but is kept separate so we can
   *  later report "tokens already in the conversation" independently
   *  of the input-only `contextTokens`. */
  contextUsed?: number;
  contextLimit?: number;
  outputReserve?: number;
  /** MCP gateway (Phase 3) */
  mcpAction?: "ALLOW" | "BLOCK" | "REDACT";
  mcpRiskScore?: number;
  mcpServer?: string;
  mcpTool?: string;
}

export type ScanResultListener = (result: FirewallScanResult) => void;

/** Global listeners for scan results — set by the extension/core layer */
const scanListeners: ScanResultListener[] = [];

/** Register a callback that fires whenever a scan result is detected in a response */
export function onScanResult(listener: ScanResultListener): () => void {
  scanListeners.push(listener);
  return () => {
    const idx = scanListeners.indexOf(listener);
    if (idx >= 0) scanListeners.splice(idx, 1);
  };
}

/**
 * Extract AI Firewall scan result headers from an HTTP response.
 * Returns null if no X-AF-Action header is present (request didn't go through the proxy).
 * Automatically notifies all registered listeners when a scan result is found.
 */
export function extractScanHeaders(
  response: Response | globalThis.Response,
): FirewallScanResult | null {
  const action = response.headers.get("x-af-action");
  if (!action) {
    return null;
  }

  const result: FirewallScanResult = {
    action: action as FirewallScanResult["action"],
    riskScore: parseInt(response.headers.get("x-af-risk-score") || "0", 10),
    secretsCount: parseInt(
      response.headers.get("x-af-secrets-count") || "0",
      10,
    ),
    piiCount: parseInt(response.headers.get("x-af-pii-count") || "0", 10),
    entropyCount: parseInt(
      response.headers.get("x-af-entropy-count") || "0",
      10,
    ),
    redactedTypes: (response.headers.get("x-af-redacted-types") || "")
      .split(",")
      .filter(Boolean),
    findings: parseFindingsHeader(response.headers.get("x-af-findings")),
    tokensUsed: response.headers.has("x-af-tokens-used")
      ? parseInt(response.headers.get("x-af-tokens-used")!, 10)
      : undefined,
    cost: response.headers.has("x-af-cost")
      ? parseFloat(response.headers.get("x-af-cost")!)
      : undefined,
    // Token intelligence headers
    inputTokens: response.headers.has("x-af-input-tokens")
      ? parseInt(response.headers.get("x-af-input-tokens")!, 10)
      : undefined,
    estimatedCost: response.headers.has("x-af-estimated-cost")
      ? parseFloat(response.headers.get("x-af-estimated-cost")!)
      : undefined,
    tokenMethod:
      (response.headers.get(
        "x-af-token-method",
      ) as FirewallScanResult["tokenMethod"]) ?? undefined,
    contextOverflow:
      response.headers.get("x-af-context-overflow") === "true" || undefined,
    contextTokens: response.headers.has("x-af-context-tokens")
      ? parseInt(response.headers.get("x-af-context-tokens")!, 10)
      : undefined,
    contextMax: response.headers.has("x-af-context-max")
      ? parseInt(response.headers.get("x-af-context-max")!, 10)
      : undefined,
    // Kilocode-parity token breakdown headers
    outputTokens: response.headers.has("x-af-output-tokens")
      ? parseInt(response.headers.get("x-af-output-tokens")!, 10)
      : undefined,
    cacheReadTokens: response.headers.has("x-af-cache-read-tokens")
      ? parseInt(response.headers.get("x-af-cache-read-tokens")!, 10)
      : undefined,
    cacheWriteTokens: response.headers.has("x-af-cache-write-tokens")
      ? parseInt(response.headers.get("x-af-cache-write-tokens")!, 10)
      : undefined,
    reasoningTokens: response.headers.has("x-af-reasoning-tokens")
      ? parseInt(response.headers.get("x-af-reasoning-tokens")!, 10)
      : undefined,
    contextUsed: response.headers.has("x-af-context-used")
      ? parseInt(response.headers.get("x-af-context-used")!, 10)
      : undefined,
    contextLimit: response.headers.has("x-af-context-limit")
      ? parseInt(response.headers.get("x-af-context-limit")!, 10)
      : undefined,
    outputReserve: response.headers.has("x-af-output-reserve")
      ? parseInt(response.headers.get("x-af-output-reserve")!, 10)
      : undefined,
    // MCP gateway headers
    mcpAction:
      (response.headers.get(
        "x-af-mcp-action",
      ) as FirewallScanResult["mcpAction"]) ?? undefined,
    mcpRiskScore: response.headers.has("x-af-mcp-risk-score")
      ? parseInt(response.headers.get("x-af-mcp-risk-score")!, 10)
      : undefined,
    mcpServer: response.headers.get("x-af-mcp-server") ?? undefined,
    mcpTool: response.headers.get("x-af-mcp-tool") ?? undefined,
  };

  // Notify all listeners
  for (const listener of scanListeners) {
    try {
      listener(result);
    } catch {
      // Don't let a listener crash the fetch layer
    }
  }

  return result;
}

/**
 * Parse the compact X-AF-Findings JSON header into ScanFinding[].
 *
 * Compact format: `{t: type, s: severity, c: category, v: maskedValue,
 * f?: file, l?: line, col?: column}`. The `f`/`l`/`col` keys are
 * optional so older proxies stay compatible.
 */
function parseFindingsHeader(header: string | null): ScanFinding[] {
  if (!header) return [];
  try {
    const parsed = JSON.parse(header);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(
      (f: {
        t: string;
        s: string;
        c: string;
        v: string;
        f?: string;
        l?: number;
        col?: number;
      }) => ({
        type: f.t,
        severity: f.s,
        category: f.c as "secret" | "pii",
        maskedValue: f.v,
        file: f.f,
        line: f.l,
        column: f.col,
      }),
    );
  } catch {
    return [];
  }
}

/**
 * Extract firewall metadata from a non-streaming response body's `_firewall` field.
 * This is complementary to header extraction — used when the proxy embeds metadata
 * in the JSON response body (e.g. gateway route responses).
 */
export function extractFirewallMeta(
  responseBody: any,
): FirewallScanResult | null {
  const meta = responseBody?._firewall;
  if (!meta?.action) {
    return null;
  }

  const result: FirewallScanResult = {
    action: meta.action as FirewallScanResult["action"],
    riskScore: meta.risk_score ?? 0,
    secretsCount: meta.secrets_found ?? 0,
    piiCount: meta.pii_found ?? 0,
    entropyCount: meta.entropy_found ?? 0,
    redactedTypes: [],
    // Normalise findings — accept both the long-form (file/line/column)
    // and the legacy compact form so JSON-body callers don't have to
    // know which encoding is in use.
    findings: Array.isArray(meta.findings)
      ? meta.findings.map(
          (f: any): ScanFinding => ({
            type: f.type ?? f.t ?? "UNKNOWN",
            severity: f.severity ?? f.s ?? "medium",
            category: (f.category ?? f.c ?? "secret") as "secret" | "pii",
            maskedValue: f.maskedValue ?? f.v ?? "",
            file: f.file ?? f.f,
            line: f.line ?? f.l,
            column: f.column ?? f.col,
          }),
        )
      : [],
    tokensUsed: meta.tokens_used,
    cost: meta.cost_estimate,
  };

  for (const listener of scanListeners) {
    try {
      listener(result);
    } catch {
      // Don't let a listener crash the fetch layer
    }
  }

  return result;
}
