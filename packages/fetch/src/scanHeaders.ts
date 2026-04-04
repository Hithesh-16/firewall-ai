import type { Response } from "node-fetch";

export interface ScanFinding {
  type: string; // e.g. "AWS_KEY", "EMAIL", "JWT"
  severity: string; // "critical" | "high" | "medium"
  category: "secret" | "pii";
  maskedValue: string; // e.g. "AKIA************7E"
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

/** Parse the compact X-AF-Findings JSON header into ScanFinding[] */
function parseFindingsHeader(header: string | null): ScanFinding[] {
  if (!header) return [];
  try {
    const parsed = JSON.parse(header);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((f: { t: string; s: string; c: string; v: string }) => ({
      type: f.t,
      severity: f.s,
      category: f.c as "secret" | "pii",
      maskedValue: f.v,
    }));
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
    findings: Array.isArray(meta.findings) ? meta.findings : [],
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
