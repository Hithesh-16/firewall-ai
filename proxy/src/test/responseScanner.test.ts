/**
 * Response Scanner Tests
 *
 * Tests for scanning LLM responses for leaked secrets/PII.
 */

import assert from "node:assert";
import {
  scanResponseText,
  extractCompletionText,
  replaceCompletionText,
} from "../middleware/responseScanner";

// ── scanResponseText ────────────────────────────────────────────────

export function testResponseScanAllowsCleanText() {
  const result = scanResponseText("Here is a simple Python function to sort a list.", { enabled: true });
  assert.strictEqual(result.action, "ALLOW");
  assert.strictEqual(result.secretsFound, 0);
  assert.strictEqual(result.piiFound, 0);
}

export function testResponseScanWarnsOnSecret() {
  const result = scanResponseText(
    "Here is the config: AKIAIOSFODNN7EXAMPLE",
    { enabled: true, scan_secrets: true, redact_on_detection: false }
  );
  assert.strictEqual(result.action, "WARN");
  assert.ok(result.secretsFound > 0, "Should detect AWS key");
}

export function testResponseScanRedactsOnSecret() {
  const result = scanResponseText(
    "Use this key: AKIAIOSFODNN7EXAMPLE to access S3",
    { enabled: true, scan_secrets: true, redact_on_detection: true }
  );
  assert.strictEqual(result.action, "REDACT");
  assert.ok(result.redactedText, "Should have redacted text");
  assert.ok(!result.redactedText!.includes("AKIAIOSFODNN7EXAMPLE"), "Key should be redacted");
  assert.ok(result.redactedText!.includes("[REDACTED_"), "Should contain redaction token");
}

export function testResponseScanDetectsPII() {
  const result = scanResponseText(
    "Contact admin@example.com for help",
    { enabled: true, scan_pii: true }
  );
  assert.strictEqual(result.action, "WARN");
  assert.ok(result.piiFound > 0, "Should detect email PII");
}

export function testResponseScanSkipsWhenDisabled() {
  const result = scanResponseText(
    "AKIAIOSFODNN7EXAMPLE admin@example.com",
    { enabled: false }
  );
  assert.strictEqual(result.action, "ALLOW");
  assert.strictEqual(result.secretsFound, 0);
}

export function testResponseScanHandlesEmptyText() {
  const result = scanResponseText("", { enabled: true });
  assert.strictEqual(result.action, "ALLOW");
}

// ── extractCompletionText ───────────────────────────────────────────

export function testExtractCompletionFromOpenAIFormat() {
  const response = {
    choices: [
      {
        message: {
          role: "assistant",
          content: "Hello, world!",
        },
      },
    ],
  };
  const text = extractCompletionText(response);
  assert.strictEqual(text, "Hello, world!");
}

export function testExtractCompletionFromEmptyResponse() {
  const text = extractCompletionText({});
  assert.strictEqual(text, "");
}

export function testExtractCompletionFromNoChoices() {
  const text = extractCompletionText({ choices: [] });
  assert.strictEqual(text, "");
}

// ── replaceCompletionText ───────────────────────────────────────────

export function testReplaceCompletionText() {
  const response = {
    id: "test-123",
    choices: [
      {
        message: {
          role: "assistant",
          content: "Original text with AKIAIOSFODNN7EXAMPLE",
        },
        index: 0,
      },
    ],
  };
  const replaced = replaceCompletionText(response, "Redacted text");
  const choices = replaced.choices as Array<Record<string, unknown>>;
  const msg = choices[0]!.message as Record<string, unknown>;
  assert.strictEqual(msg.content, "Redacted text");
  assert.strictEqual((replaced as any).id, "test-123"); // Other fields preserved
}
