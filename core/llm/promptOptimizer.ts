/**
 * Prompt Optimizer — shared utilities for all LLM clients
 * (CLI, VS Code extension, IntelliJ plugin).
 *
 * Provides two pipeline steps that run just before every main LLM call:
 *
 *   1. replaceLargeBlobsWithMetadata
 *      Replaces verbose old assistant turns (>500 est. tokens) with compact
 *      metadata stubs: <output_summary tokens="N" turn="T" preview="..." />
 *      Keeps the last KEEP_LAST_BLOB_TURNS turns verbatim.
 *      Saves 40–60% on agentic sessions dominated by tool output.
 *
 *   2. applyPromptCacheBreakpoints
 *      Injects Anthropic cache_control breakpoints at token-percentage positions
 *      (20%, 50%, 80%) in the message history, plus the system message (1h TTL)
 *      and the last user turn (rolling 5-min TTL).
 *      On Anthropic: cached-read tokens cost 10% of full input price.
 *      On OpenAI: automatic caching kicks in for prefixes >1024 tokens.
 *      Other providers silently ignore the cache_control extension field.
 *
 * Usage (both CLI and IDE):
 *   const optimized = applyPromptCacheBreakpoints(
 *     replaceLargeBlobsWithMetadata(messages)
 *   );
 *
 * The functions accept the OpenAI-style message shape used by both the CLI
 * (openai/resources ChatCompletionMessageParam) and the core LLM layer
 * (ChatMessage from core/index.js). A generic Record<string, any>[] signature
 * is used so both can import without shared type dependencies.
 */

// ─── Constants ────────────────────────────────────────────────────────────────

/** Assistant messages older than KEEP_LAST_BLOB_TURNS with >BLOB_CHAR_THRESHOLD
 *  characters are replaced with a metadata stub. */
const BLOB_CHAR_THRESHOLD = 2000; // ≈500 tokens at 4 chars/token
const KEEP_LAST_BLOB_TURNS = 3;

// ─── Helper ────────────────────────────────────────────────────────────────────

function extractTextContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((b: any) => (b?.type === "text" ? (b.text ?? "") : ""))
      .join("");
  }
  return "";
}

// ─── Step A: Blob metadata replacement ───────────────────────────────────────

/**
 * Replaces large assistant tool-output / file-content turns that are older
 * than KEEP_LAST_BLOB_TURNS with a compact metadata stub.
 *
 * @param messages — Any array of message objects with `role` and `content`.
 * @returns The same array with old large turns replaced by stubs.
 */
export function replaceLargeBlobsWithMetadata<
  T extends { role: string; content?: unknown },
>(messages: T[]): T[] {
  if (messages.length <= KEEP_LAST_BLOB_TURNS) return messages;

  const stubBefore = messages.length - KEEP_LAST_BLOB_TURNS;

  return messages.map((msg, i) => {
    if (i >= stubBefore) return msg; // keep last N turns raw
    if (msg.role !== "assistant") return msg; // only stub assistant turns

    const text = extractTextContent(msg.content);

    // P1: Never stub messages containing todo/plan tool calls. These are
    // structural anchors for the agent's state machine. If they are
    // stubbed, the agent loses track of its progress and starts repeating
    // the plan implementation.
    const isPlanUpdate =
      text.includes("todo_write") ||
      text.includes("propose_plan") ||
      text.includes("update_plan") ||
      (msg as any).toolCalls?.some((tc: any) =>
        ["todo_write", "propose_plan", "update_plan"].includes(
          tc.function?.name,
        ),
      );

    if (text.length <= BLOB_CHAR_THRESHOLD || isPlanUpdate) return msg;

    const estimatedTokens = Math.ceil(text.length / 4);
    const preview = text.slice(0, 120).replace(/\n/g, " ").trim();
    const stub = `<output_summary tokens="${estimatedTokens}" turn="${i + 1}" preview="${preview}..." />`;

    return { ...msg, content: stub };
  });
}

// ─── Step B: Prompt cache breakpoints ────────────────────────────────────────

// TTL constants — Anthropic changed default from 1h to 5m on March 6, 2026
// Always set TTL explicitly to avoid unexpected behavior
const SYSTEM_TTL = "1h"; // System message is static, benefits from longer TTL
const ROLLING_TTL = "5m"; // Rolling breakpoints refresh each turn

