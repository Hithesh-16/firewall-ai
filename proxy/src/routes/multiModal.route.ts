/**
 * Multi-Modal Scan Routes
 *
 * Scan non-text content (images via OCR, audio transcripts, structured files)
 * through the firewall scanner pipeline.
 *
 * Endpoints:
 *   POST /api/scan/multimodal/image — Scan OCR text from image
 *   POST /api/scan/multimodal/audio — Scan audio transcript
 *   POST /api/scan/multimodal/file  — Scan structured file content
 */

import { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth/authMiddleware";
import {
  scanImageOcr,
  scanAudioTranscript,
  scanStructuredFile,
} from "../scanner/multiModalScanner";

// ── Schemas ────────────────────────────────────────────────────────────────

const imageSchema = z.object({
  ocrText: z.string().min(1),
  source: z.string().max(1024).optional(),
});

const audioSchema = z.object({
  transcript: z.string().min(1),
  source: z.string().max(1024).optional(),
});

const fileSchema = z.object({
  content: z.string().min(1),
  fileType: z.string().min(1).max(64),
  source: z.string().max(1024).optional(),
});

// ── Route Registration ─────────────────────────────────────────────────────

export async function registerMultiModalRoutes(
  app: FastifyInstance,
): Promise<void> {
  /**
   * POST /api/scan/multimodal/image — Scan OCR text from image
   *
   * Scans extracted OCR text for secrets, PII, and prompt injection
   * patterns that may be embedded in images.
   */
  app.post(
    "/api/scan/multimodal/image",
    { preHandler: requireAuth },
    async (request, reply) => {
      const parsed = imageSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "Invalid payload", details: parsed.error.flatten() });
      }

      const { ocrText, source } = parsed.data;
      return scanImageOcr(ocrText, source);
    },
  );

  /**
   * POST /api/scan/multimodal/audio — Scan audio transcript
   *
   * Scans speech-to-text transcripts for secrets, PII, and
   * injection patterns in voice-based interactions.
   */
  app.post(
    "/api/scan/multimodal/audio",
    { preHandler: requireAuth },
    async (request, reply) => {
      const parsed = audioSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "Invalid payload", details: parsed.error.flatten() });
      }

      const { transcript, source } = parsed.data;
      return scanAudioTranscript(transcript, source);
    },
  );

  /**
   * POST /api/scan/multimodal/file — Scan structured file content
   *
   * Scans content extracted from structured files (CSV, JSON, XML, etc.)
   * for secrets, PII, and injection patterns.
   */
  app.post(
    "/api/scan/multimodal/file",
    { preHandler: requireAuth },
    async (request, reply) => {
      const parsed = fileSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "Invalid payload", details: parsed.error.flatten() });
      }

      const { content, fileType, source } = parsed.data;
      return scanStructuredFile(content, fileType, source);
    },
  );
}
