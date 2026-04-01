/**
 * Token Counter Service
 *
 * Provides accurate token counting using js-tiktoken (WASM-based BPE tokenizer).
 * Falls back to character-based heuristic if WASM initialization fails.
 *
 * Design:
 * - Single Responsibility: Only counts tokens, no side effects
 * - Open/Closed: New encodings added via MODEL_ENCODING_MAP, no core logic changes
 * - Dependency Inversion: Consumers depend on the TokenCountResult interface, not implementation
 */

import type { Tiktoken } from "js-tiktoken";

// ── Types (Interface Segregation) ──────────────────────────────────────────

export interface TokenCountResult {
  tokens: number;
  method: "tiktoken" | "heuristic";
}

export interface MessageTokenCountResult extends TokenCountResult {
  perMessage: Array<{ role: string; tokens: number }>;
}

export interface ChatMessage {
  role: string;
  content: string | unknown[];
}

// ── Encoding Resolution ────────────────────────────────────────────────────

type EncodingName = "cl100k_base" | "o200k_base";

/**
 * Maps model name prefixes to BPE encoding.
 * cl100k_base: GPT-4, GPT-3.5, Claude, Gemini, most models
 * o200k_base:  GPT-4o, o1, o3 series (OpenAI's newer encoding)
 */
const MODEL_ENCODING_MAP: Array<{ prefixes: string[]; encoding: EncodingName }> = [
  {
    prefixes: ["gpt-4o", "o1", "o3", "o4", "chatgpt-4o"],
    encoding: "o200k_base",
  },
  {
    prefixes: [
      "gpt-4", "gpt-3.5", "text-embedding",
      "claude", "gemini", "llama", "mistral", "codellama",
      "deepseek", "qwen", "phi", "command",
    ],
    encoding: "cl100k_base",
  },
];

const DEFAULT_ENCODING: EncodingName = "cl100k_base";

export function resolveEncoding(modelName: string): EncodingName {
  const lower = modelName.toLowerCase();
  for (const entry of MODEL_ENCODING_MAP) {
    if (entry.prefixes.some((p) => lower.startsWith(p))) {
      return entry.encoding;
    }
  }
  return DEFAULT_ENCODING;
}

// ── Singleton Encoder Cache ────────────────────────────────────────────────

const encoderCache = new Map<EncodingName, Tiktoken>();
let tiktokenModule: typeof import("js-tiktoken") | null = null;
let tiktokenLoadFailed = false;

async function loadTiktoken(): Promise<typeof import("js-tiktoken") | null> {
  if (tiktokenModule) return tiktokenModule;
  if (tiktokenLoadFailed) return null;

  try {
    tiktokenModule = await import("js-tiktoken");
    return tiktokenModule;
  } catch {
    tiktokenLoadFailed = true;
    return null;
  }
}

async function getEncoder(encoding: EncodingName): Promise<Tiktoken | null> {
  const cached = encoderCache.get(encoding);
  if (cached) return cached;

  const mod = await loadTiktoken();
  if (!mod) return null;

  try {
    const encoder = mod.encodingForModel(
      encoding === "o200k_base" ? "gpt-4o" : "gpt-4"
    );
    encoderCache.set(encoding, encoder);
    return encoder;
  } catch {
    return null;
  }
}

// ── Heuristic Fallback ─────────────────────────────────────────────────────

/**
 * Character-based estimation: ~4 characters per token for English text.
 * Retained as a defensive fallback if WASM initialization fails.
 */
export function estimateTokensFallback(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

// ── Core Token Counting ────────────────────────────────────────────────────

/**
 * Count tokens in a plain string using the model's BPE tokenizer.
 * Falls back to heuristic on error.
 */
export async function countTokens(
  text: string,
  modelName: string
): Promise<TokenCountResult> {
  try {
    const encoding = resolveEncoding(modelName);
    const encoder = await getEncoder(encoding);
    if (encoder) {
      return { tokens: encoder.encode(text).length, method: "tiktoken" };
    }
  } catch {
    // Fall through to heuristic
  }
  return { tokens: estimateTokensFallback(text), method: "heuristic" };
}

/**
 * Count tokens across an array of chat messages.
 * Accounts for per-message overhead (~4 tokens: role, delimiters, priming).
 *
 * Reference: https://github.com/openai/openai-cookbook/blob/main/examples/How_to_count_tokens_with_tiktoken.ipynb
 */
export async function countMessageTokens(
  messages: ChatMessage[],
  modelName: string
): Promise<MessageTokenCountResult> {
  const PER_MESSAGE_OVERHEAD = 4; // <|im_start|>{role}\n ... <|im_end|>\n
  const REPLY_PRIMING = 3; // every reply is primed with <|im_start|>assistant<|message|>

  const encoding = resolveEncoding(modelName);
  let encoder: Tiktoken | null = null;
  let method: "tiktoken" | "heuristic" = "heuristic";

  try {
    encoder = await getEncoder(encoding);
    if (encoder) method = "tiktoken";
  } catch {
    // Fall through to heuristic
  }

  let totalTokens = 0;
  const perMessage: Array<{ role: string; tokens: number }> = [];

  for (const msg of messages) {
    const content = extractTextContent(msg.content);
    let msgTokens: number;

    if (encoder) {
      try {
        msgTokens =
          encoder.encode(msg.role).length +
          encoder.encode(content).length +
          PER_MESSAGE_OVERHEAD;
      } catch {
        msgTokens = estimateTokensFallback(msg.role + content) + PER_MESSAGE_OVERHEAD;
        method = "heuristic";
      }
    } else {
      msgTokens = estimateTokensFallback(msg.role + content) + PER_MESSAGE_OVERHEAD;
    }

    perMessage.push({ role: msg.role, tokens: msgTokens });
    totalTokens += msgTokens;
  }

  totalTokens += REPLY_PRIMING;

  return { tokens: totalTokens, method, perMessage };
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Extract text from message content, handling both string and multimodal array formats.
 * Images are counted as a fixed token estimate (1024 tokens per image).
 */
function extractTextContent(content: string | unknown[]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return String(content ?? "");

  const parts: string[] = [];
  for (const part of content) {
    if (typeof part !== "object" || part === null) continue;
    const p = part as Record<string, unknown>;
    if (p.type === "text" && typeof p.text === "string") {
      parts.push(p.text);
    } else if (p.type === "image_url") {
      // Images consume ~1024 tokens in vision models (high-detail default)
      parts.push("a".repeat(4096)); // 4096 chars ≈ 1024 tokens at 4 chars/token
    }
  }
  return parts.join("\n");
}