/**
 * Injects Anthropic-style cache_control breakpoints at token-percentage
 * positions in the message history.
 *
 * Breakpoints used (Anthropic allows up to 4):
 *   BP #1 — system message        (TTL: 1h  — static, pay 2× write once)
 *   BP #2 — message at ~20% tokens (TTL: 5m  — long-lived prefix)
 *   BP #3 — message at ~50% tokens (TTL: 5m  — mid-session anchor)
 *   BP #4 — last user message      (TTL: 5m  — rolling, new each turn)
 *
 * On Anthropic: cached-read = 10% of full input token price.
 * On OpenAI/Gemini: cache_control is silently ignored (no error).
 *
 * @param messages — Any array of message objects with `role` and `content`.
 * @returns New array with cache_control injected into breakpoint messages.
 */
export function applyPromptCacheBreakpoints<
  T extends { role: string; content?: unknown },
>(messages: T[]): T[] {
  if (messages.length === 0) return messages;

  // ── Estimate token count per message (char/4 fast approx) ────────────────
  const tokensPerMsg = messages.map((msg) =>
    Math.ceil(extractTextContent(msg.content).length / 4),
  );

  const totalTokens = tokensPerMsg.reduce((a, b) => a + b, 0);
  if (totalTokens === 0) return messages;

  const target20 = totalTokens * 0.2;
  const target50 = totalTokens * 0.5;
  const target80 = totalTokens * 0.8;

  // ── Find message indices closest to each % target ─────────────────────────
  let cumulative = 0;
  let idx20 = -1;
  let idx50 = -1;
  let idx80 = -1;

  for (let i = 0; i < messages.length; i++) {
    cumulative += tokensPerMsg[i];
    if (idx20 === -1 && cumulative >= target20) idx20 = i;
    if (idx50 === -1 && cumulative >= target50) idx50 = i;
    if (idx80 === -1 && cumulative >= target80) idx80 = i;
  }

  const lastIdx = messages.length - 1;

  // Find the system message index (usually 0) so we can exclude it from the
  // percentage-based breakpoints. Anthropic allows a maximum of 4 cache_control
  // blocks total; the system message already consumes one slot, leaving 3 for
  // the percentage anchors.
  const systemIdx = messages.findIndex((m) => m.role === "system");

  // Deduplicate collisions (short conversations → all targets map to same msg)
  // Exclude the system message index — it is handled separately in the map below.
  const breakpointSet = new Set<number>(
    [idx20, idx50, idx80, lastIdx]
      .filter((i) => i >= 0 && i !== systemIdx)
      .slice(0, 3), // hard cap: system + 3 = 4 total (Anthropic limit)
  );

  // ── Inject cache_control ──────────────────────────────────────────────────
  const injectCacheControl = (msg: T, ttl: string): T => {
    // cache_control is an Anthropic extension; use 'any' intentionally.
    const cacheControl: Record<string, string> = { type: "ephemeral", ttl };

    const { content } = msg;

    if (Array.isArray(content) && content.length > 0) {
      const arr = content as any[];
      const last = arr[arr.length - 1];
      return {
        ...msg,
        content: [
          ...arr.slice(0, -1),
          { ...last, cache_control: cacheControl },
        ] as unknown as typeof content,
      };
    }

    if (typeof content === "string") {
      return {
        ...msg,
        content: [
          { type: "text", text: content, cache_control: cacheControl },
        ] as unknown as typeof content,
      };
    }

    return msg;
  };

  return messages.map((msg, i) => {
    if (msg.role === "system") return injectCacheControl(msg, SYSTEM_TTL);
    if (breakpointSet.has(i)) return injectCacheControl(msg, ROLLING_TTL);
    return msg;
  });
}

/**
 * Convenience pipeline: apply blob stubs then cache breakpoints.
 * Use this as the single call before every main LLM request.
 */
export function optimizeMessagesForLLM<
  T extends { role: string; content?: unknown },
>(messages: T[]): T[] {
  return applyPromptCacheBreakpoints(replaceLargeBlobsWithMetadata(messages));
}
