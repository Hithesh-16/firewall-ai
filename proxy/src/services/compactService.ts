/**
 * Context Compaction Service
 *
 * Compresses conversation history to reduce token usage while preserving
 * recent context and intent. Modeled after claude-code's microcompact
 * algorithm adapted for our proxy-centric architecture.
 *
 * Three compaction strategies (applied in order):
 *   1. Tool result clearing — replace old tool results with "[cleared]"
 *   2. Message summarization — compress old assistant messages to one line
 *   3. Budget trimming — drop oldest messages if still over budget
 *
 * DESIGN PRINCIPLES:
 * - Proxy INFORMS, never auto-truncates (return compacted + headers)
 * - Recent N messages always preserved verbatim
 * - System prompt always preserved
 * - User intent (last user message) always preserved
 */

import { countMessageTokens, type ChatMessage } from "../gateway/tokenCounter";

// ── Types ──────────────────────────────────────────────────────

export interface CompactInput {
  readonly messages: readonly CompactMessage[];
  readonly model: string;
  /** Max total tokens for the compacted result */
  readonly maxTokens?: number;
  /** Number of recent messages to preserve verbatim (default: 6) */
  readonly keepRecent?: number;
  /** Whether to clear old tool results (default: true) */
  readonly clearToolResults?: boolean;
  /** Whether to summarize old assistant messages (default: true) */
  readonly summarizeOld?: boolean;
  /** Max age in minutes for tool results before clearing (default: 5) */
  readonly toolResultMaxAgeMinutes?: number;
}

export interface CompactMessage {
  readonly role: "system" | "user" | "assistant" | "tool";
  readonly content: string;
  readonly name?: string;
  readonly tool_call_id?: string;
  readonly timestamp?: number;
}

export interface CompactResult {
  readonly messages: CompactMessage[];
  readonly originalTokens: number;
  readonly compactedTokens: number;
  readonly savingsPercent: number;
  readonly strategiesApplied: readonly string[];
  readonly messagesRemoved: number;
  readonly toolResultsCleared: number;
  readonly messagesSummarized: number;
}

// ── Constants ──────────────────────────────────────────────────

const DEFAULT_KEEP_RECENT = 6;
const DEFAULT_TOOL_RESULT_MAX_AGE_MINUTES = 5;
const CLEARED_TOOL_RESULT = "[Old tool result cleared to save context]";
const SUMMARIZED_PREFIX = "[Summarized] ";
const MAX_SUMMARY_LENGTH = 150;

// ── Main compact function ──────────────────────────────────────

