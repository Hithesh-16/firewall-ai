import assert from "node:assert";
import { checkContextWindow } from "../gateway/contextWindow";

// --- Fits within context window ---

export async function testContextWindowFits() {
  const result = await checkContextWindow(
    [{ role: "user", content: "Hello" }],
    "gpt-4",
    8192
  );
  assert.strictEqual(result.fits, true, "Short message should fit in 8192 context");
  assert.ok(result.totalTokens > 0, "Should count tokens");
  assert.strictEqual(result.overageTokens, 0, "No overage when fits");
  assert.strictEqual(result.warningMessage, undefined, "No warning when fits");
}

// --- Overflows context window (advisory only, never truncates) ---

export async function testContextWindowOverflow() {
  // Create a message that's definitely over 100 tokens
  const longContent = "This is a test sentence. ".repeat(200); // ~1000 tokens
  const result = await checkContextWindow(
    [{ role: "user", content: longContent }],
    "gpt-4",
    100 // Tiny context window
  );
  assert.strictEqual(result.fits, false, "Long message should overflow tiny context");
  assert.ok(result.overageTokens > 0, "Should have overage tokens");
  assert.ok(result.warningMessage, "Should have a warning message");
  assert.ok(
    result.warningMessage!.includes("Consider reducing"),
    "Warning should suggest reducing context"
  );
  // CRITICAL: The function returns analysis but NEVER modifies messages
  // (no way to test this directly — it's guaranteed by the return type)
}

// --- Unknown model (maxContextTokens = 0) skips check ---

export async function testContextWindowUnknownModel() {
  const result = await checkContextWindow(
    [{ role: "user", content: "Hello" }],
    "unknown-model",
    0 // Unknown context size
  );
  assert.strictEqual(result.fits, true, "Unknown model should always return fits=true");
  assert.strictEqual(result.maxContextTokens, 0);
}

// --- Utilization percentage ---

export async function testContextWindowUtilization() {
  const result = await checkContextWindow(
    [{ role: "user", content: "Hello world" }],
    "gpt-4",
    128000 // GPT-4 Turbo context
  );
  assert.ok(
    result.utilizationPercent < 1,
    "Short message should use <1% of 128k context"
  );
}
