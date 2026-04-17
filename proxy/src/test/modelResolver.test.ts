/**
 * Tests for Phase I.I1 — provider:model-id resolver.
 * SECURITY_HARDENING_PLAN.md.
 */

import assert from "node:assert";
import {
  isProviderPrefixed,
  listKnownProviders,
  parseModelId,
  resolveModelId,
} from "../gateway/modelResolver";

// ── parseModelId ────────────────────────────────────────────────

export function testParseOpenAiGpt4o() {
  const r = parseModelId("openai:gpt-4o");
  assert.strictEqual(r.provider, "openai");
  assert.strictEqual(r.model, "gpt-4o");
  assert.strictEqual(r.resolved, true);
}

export function testParseAnthropicClaude() {
  const r = parseModelId("anthropic:claude-sonnet-4-6");
  assert.strictEqual(r.provider, "anthropic");
  assert.strictEqual(r.model, "claude-sonnet-4-6");
  assert.strictEqual(r.resolved, true);
}

export function testParseGeminiAlias() {
  const r = parseModelId("google:gemini-2.5-pro");
  assert.strictEqual(r.provider, "gemini", "google should alias to gemini");
  assert.strictEqual(r.model, "gemini-2.5-pro");
  assert.strictEqual(r.resolved, true);
}

export function testParseOllamaModelTag() {
  // Ollama model tags contain `:` (e.g. `llama3.1:8b`). The prefix
  // "llama3.1" is NOT a known provider, so the whole string should
  // stay as a bare model.
  const r = parseModelId("llama3.1:8b");
  assert.strictEqual(r.provider, undefined);
  assert.strictEqual(r.model, "llama3.1:8b");
  assert.strictEqual(r.resolved, false);
}

export function testParseOllamaExplicitPrefix() {
  // With explicit `ollama:` prefix, it resolves.
  const r = parseModelId("ollama:llama3.1:8b");
  assert.strictEqual(r.provider, "ollama");
  assert.strictEqual(r.model, "llama3.1:8b");
  assert.strictEqual(r.resolved, true);
}

export function testParseBareModel() {
  const r = parseModelId("gpt-4o");
  assert.strictEqual(r.provider, undefined);
  assert.strictEqual(r.model, "gpt-4o");
  assert.strictEqual(r.resolved, false);
}

export function testParseEmptyString() {
  const r = parseModelId("");
  assert.strictEqual(r.provider, undefined);
  assert.strictEqual(r.model, "");
  assert.strictEqual(r.resolved, false);
}

export function testParseGroqProvider() {
  const r = parseModelId("groq:llama-3.3-70b-versatile");
  assert.strictEqual(r.provider, "groq");
  assert.strictEqual(r.model, "llama-3.3-70b-versatile");
  assert.strictEqual(r.resolved, true);
}

export function testParseDeepseek() {
  const r = parseModelId("deepseek:deepseek-chat");
  assert.strictEqual(r.provider, "deepseek");
  assert.strictEqual(r.model, "deepseek-chat");
  assert.strictEqual(r.resolved, true);
}

// ── resolveModelId ──────────────────────────────────────────────

export function testResolveWithDefault() {
  const r = resolveModelId("gpt-4o", "openai");
  assert.strictEqual(r.provider, "openai");
  assert.strictEqual(r.model, "gpt-4o");
}

export function testResolveWithPrefix() {
  const r = resolveModelId("anthropic:claude-sonnet-4-6");
  assert.strictEqual(r.provider, "anthropic");
  assert.strictEqual(r.model, "claude-sonnet-4-6");
}

// ── isProviderPrefixed ──────────────────────────────────────────

export function testIsPrefixedTrue() {
  assert.strictEqual(isProviderPrefixed("openai:gpt-4o"), true);
}

export function testIsPrefixedFalse() {
  assert.strictEqual(isProviderPrefixed("gpt-4o"), false);
}

// ── listKnownProviders ──────────────────────────────────────────

export function testListKnownProvidersHasOpenai() {
  const list = listKnownProviders();
  assert.ok(list.includes("openai"));
  assert.ok(list.includes("anthropic"));
  assert.ok(list.includes("gemini"));
  assert.ok(list.includes("ollama"));
  assert.ok(list.length >= 50, `Expected 50+ providers, got ${list.length}`);
}