export async function compactConversation(
  input: CompactInput,
): Promise<CompactResult> {
  const {
    messages,
    model,
    maxTokens,
    keepRecent = DEFAULT_KEEP_RECENT,
    clearToolResults = true,
    summarizeOld = true,
    toolResultMaxAgeMinutes = DEFAULT_TOOL_RESULT_MAX_AGE_MINUTES,
  } = input;

  if (messages.length === 0) {
    return {
      messages: [],
      originalTokens: 0,
      compactedTokens: 0,
      savingsPercent: 0,
      strategiesApplied: [],
      messagesRemoved: 0,
      toolResultsCleared: 0,
      messagesSummarized: 0,
    };
  }

  // Count original tokens
  const chatMessages: ChatMessage[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));
  const originalCount = await countMessageTokens(chatMessages, model);
  const originalTokens = originalCount.tokens;

  // If no budget or already under budget, return as-is
  if (!maxTokens || originalTokens <= maxTokens) {
    return {
      messages: [...messages],
      originalTokens,
      compactedTokens: originalTokens,
      savingsPercent: 0,
      strategiesApplied: [],
      messagesRemoved: 0,
      toolResultsCleared: 0,
      messagesSummarized: 0,
    };
  }

  const strategiesApplied: string[] = [];
  let toolResultsCleared = 0;
  let messagesSummarized = 0;
  let messagesRemoved = 0;

  // Split into protected (system + recent) and compactable
  const systemMessages = messages.filter((m) => m.role === "system");
  const nonSystem = messages.filter((m) => m.role !== "system");

  const recentCutoff = Math.max(0, nonSystem.length - keepRecent);
  const oldMessages = nonSystem.slice(0, recentCutoff);
  const recentMessages = nonSystem.slice(recentCutoff);

  let compactedOld = [...oldMessages];

  // Strategy 1: Clear old tool results
  if (clearToolResults && compactedOld.length > 0) {
    const now = Date.now();
    const maxAgeMs = toolResultMaxAgeMinutes * 60 * 1000;
    let cleared = 0;

    compactedOld = compactedOld.map((msg) => {
      if (msg.role !== "tool") return msg;

      const isOld = msg.timestamp ? now - msg.timestamp > maxAgeMs : true; // No timestamp = assume old

      if (isOld && msg.content.length > CLEARED_TOOL_RESULT.length) {
        cleared++;
        return { ...msg, content: CLEARED_TOOL_RESULT };
      }
      return msg;
    });

    if (cleared > 0) {
      strategiesApplied.push(`cleared_tool_results:${cleared}`);
      toolResultsCleared = cleared;
    }
  }

  // Strategy 2: Summarize old assistant messages
  if (summarizeOld && compactedOld.length > 0) {
    let summarized = 0;

    compactedOld = compactedOld.map((msg) => {
      if (msg.role !== "assistant") return msg;
      if (msg.content.length <= MAX_SUMMARY_LENGTH) return msg;

      summarized++;
      const summary = summarizeMessage(msg.content);
      return { ...msg, content: summary };
    });

    if (summarized > 0) {
      strategiesApplied.push(`summarized_messages:${summarized}`);
      messagesSummarized = summarized;
    }
  }

  // Reassemble
  let result = [...systemMessages, ...compactedOld, ...recentMessages];

  // Check if under budget now
  const afterStrategyMessages: ChatMessage[] = result.map((m) => ({
    role: m.role,
    content: m.content,
  }));
  const afterCount = await countMessageTokens(afterStrategyMessages, model);

  // Strategy 3: Drop oldest non-system messages if still over budget
  if (maxTokens && afterCount.tokens > maxTokens) {
    const overBy = afterCount.tokens - maxTokens;
    let dropped = 0;

    // Drop from compactedOld (oldest first)
    while (compactedOld.length > 0) {
      const approxTokensSaved = estimateTokens(compactedOld[0].content);
      compactedOld = compactedOld.slice(1);
      dropped++;
      messagesRemoved++;

      if (approxTokensSaved >= overBy / (dropped + 1)) break;
    }

    result = [...systemMessages, ...compactedOld, ...recentMessages];
    strategiesApplied.push(`dropped_oldest:${dropped}`);
  }

  // Final token count
  const finalMessages: ChatMessage[] = result.map((m) => ({
    role: m.role,
    content: m.content,
  }));
  const finalCount = await countMessageTokens(finalMessages, model);
  const compactedTokens = finalCount.tokens;

  const savingsPercent =
    originalTokens > 0
      ? Math.round(((originalTokens - compactedTokens) / originalTokens) * 100)
      : 0;

  return {
    messages: result,
    originalTokens,
    compactedTokens,
    savingsPercent,
    strategiesApplied,
    messagesRemoved,
    toolResultsCleared,
    messagesSummarized,
  };
}

// ── Helpers ────────────────────────────────────────────────────

function summarizeMessage(content: string): string {
  // Take first sentence or first N chars
  const firstSentence = content.match(/^[^.!?\n]+[.!?]/);
  if (firstSentence && firstSentence[0].length <= MAX_SUMMARY_LENGTH) {
    return SUMMARIZED_PREFIX + firstSentence[0];
  }

  const truncated = content.slice(
    0,
    MAX_SUMMARY_LENGTH - SUMMARIZED_PREFIX.length - 3,
  );
  return SUMMARIZED_PREFIX + truncated + "...";
}

function estimateTokens(text: string): number {
  // Quick heuristic — 4 chars per token
  return Math.max(1, Math.ceil(text.length / 4));
}

// ── Time-based compaction check ────────────────────────────────

/**
 * Determine if compaction should be triggered based on time gap.
 * If the last assistant message was more than `gapMinutes` ago,
 * server-side cache is likely cold and we should compact.
 */
export function shouldCompact(
  messages: readonly CompactMessage[],
  gapMinutes = 5,
): boolean {
  const lastAssistant = [...messages]
    .reverse()
    .find((m) => m.role === "assistant" && m.timestamp);

  if (!lastAssistant?.timestamp) return false;

  const gapMs = Date.now() - lastAssistant.timestamp;
  return gapMs > gapMinutes * 60 * 1000;
}
