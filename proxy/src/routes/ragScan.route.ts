/**
 * RAG Scan Routes
 *
 * Scan RAG chunks and documents through the firewall scanner pipeline
 * before they enter the retrieval-augmented generation context.
 *
 * Endpoints:
 *   POST /api/scan/rag/chunk    — Scan a single RAG chunk
 *   POST /api/scan/rag/document — Scan a full document
 */

import { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth/authMiddleware";
import { scanRagChunk, scanRagDocument } from "../scanner/ragScanner";

// ── Schemas ────────────────────────────────────────────────────────────────

const ragChunkSchema = z.object({
  chunk: z.string().min(1),
  source: z.string().max(1024).optional(),
});

const ragDocumentSchema = z.object({
  text: z.string().min(1),
  source: z.string().max(1024).optional(),
});

// ── Route Registration ─────────────────────────────────────────────────────

export async function registerRagScanRoutes(
  app: FastifyInstance,
): Promise<void> {
  /**
   * POST /api/scan/rag/chunk — Scan a single RAG chunk
   *
   * Runs the chunk through secret, PII, entropy, and injection scanners.
   * Returns action (BLOCK/REDACT/ALLOW) with risk details.
   */
  app.post(
    "/api/scan/rag/chunk",
    { preHandler: requireAuth },
    async (request, reply) => {
      const parsed = ragChunkSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "Invalid payload", details: parsed.error.flatten() });
      }

      const { chunk, source } = parsed.data;
      return scanRagChunk(chunk, source);
    },
  );

  /**
   * POST /api/scan/rag/document — Scan a full document
   *
   * Splits document into logical sections and scans each.
   * Returns aggregate result with per-section findings.
   */
  app.post(
    "/api/scan/rag/document",
    { preHandler: requireAuth },
    async (request, reply) => {
      const parsed = ragDocumentSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "Invalid payload", details: parsed.error.flatten() });
      }

      const { text, source } = parsed.data;
      return scanRagDocument(text, source);
    },
  );
}
