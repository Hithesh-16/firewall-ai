/**
 * Context Window Advisory Service
 *
 * Checks whether a set of messages fits within a model's context window.
 * ADVISORY ONLY — never truncates or modifies messages.
 * Returns analysis so the client can warn the user and let them decide.
 *
 * Design principle: "Inform, don't control"
 * - This module has ZERO side effects
 * - It does NOT modify the messages array
 * - It does NOT block requests
 * - Clients read X-AF-Context-* headers and show warnings to the user
 */

import { countMessageTokens, type ChatMessage } from "./tokenCounter";

// ── Types ──────────────────────────────────────────────────────────────────

export interface ContextWindowCheck {
  /** Whether the messages fit within the context window */
  fits: boolean;
  /** Total tokens across all messages */
  totalTokens: number;
  /** Model's maximum context window size */
  maxContextTokens: number;
  /** How many tokens over the limit (0 if fits) */
  overageTokens: number;
  /** Percentage of context window used (can exceed 100%) */
  utilizationPercent: number;
  /** Tokenizer method used */
  method: "tiktoken" | "heuristic";
  /** Human-readable warning message (only when !fits) */
  warningMessage?: string;
}

// ── Default reserve for output ─────────────────────────────────────────────

const DEFAULT_OUTPUT_RESERVE = 4096;

// ── Core Function ──────────────────────────────────────────────────────────

/**
 * Check whether messages fit within the model's context window.
 *
 * @param messages - Chat messages to analyze
 * @param modelName - Model identifier for tokenizer resolution
 * @param maxContextTokens - Maximum context tokens for the model (0 = unknown, skip check)
 * @param reserveForOutput - Tokens to reserve for the model's response (default: 4096)
 * @returns Advisory result — never modifies input, never blocks
 */
export async function checkContextWindow(
  messages: ChatMessage[],
  modelName: string,
  maxContextTokens: number,
  reserveForOutput: number = DEFAULT_OUTPUT_RESERVE
): Promise<ContextWindowCheck> {
  // Unknown model context → assume it fits, no warning
  if (!maxContextTokens || maxContextTokens <= 0) {
    const counted = await countMessageTokens(messages, modelName);
    return {
      fits: true,
      totalTokens: counted.tokens,
      maxContextTokens: 0,
      overageTokens: 0,
      utilizationPercent: 0,
      method: counted.method,
    };
  }

  const counted = await countMessageTokens(messages, modelName);
  const effectiveLimit = maxContextTokens - reserveForOutput;
  const fits = counted.tokens <= effectiveLimit;
  const overageTokens = fits ? 0 : counted.tokens - effectiveLimit;
  const utilizationPercent = Math.round((counted.tokens / maxContextTokens) * 100);

  const result: ContextWindowCheck = {
    fits,
    totalTokens: counted.tokens,
    maxContextTokens,
    overageTokens,
    utilizationPercent,
    method: counted.method,
  };

  if (!fits) {
    result.warningMessage =
      `Prompt uses ${counted.tokens.toLocaleString()} tokens ` +
      `(${utilizationPercent}% of ${maxContextTokens.toLocaleString()} limit). ` +
      `Model needs ~${reserveForOutput.toLocaleString()} tokens reserved for output. ` +
      `Consider reducing context by ${overageTokens.toLocaleString()} tokens.`;
  }

  return result;
}
