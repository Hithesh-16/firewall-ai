/**
 * Grounding Routes
 *
 * Check whether LLM output is grounded in provided source material
 * and extract verifiable claims from text.
 *
 * Endpoints:
 *   POST /api/grounding/check  — Check grounding of output against sources
 *   POST /api/grounding/claims — Extract claims from text
 */

import { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth/authMiddleware";
import { computeGrounding, extractClaims } from "../scanner/groundingEngine";

// ── Schemas ────────────────────────────────────────────────────────────────

const groundingCheckSchema = z.object({
  output: z.string().min(1),
  sources: z
    .array(
      z.object({
        id: z.string().min(1),
        content: z.string().min(1),
        title: z.string().optional(),
      }),
    )
    .min(1)
    .max(100),
});

const extractClaimsSchema = z.object({
  text: z.string().min(1),
});

// ── Route Registration ─────────────────────────────────────────────────────

export async function registerGroundingRoutes(
  app: FastifyInstance,
): Promise<void> {
  /**
   * POST /api/grounding/check — Check grounding of output against sources
   *
   * Compares LLM output against provided source documents to detect
   * hallucinated or unsupported claims.
   */
  app.post(
    "/api/grounding/check",
    { preHandler: requireAuth },
    async (request, reply) => {
      const parsed = groundingCheckSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "Invalid payload", details: parsed.error.flatten() });
      }

      const { output, sources } = parsed.data;
      return computeGrounding(output, sources);
    },
  );

  /**
   * POST /api/grounding/claims — Extract claims from text
   *
   * Extracts verifiable factual claims from the given text
   * for downstream grounding checks.
   */
  app.post(
    "/api/grounding/claims",
    { preHandler: requireAuth },
    async (request, reply) => {
      const parsed = extractClaimsSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "Invalid payload", details: parsed.error.flatten() });
      }

      const { text } = parsed.data;
      const claims = extractClaims(text);
      return { claims };
    },
  );
}
