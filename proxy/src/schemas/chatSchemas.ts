/**
 * Centralized Zod Schemas for Chat API
 *
 * Single source of truth for input validation across all chat-related endpoints.
 * Replaces inline schemas scattered across route files.
 *
 * Design:
 * - Single Responsibility: Only defines validation schemas
 * - DRY: Shared between ai.route.ts, estimate.route.ts, and future endpoints
 * - Strict: role is enum (not string), content supports multimodal
 */

import { z } from "zod";

// ── Message Content ────────────────────────────────────────────────────────

/** Content part for multimodal messages (vision, file attachments) */
const contentPartSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text"),
    text: z.string(),
  }),
  z.object({
    type: z.literal("image_url"),
    image_url: z.object({
      url: z.string(),
      detail: z.enum(["auto", "low", "high"]).optional(),
    }),
  }),
]);

/** Message content: either a plain string or array of content parts */
const messageContentSchema = z.union([
  z.string(),
  z.array(contentPartSchema),
]);

// ── Message Role ───────────────────────────────────────────────────────────

/** Strict role enum — rejects invalid roles at the boundary */
const messageRoleSchema = z.enum(["system", "user", "assistant", "tool"]);

// ── Chat Message ───────────────────────────────────────────────────────────

export const chatMessageSchema = z.object({
  role: messageRoleSchema,
  content: messageContentSchema,
  name: z.string().max(256).optional(),
  tool_call_id: z.string().optional(),
});

// ── Metadata ───────────────────────────────────────────────────────────────

export const metadataSchema = z
  .object({
    filePaths: z
      .array(z.string().max(1024))
      .max(100)
      .optional(),
    projectRoot: z.string().max(1024).optional(),
  })
  .optional();

// ── Chat Completion Request ────────────────────────────────────────────────

export const chatCompletionSchema = z.object({
  model: z.string().min(1).max(256),
  messages: z.array(chatMessageSchema).min(1),
  metadata: metadataSchema,
  stream: z.boolean().optional(),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().positive().optional(),
  top_p: z.number().min(0).max(1).optional(),
  stop: z.union([z.string(), z.array(z.string())]).optional(),
});

// ── Estimate Request (same messages, fewer options) ────────────────────────

export const estimateRequestSchema = z.object({
  model: z.string().min(1).max(256),
  messages: z.array(chatMessageSchema).min(1),
  metadata: metadataSchema,
});

// ── Type Exports ───────────────────────────────────────────────────────────

export type ChatMessageInput = z.infer<typeof chatMessageSchema>;
export type ChatCompletionInput = z.infer<typeof chatCompletionSchema>;
export type EstimateRequestInput = z.infer<typeof estimateRequestSchema>;
export type MessageContent = z.infer<typeof messageContentSchema>;

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Extract plain text from message content (string or multimodal array).
 * Used by scanners that operate on raw text.
 */
export function extractTextFromContent(content: string | unknown[] | MessageContent): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return String(content ?? "");

  const parts: string[] = [];
  for (const part of content) {
    if (typeof part !== "object" || part === null) continue;
    const p = part as Record<string, unknown>;
    if (p.type === "text" && typeof p.text === "string") {
      parts.push(p.text);
    }
  }
  return parts.join("\n");
}

/**
 * Merge all message contents into a single text string for scanning.
 * Replaces the inline mergeMessages() in route files.
 */
export function mergeMessagesToText(
  messages: Array<{ role: string; content: string | unknown[] | MessageContent }>
): string {
  return messages
    .map((m) => extractTextFromContent(m.content as MessageContent))
    .join("\n");
}
