/**
 * Cost Estimator Service
 *
 * Pre-computes the estimated cost of an LLM request using real token counts
 * and model pricing data. Returns advisory cost information — never blocks.
 *
 * Design:
 * - Single Responsibility: Only estimates cost, no routing decisions
 * - Open/Closed: New pricing models added via Model table, no code changes
 * - Dependency Inversion: Depends on TokenCountResult interface, not tokenCounter impl
 */

import { countMessageTokens, type ChatMessage } from "./tokenCounter";
import { findModelByName } from "./modelService";
import { getProviderById } from "./providerService";

// ── Types ──────────────────────────────────────────────────────────────────

export interface CostEstimate {
  /** Actual input token count (via tiktoken or heuristic) */
  inputTokens: number;
  /** Estimated output tokens (heuristic: max of 256 or 25% of input) */
  estimatedOutputTokens: number;
  /** Input cost in dollars */
  inputCost: number;
  /** Estimated output cost in dollars */
  outputCost: number;
  /** Total estimated cost (input + output) */
  totalEstimatedCost: number;
  /** Tokenizer method used */
  method: "tiktoken" | "heuristic";
  /** Provider name (for display) */
  providerName: string;
  /** Model name as registered */
  modelName: string;
  /** Max context tokens for this model (0 if unknown) */
  maxContextTokens: number;
}

// ── Core Function ──────────────────────────────────────────────────────────

/**
 * Estimate the cost of sending messages to a model.
 *
 * @param messages - Chat messages to estimate
 * @param modelName - Model identifier
 * @returns Cost estimate with token counts and pricing breakdown
 */
export async function estimateCost(
  messages: ChatMessage[],
  modelName: string
): Promise<CostEstimate> {
  const counted = await countMessageTokens(messages, modelName);

  // Estimate output tokens: max(256, 25% of input) — reasonable default
  const estimatedOutputTokens = Math.max(256, Math.floor(counted.tokens * 0.25));

  // Look up registered model for pricing
  const registeredModel = findModelByName(modelName);
  let inputCostPer1k = 0;
  let outputCostPer1k = 0;
  let providerName = "unknown";
  let maxContextTokens = 0;
  let resolvedModelName = modelName;

  if (registeredModel) {
    inputCostPer1k = registeredModel.inputCostPer1k;
    outputCostPer1k = registeredModel.outputCostPer1k;
    maxContextTokens = registeredModel.maxContextTokens;
    resolvedModelName = registeredModel.modelName;

    const provider = getProviderById(registeredModel.providerId);
    if (provider) {
      providerName = provider.name;
    }
  }

  const inputCost = (counted.tokens / 1000) * inputCostPer1k;
  const outputCost = (estimatedOutputTokens / 1000) * outputCostPer1k;

  return {
    inputTokens: counted.tokens,
    estimatedOutputTokens,
    inputCost: roundCost(inputCost),
    outputCost: roundCost(outputCost),
    totalEstimatedCost: roundCost(inputCost + outputCost),
    method: counted.method,
    providerName,
    modelName: resolvedModelName,
    maxContextTokens,
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Round cost to 6 decimal places to avoid floating point artifacts */
function roundCost(cost: number): number {
  return Math.round(cost * 1_000_000) / 1_000_000;
}
