/**
 * Response Scanner
 *
 * Scans LLM responses for secrets and PII before they reach the client.
 * Addresses LLM05 (Insecure Output) — the LLM may leak secrets/PII
 * from its training data or from injected context.
 *
 * Design decisions:
 * - Never BLOCKs responses (wastes tokens, worse UX). Only WARN or REDACT.
 * - Non-streaming: parse JSON response, scan content, set headers.
 * - Streaming: Transform stream scans accumulated SSE chunks.
 * - Opt-in via policy.json (enabled: false by default — adds latency).
 *
 * SOLID:
 * - SRP: Only scans response text. No routing, no logging.
 * - DIP: Uses @ai-firewall/scanner interfaces.
 */

import { Transform, type TransformCallback } from "node:stream";
import {
  scanSecrets,
  scanPII,
  normalizeUnicode,
  type SecretMatch,
  type PiiMatch,
} from "@ai-firewall/scanner";

// ── Types ──────────────────────────────────────────────────────────────────

export interface ResponseScanConfig {
  enabled: boolean;
  scan_secrets: boolean;
  scan_pii: boolean;
  redact_on_detection: boolean;
  stream_buffer_size: number;
}

export interface ResponseScanResult {
  action: "ALLOW" | "REDACT" | "WARN";
  secretsFound: number;
  piiFound: number;
  secrets: SecretMatch[];
  pii: PiiMatch[];
  redactedText?: string;
  scanTimeMs: number;
}

const DEFAULT_CONFIG: ResponseScanConfig = {
  enabled: false,
  scan_secrets: true,
  scan_pii: true,
  redact_on_detection: false,
  stream_buffer_size: 500,
};

// ── Core Scan Function ─────────────────────────────────────────────────────

/**
 * Scan response text for secrets and PII.
 * Pure function — no side effects.
 */
export function scanResponseText(
  text: string,
  config: Partial<ResponseScanConfig> = {}
): ResponseScanResult {
  const startTime = Date.now();
  const cfg = { ...DEFAULT_CONFIG, ...config };

  if (!text || !cfg.enabled) {
    return {
      action: "ALLOW",
      secretsFound: 0,
      piiFound: 0,
      secrets: [],
      pii: [],
      scanTimeMs: Date.now() - startTime,
    };
  }

  // Normalize unicode before scanning
  const { normalizedText } = normalizeUnicode(text);

  const secrets = cfg.scan_secrets ? scanSecrets(normalizedText).secrets : [];
  const pii = cfg.scan_pii ? scanPII(normalizedText).pii : [];

  const hasFindings = secrets.length > 0 || pii.length > 0;

  let action: "ALLOW" | "REDACT" | "WARN";
  let redactedText: string | undefined;

  if (hasFindings && cfg.redact_on_detection) {
    action = "REDACT";
    redactedText = redactResponseText(text, secrets, pii);
  } else if (hasFindings) {
    action = "WARN";
  } else {
    action = "ALLOW";
  }

  return {
    action,
    secretsFound: secrets.length,
    piiFound: pii.length,
    secrets,
    pii,
    redactedText,
    scanTimeMs: Date.now() - startTime,
  };
}

// ── Response Redaction ─────────────────────────────────────────────────────

function redactResponseText(
  text: string,
  secrets: SecretMatch[],
  pii: PiiMatch[]
): string {
  let redacted = text;
  const allMatches = [
    ...secrets.map((s) => ({ type: s.type, value: s.value })),
    ...pii.map((p) => ({ type: p.type, value: p.value })),
  ];

  // Sort by value length descending to avoid partial replacements
  allMatches.sort((a, b) => b.value.length - a.value.length);

  for (const match of allMatches) {
    if (!match.value) continue;
    const token = `[REDACTED_${match.type.replace(/[^A-Z0-9_]/g, "_")}]`;
    redacted = redacted.split(match.value).join(token);
  }

  return redacted;
}

// ── Extract Completion Text ────────────────────────────────────────────────

/**
 * Extract the assistant's response text from an OpenAI-format response object.
 */
