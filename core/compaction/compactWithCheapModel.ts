/**
 * Cheap-model compaction — replaces the flagship-model compaction call.
 *
 * Uses a template-driven structured prompt instead of free-form "summarize
 * this conversation", which produces more useful and consistent summaries at
 * 3–4× lower cost (Haiku 4.5 or gpt-4o-mini).
 *
 * Architecture mirrors Claude Code's three-layer design:
 *   Layer 1 — Microcompaction: Tool outputs > 2KB are stubbed out inline.
 *   Layer 2 — Structured summarization via weak model.
 *   Layer 3 — Rehydration: Continuation instruction appended so agent resumes.
 */

import type { ModelConfig } from "@ai-firewall/config-yaml";
import type { BaseLlmApi } from "@ai-firewall/openai-adapters";
import type { ChatHistoryItem, MessageContent } from "../index.js";

// The maximum inline bytes for a tool result before it gets stubbed out.
const TOOL_OUTPUT_STUB_THRESHOLD_BYTES = 2048; // 2 KB

// How many recent tool results to keep verbatim (the rest are stubbed).
const KEEP_LAST_TOOL_RESULTS = 3;

// Weak-model IDs — first match that the caller's API supports wins.
// The caller's llmApi already has provider/key wired in, so these are
// just the model name strings.
const WEAK_MODEL_CANDIDATES = [
  "claude-haiku-4-5",
  "claude-3-haiku-20240307",
  "gpt-4o-mini",
  "gemini-1.5-flash",
];

/**
 * Returns the model string to use for compaction.
 * Prefer the first candidate that matches what the caller's config supports;
 * fall back to the full model if nothing matched (still better than crashing).
 */
export function resolveWeakModel(primaryModel: string): string {
  for (const candidate of WEAK_MODEL_CANDIDATES) {
    // Simple heuristic: if the primary model is from the same provider
    // as the candidate, use that candidate.
    const isAnthropic = primaryModel.includes("claude");
    const isOpenAI = primaryModel.includes("gpt");
    const isGemini = primaryModel.includes("gemini");

    if (isAnthropic && candidate.includes("haiku")) return candidate;
    if (isOpenAI && candidate.includes("gpt-4o-mini")) return candidate;
    if (isGemini && candidate.includes("flash")) return candidate;
  }
  // Fall back to the primary model (no cost saving but won't break)
  return primaryModel;
}

// ─── Layer 1: Microcompaction ─────────────────────────────────────────────────

/**
 * Replaces large tool results with a compact stub.
 * Only keeps the most recent KEEP_LAST_TOOL_RESULTS verbatim.
 */
export function microcompactToolOutputs(
  history: ChatHistoryItem[],
): ChatHistoryItem[] {
  // Find all tool-result positions (user turn that contains tool_use_id responses)
  const toolResultIndices: number[] = [];
  history.forEach((item, i) => {
    const content = item.message.content;
    if (
      item.message.role === "user" &&
      Array.isArray(content) &&
      content.some((c: any) => c.type === "tool_result")
    ) {
      toolResultIndices.push(i);
    }
  });

  // Determine which tool-result turns to stub out (all except last N)
  const stubIndices = new Set(
    toolResultIndices.slice(
      0,
      Math.max(0, toolResultIndices.length - KEEP_LAST_TOOL_RESULTS),
    ),
  );

  return history.map((item, i) => {
    if (!stubIndices.has(i)) return item;

    const content = item.message.content;
    if (!Array.isArray(content)) return item;

    const compacted = content.map((c: any) => {
      if (c.type !== "tool_result") return c;

      const text =
        typeof c.content === "string"
          ? c.content
          : JSON.stringify(c.content ?? "");
      const bytes = Buffer.byteLength(text, "utf8");

      if (bytes <= TOOL_OUTPUT_STUB_THRESHOLD_BYTES) return c;

      // Build a stub — preserves the tool_use_id so the conversation
      // structure stays valid (Anthropic requires tool results to match
      // tool_use blocks 1:1).
      const lines = text.split("\n").slice(0, 3).join(" ").slice(0, 120);
      return {
        ...c,
        content: `<tool_result_stub bytes="${bytes}" preview="${lines.replace(/"/g, "'")}..." />`,
      };
    });

    return {
      ...item,
      message: { ...item.message, content: compacted as any },
    };
  });
}

// ─── Layer 2: Structured summarization ───────────────────────────────────────

const COMPACTION_SYSTEM_PROMPT = `You are a precise conversation summariser for an AI coding assistant.
Your output will replace the full conversation history, so include every detail needed to continue work without losing context.`;

const COMPACTION_TEMPLATE = `Summarise the conversation below into the following structured sections.
Be concise but complete — each line under a section should be a single clear statement.

## User Intent
What the user is ultimately trying to accomplish.

## Technical Decisions
Key implementation choices made (languages, frameworks, APIs, patterns chosen).

## Files Touched
List each file that was created, modified, or deleted and a one-line reason why.

## Errors & Fixes
Any errors that occurred and how they were resolved.

## Pending Tasks
What remains to be done (in order of priority).

## Next Step
The very next action the assistant should take when this conversation resumes.

--- CONVERSATION ---
{{conversation}}
--- END CONVERSATION ---`;

/**
 * Builds the structured compaction prompt from chat history.
 */
export function buildCompactionPrompt(history: ChatHistoryItem[]): string {
  const conversation = history
    .filter((item) => item.message.role !== "system")
    .map((item) => {
      const role = item.message.role.toUpperCase();
      const content =
        typeof item.message.content === "string"
          ? item.message.content
          : JSON.stringify(item.message.content);
      return `[${role}] ${content.slice(0, 800)}`;
    })
    .join("\n\n");

  return COMPACTION_TEMPLATE.replace("{{conversation}}", conversation);
}

// ─── Layer 3: Rehydration instruction ────────────────────────────────────────

export const REHYDRATION_SUFFIX = `\n\n---\n*This message is a compacted summary of the conversation history. Continue exactly where the work left off without asking the user to recap.*`;

// ─── Export: cheap-model compaction result ────────────────────────────────────

export interface CheapCompactionResult {
  compactedHistory: ChatHistoryItem[];
  compactionContent: string;
  usedWeakModel: string;
}

/**
 * Runs the full three-layer cheap compaction pipeline:
 *   1. Stub large tool outputs (no LLM call)
 *   2. Summarize with weak model using structured template
 *   3. Append rehydration instructions
 *
 * The caller is responsible for invoking the LLM API with the returned
 * prompt and stitching the result back into chat history.
 */
export function prepareCheapCompaction(
  history: ChatHistoryItem[],
  primaryModel: string,
): {
  microcompactedHistory: ChatHistoryItem[];
  compactionPrompt: string;
  weakModel: string;
  systemPrompt: string;
  rehydrationSuffix: string;
} {
  const weakModel = resolveWeakModel(primaryModel);
  const microcompactedHistory = microcompactToolOutputs(history);
  const compactionPrompt = buildCompactionPrompt(microcompactedHistory);

  return {
    microcompactedHistory,
    compactionPrompt,
    weakModel,
    systemPrompt: COMPACTION_SYSTEM_PROMPT,
    rehydrationSuffix: REHYDRATION_SUFFIX,
  };
}
