/**
 * Red Team Routes
 *
 * Automated adversarial testing: generate probes, evaluate model responses,
 * and browse the probe library.
 *
 * Endpoints:
 *   POST /api/redteam/probes   — Generate adversarial probes
 *   POST /api/redteam/evaluate — Evaluate a response against a probe
 *   GET  /api/redteam/library  — Get probe library categories
 */

import { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth/authMiddleware";
import {
  generateProbes,
  evaluateResponse,
  getProbeLibrary,
} from "../agents/redTeamAgent";

// ── Schemas ────────────────────────────────────────────────────────────────

const generateProbesSchema = z.object({
  targetModel: z.string().max(256).optional(),
  categories: z.array(z.string()).optional(),
  maxProbes: z.number().int().min(1).max(100).optional().default(10),
});

const evaluateResponseSchema = z.object({
  probe: z.object({
    id: z.string().min(1),
    text: z.string().min(1),
    category: z.string().min(1),
    expectedBehavior: z.string().optional(),
  }),
  response: z.string().min(1),
});

// ── Route Registration ─────────────────────────────────────────────────────

export async function registerRedTeamRoutes(
  app: FastifyInstance,
): Promise<void> {
  /**
   * POST /api/redteam/probes — Generate adversarial probes
   *
   * Creates a set of adversarial prompts targeting the specified model
   * and attack categories.
   */
  app.post(
    "/api/redteam/probes",
    { preHandler: requireAuth },
    async (request, reply) => {
      const parsed = generateProbesSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "Invalid payload", details: parsed.error.flatten() });
      }

      const { targetModel, categories, maxProbes } = parsed.data;
      return generateProbes(targetModel, categories, maxProbes);
    },
  );

  /**
   * POST /api/redteam/evaluate — Evaluate a response against a probe
   *
   * Checks whether the model response to a probe indicates a vulnerability.
   */
  app.post(
    "/api/redteam/evaluate",
    { preHandler: requireAuth },
    async (request, reply) => {
      const parsed = evaluateResponseSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "Invalid payload", details: parsed.error.flatten() });
      }

      const { probe, response } = parsed.data;
      return evaluateResponse(probe, response);
    },
  );

  /**
   * GET /api/redteam/library — Get probe library categories
   *
   * Returns the available categories and their probe counts.
   */
  app.get("/api/redteam/library", { preHandler: requireAuth }, async () => {
    return getProbeLibrary();
  });
}