export function extractCompletionText(
  responseData: Record<string, unknown>
): string {
  try {
    const choices = responseData.choices as Array<Record<string, unknown>> | undefined;
    if (!choices || choices.length === 0) return "";
    const message = choices[0]!.message as Record<string, unknown> | undefined;
    if (!message) return "";
    const content = message.content;
    return typeof content === "string" ? content : "";
  } catch {
    return "";
  }
}

/**
 * Replace the completion text in the response object (immutable).
 */
export function replaceCompletionText(
  responseData: Record<string, unknown>,
  newText: string
): Record<string, unknown> {
  try {
    const choices = responseData.choices as Array<Record<string, unknown>> | undefined;
    if (!choices || choices.length === 0) return responseData;
    const firstChoice = choices[0]!;
    const message = firstChoice.message as Record<string, unknown> | undefined;
    if (!message) return responseData;

    return {
      ...responseData,
      choices: [
        {
          ...firstChoice,
          message: { ...message, content: newText },
        },
        ...choices.slice(1),
      ],
    };
  } catch {
    return responseData;
  }
}

// ── Set Response Scan Headers ──────────────────────────────────────────────

export function setResponseScanHeaders(
  reply: { header: (name: string, value: string) => void },
  result: ResponseScanResult
): void {
  reply.header("X-AF-Response-Action", result.action);
  if (result.secretsFound > 0) {
    reply.header("X-AF-Response-Secrets-Count", String(result.secretsFound));
  }
  if (result.piiFound > 0) {
    reply.header("X-AF-Response-PII-Count", String(result.piiFound));
  }
}

// ── Streaming Transform ────────────────────────────────────────────────────

/**
 * Create a Transform stream that scans SSE chunks for secrets/PII.
 *
 * Accumulates text content from `data: {"choices":[{"delta":{"content":"..."}}]}`
 * chunks and scans at intervals defined by `stream_buffer_size`.
 *
 * On stream end, runs a final scan on the full accumulated text.
 */
export function createScanningTransform(
  config: Partial<ResponseScanConfig> = {}
): Transform {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  let accumulated = "";
  let lastScanPos = 0;
  let detectedValues = new Set<string>();

  return new Transform({
    transform(chunk: Buffer, _encoding: string, callback: TransformCallback) {
      const chunkStr = chunk.toString("utf-8");

      // Extract content from SSE data lines
      const lines = chunkStr.split("\n");
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const jsonStr = line.slice(6).trim();
        if (jsonStr === "[DONE]") continue;
        try {
          const parsed = JSON.parse(jsonStr);
          const delta = parsed?.choices?.[0]?.delta?.content;
          if (typeof delta === "string") {
            accumulated += delta;
          }
        } catch {
          // Not valid JSON — pass through
        }
      }

      // Scan at buffer intervals
      if (accumulated.length - lastScanPos >= cfg.stream_buffer_size) {
        const scanResult = scanResponseText(accumulated, cfg);
        lastScanPos = accumulated.length;

        // Collect detected values for in-flight redaction
        if (scanResult.action !== "ALLOW") {
          for (const s of scanResult.secrets) detectedValues.add(s.value);
          for (const p of scanResult.pii) detectedValues.add(p.value);
        }
      }

      // If redacting, replace known values in the chunk
      let outputChunk = chunkStr;
      if (cfg.redact_on_detection && detectedValues.size > 0) {
        for (const val of detectedValues) {
          if (outputChunk.includes(val)) {
            outputChunk = outputChunk.split(val).join("[REDACTED]");
          }
        }
      }

      callback(null, Buffer.from(outputChunk, "utf-8"));
    },

    flush(callback: TransformCallback) {
      // Final scan on complete accumulated text
      if (accumulated.length > lastScanPos) {
        const finalScan = scanResponseText(accumulated, cfg);
        if (finalScan.action !== "ALLOW") {
          // Emit a final SSE comment with scan summary
          const summary = JSON.stringify({
            response_scan: {
              action: finalScan.action,
              secrets_found: finalScan.secretsFound,
              pii_found: finalScan.piiFound,
            },
          });
          this.push(Buffer.from(`\n: ${summary}\n`, "utf-8"));
        }
      }
      callback();
    },
  });
}
