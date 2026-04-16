/**
 * Secret Pattern Tests — Phase A.A1 (SECURITY_HARDENING_PLAN.md)
 *
 * True-positive + true-negative coverage for the named-format LLM
 * provider keys added in `packages/scanner/src/patterns.ts`. Each
 * pattern needs both:
 *   - TP: a realistic key matches and reports the right `type`
 *   - TN: prose / commit-hash-shaped strings DON'T match
 *
 * Per `.claude/rules/testing.md`: scanner regex changes require both.
 */

import assert from "node:assert";
import { scanSecrets } from "@ai-firewall/scanner";

// ── GROQ_KEY ───────────────────────────────────────────────────────

export function testGroqKeyDetected() {
  const text = "GROQ_API_KEY=gsk_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  const result = scanSecrets(text);
  assert.ok(result.hasSecrets, "Groq key should be detected");
  const groq = result.secrets.find((s) => s.type === "GROQ_KEY");
  assert.ok(groq, "Should report GROQ_KEY type");
  assert.strictEqual(groq?.severity, "critical");
}

export function testGroqKeyNoFalsePositiveOnPrefixAlone() {
  // "gsk_" alone with too-short body must NOT match (length floor 40).
  const result = scanSecrets("gsk_short");
  const groq = result.secrets.find((s) => s.type === "GROQ_KEY");
  assert.strictEqual(
    groq,
    undefined,
    "Short string should not trigger GROQ_KEY",
  );
}

// ── ANTHROPIC_KEY ──────────────────────────────────────────────────

export function testAnthropicKeyDetected() {
  const text =
    "ANTHROPIC_API_KEY=sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  const result = scanSecrets(text);
  const ant = result.secrets.find((s) => s.type === "ANTHROPIC_KEY");
  assert.ok(ant, "Anthropic key should be detected");
  assert.strictEqual(ant?.severity, "critical");
}

export function testAnthropicKeyNoFalsePositiveOnGenericSk() {
  // Plain "sk-" prefix without "ant-" must not match the Anthropic
  // pattern. (May still match GENERIC_API_KEY — that's expected.)
  const result = scanSecrets("sk-something-else");
  const ant = result.secrets.find((s) => s.type === "ANTHROPIC_KEY");
  assert.strictEqual(ant, undefined);
}

// ── OPENAI_PROJECT_KEY ─────────────────────────────────────────────

export function testOpenAiProjectKeyDetected() {
  const text =
    "OPENAI_API_KEY=sk-proj-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAxyz_";
  const result = scanSecrets(text);
  const proj = result.secrets.find((s) => s.type === "OPENAI_PROJECT_KEY");
  assert.ok(proj, "OpenAI project key should be detected");
  assert.strictEqual(proj?.severity, "critical");
}

export function testOpenAiProjectKeyNoFalsePositiveOnUserKey() {
  // Plain "sk-USER..." (legacy user key shape) is NOT a project key.
  const result = scanSecrets("sk-USERTOKENABCDEFG12345");
  const proj = result.secrets.find((s) => s.type === "OPENAI_PROJECT_KEY");
  assert.strictEqual(proj, undefined);
}

// ── COHERE_KEY ─────────────────────────────────────────────────────

export function testCohereKeyDetectedWithContext() {
  // 40 alphanumeric chars with the `cohere`/`co.` keyword nearby.
  const text = 'COHERE_API_KEY="abcdefghij1234567890ABCDEFGHIJ0987654321"';
  const result = scanSecrets(text);
  const cohere = result.secrets.find((s) => s.type === "COHERE_KEY");
  assert.ok(cohere, "Cohere key should be detected with context keyword");
  assert.strictEqual(cohere?.severity, "critical");
}

export function testCohereKeyNoFalsePositiveOnRandom40Chars() {
  // 40 alphanumerics with no co./cohere/COHERE_API_KEY context — must
  // NOT trigger COHERE_KEY (commit hashes / hashes look like this).
  const text = "abcdefghij1234567890ABCDEFGHIJ0987654321";
  const result = scanSecrets(text);
  const cohere = result.secrets.find((s) => s.type === "COHERE_KEY");
  assert.strictEqual(
    cohere,
    undefined,
    "40-char alphanumeric without context should not trigger COHERE_KEY",
  );
}

// ── Cross-pattern sanity ───────────────────────────────────────────

export function testProseDoesNotTriggerNewPatterns() {
  const prose =
    "The quick brown fox jumps over the lazy dog. " +
    "We discussed the API integration. The endpoint is /v1/chat. " +
    "Commit hash: abc123def456789. ";
  const result = scanSecrets(prose);
  for (const t of [
    "GROQ_KEY",
    "ANTHROPIC_KEY",
    "OPENAI_PROJECT_KEY",
    "COHERE_KEY",
  ]) {
    assert.ok(
      !result.secrets.some((s) => s.type === t),
      `Prose should not trigger ${t}`,
    );
  }
}
