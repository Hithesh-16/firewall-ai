import type { Response } from "node-fetch";

export interface FirewallScanResult {
  action: "ALLOW" | "REDACT" | "BLOCK" | "REQUIRE_APPROVAL";
  riskScore: number;
  secretsCount: number;
  piiCount: number;
  entropyCount: number;
  redactedTypes: string[];
  tokensUsed?: number;
  cost?: number;
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
    tokensUsed: response.headers.has("x-af-tokens-used")
      ? parseInt(response.headers.get("x-af-tokens-used")!, 10)
      : undefined,
    cost: response.headers.has("x-af-cost")
      ? parseFloat(response.headers.get("x-af-cost")!)
      : undefined,
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
