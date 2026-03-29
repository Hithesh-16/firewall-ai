import assert from "node:assert";
import {
  resolveEncoding,
  estimateTokensFallback,
  countTokens,
  countMessageTokens,
} from "../gateway/tokenCounter";

// --- resolveEncoding ---

export function testResolveEncodingGPT4() {
  assert.strictEqual(resolveEncoding("gpt-4"), "cl100k_base");
}

export function testResolveEncodingGPT4o() {
  assert.strictEqual(resolveEncoding("gpt-4o-mini"), "o200k_base");
}

export function testResolveEncodingClaude() {
  assert.strictEqual(resolveEncoding("claude-3-sonnet"), "cl100k_base");
}

export function testResolveEncodingO1() {
  assert.strictEqual(resolveEncoding("o1-preview"), "o200k_base");
}

export function testResolveEncodingUnknown() {
  assert.strictEqual(resolveEncoding("some-unknown-model"), "cl100k_base");
}

// --- estimateTokensFallback ---

export function testFallbackMinimumOne() {
  assert.strictEqual(estimateTokensFallback(""), 1);
}

export function testFallbackApproximation() {
  // "Hello world" = 11 chars → ceil(11/4) = 3
  assert.strictEqual(estimateTokensFallback("Hello world"), 3);
}

// --- countTokens ---

export async function testCountTokensReturnsResult() {
  const result = await countTokens("Hello world", "gpt-4");
  assert.ok(result.tokens > 0, "Should count at least 1 token");
  assert.ok(
    result.method === "tiktoken" || result.method === "heuristic",
    "Method should be tiktoken or heuristic"
  );
}

export async function testCountTokensFallsBackGracefully() {
  // Even with a bizarre model name, should still return a result
  const result = await countTokens("test text", "nonexistent-model-xyz");
  assert.ok(result.tokens > 0, "Should fall back and count tokens");
}

// --- countMessageTokens ---

export async function testCountMessageTokensBasic() {
  const result = await countMessageTokens(
    [{ role: "user", content: "Hello" }],
    "gpt-4"
  );
  assert.ok(result.tokens > 0, "Should count message tokens");
  assert.strictEqual(result.perMessage.length, 1, "Should have 1 per-message entry");
  assert.strictEqual(result.perMessage[0].role, "user");
}

export async function testCountMessageTokensMultipleMessages() {
  const result = await countMessageTokens(
    [
      { role: "system", content: "You are helpful." },
      { role: "user", content: "What is 2+2?" },
    ],
    "gpt-4"
  );
  assert.strictEqual(result.perMessage.length, 2);
  assert.ok(result.tokens > result.perMessage[0].tokens, "Total > first message");
}

export async function testCountMessageTokensMultimodal() {
  const result = await countMessageTokens(
    [
      {
        role: "user",
        content: [
          { type: "text", text: "Describe this image" },
          { type: "image_url", image_url: { url: "https://example.com/img.png" } },
        ],
      },
    ],
    "gpt-4o"
  );
  // Image adds ~1024 tokens estimate
  assert.ok(result.tokens > 100, "Multimodal should include image token estimate");
}
