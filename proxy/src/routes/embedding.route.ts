/**
 * Embedding Detection Routes
 *
 * ML-based prompt injection detection using embedding similarity.
 * Complements the regex-based scanner with semantic analysis.
 *
 * Endpoints:
 *   POST /api/ml/detect — Detect injection using embedding model
 *   POST /api/ml/train  — Add training examples
 *   GET  /api/ml/stats  — Get model stats
 */

import { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth/authMiddleware";
import {
  detectInjection,
  trainOnExamples,
  getModelStats,
} from "../ml/embeddingDetector";

// ── Schemas ────────────────────────────────────────────────────────────────

const detectSchema = z.object({
  text: z.string().min(1),
  threshold: z.number().min(0).max(1).optional().default(0.85),
});

const trainSchema = z.object({
  examples: z
    .array(
      z.object({
        text: z.string().min(1),
        label: z.enum(["attack", "benign"]),
      }),
    )
    .min(1)
    .max(500),
});

// ── Route Registration ─────────────────────────────────────────────────────

export async function registerEmbeddingRoutes(
  app: FastifyInstance,
): Promise<void> {
  /**
   * POST /api/ml/detect — Detect injection using embedding model
   *
   * Computes embedding similarity against known injection patterns.
   * Returns confidence score and matched categories.
   */
  app.post(
    "/api/ml/detect",
    { preHandler: requireAuth },
    async (request, reply) => {
      const parsed = detectSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "Invalid payload", details: parsed.error.flatten() });
      }

      const { text, threshold } = parsed.data;
      return detectInjection(text, { threshold });
    },
  );

  /**
   * POST /api/ml/train — Add training examples
   *
   * Adds labeled examples to the detection model's training set.
   * Examples are used to improve injection detection accuracy.
   */
  app.post(
    "/api/ml/train",
    { preHandler: requireAuth },
    async (request, reply) => {
      const parsed = trainSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "Invalid payload", details: parsed.error.flatten() });
      }

      const { examples } = parsed.data;
      trainOnExamples(examples);
      return { added: examples.length };
    },
  );

  /**
   * GET /api/ml/stats — Get model stats
   *
   * Returns statistics on the embedding detection model including
   * training set size, accuracy metrics, and last update time.
   */
  app.get("/api/ml/stats", { preHandler: requireAuth }, async () => {
    return getModelStats();
  });
}
