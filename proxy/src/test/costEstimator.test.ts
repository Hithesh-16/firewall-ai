import assert from "node:assert";
import { estimateCost } from "../gateway/costEstimator";

// --- Basic cost estimation ---

export async function testEstimateCostReturnsResult() {
  const result = await estimateCost(
    [{ role: "user", content: "Hello world" }],
    "gpt-4"
  );
  assert.ok(result.inputTokens > 0, "Should count input tokens");
  assert.ok(result.estimatedOutputTokens >= 256, "Output estimate should be at least 256");
  assert.ok(result.totalEstimatedCost >= 0, "Cost should be non-negative");
  assert.ok(
    result.method === "tiktoken" || result.method === "heuristic",
    "Should report method"
  );
}

// --- Zero-cost local models ---

export async function testEstimateCostLocalModel() {
  const result = await estimateCost(
    [{ role: "user", content: "Hello" }],
    "llama3" // Local model — not registered, so costs are 0
  );
  assert.strictEqual(result.inputCost, 0, "Unregistered model should have 0 input cost");
  assert.strictEqual(result.outputCost, 0, "Unregistered model should have 0 output cost");
  assert.strictEqual(result.totalEstimatedCost, 0, "Total cost should be 0");
  assert.strictEqual(result.providerName, "unknown", "Unregistered provider should be unknown");
}

// --- Cost rounding ---

export async function testEstimateCostRounding() {
  const result = await estimateCost(
    [{ role: "user", content: "Test" }],
    "gpt-4"
  );
  // Cost should be rounded to 6 decimal places
  const costStr = result.totalEstimatedCost.toString();
  const decimals = costStr.includes(".") ? costStr.split(".")[1].length : 0;
  assert.ok(decimals <= 6, `Cost should have at most 6 decimal places, got ${decimals}`);
}

// --- Output token estimation ---

export async function testEstimateCostOutputTokens() {
  // With very few input tokens, output should still be at least 256
  const result = await estimateCost(
    [{ role: "user", content: "Hi" }],
    "gpt-4"
  );
  assert.strictEqual(result.estimatedOutputTokens, 256, "Min output should be 256");
}
