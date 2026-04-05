/**
 * Threat Intelligence Routes
 *
 * Federated threat intelligence for sharing and querying
 * adversarial signatures across tenants.
 *
 * Endpoints:
 *   POST /api/intelligence/signatures — Publish a threat signature
 *   POST /api/intelligence/query      — Query matching signatures
 *   GET  /api/intelligence/stats      — Get signature stats
 */

import { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth/authMiddleware";
import {
  createSignature,
  publishSignature,
  querySignatures,
  getSignatureStats,
} from "../intelligence/federatedIntel";

// ── Schemas ────────────────────────────────────────────────────────────────

const publishSignatureSchema = z.object({
  tenantId: z.string().min(1).max(256),
  text: z.string().min(1),
  categories: z.array(z.string()).min(1),
  riskScore: z.number().min(0).max(100),
});

const querySignaturesSchema = z.object({
  text: z.string().min(1),
  threshold: z.number().min(0).max(100).optional().default(50),
});

// ── Route Registration ─────────────────────────────────────────────────────

export async function registerIntelligenceRoutes(
  app: FastifyInstance,
): Promise<void> {
  /**
   * POST /api/intelligence/signatures — Publish a threat signature
   *
   * Registers a new adversarial pattern in the shared intelligence store.
   */
  app.post(
    "/api/intelligence/signatures",
    { preHandler: requireAuth },
    async (request, reply) => {
      const parsed = publishSignatureSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "Invalid payload", details: parsed.error.flatten() });
      }

      const { tenantId, text, categories, riskScore } = parsed.data;
      const sig = createSignature(text, categories, riskScore);
      publishSignature(tenantId, sig);
      return sig;
    },
  );

  /**
   * POST /api/intelligence/query — Query matching signatures
   *
   * Searches the intelligence store for signatures matching the input text
   * above the given similarity threshold.
   */
  app.post(
    "/api/intelligence/query",
    { preHandler: requireAuth },
    async (request, reply) => {
      const parsed = querySignaturesSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "Invalid payload", details: parsed.error.flatten() });
      }

      const { text, threshold } = parsed.data;
      return querySignatures(text, threshold);
    },
  );

  /**
   * GET /api/intelligence/stats — Get signature stats
   *
   * Returns aggregate statistics on the threat intelligence store.
   */
  app.get("/api/intelligence/stats", { preHandler: requireAuth }, async () => {
    return getSignatureStats();
  });
}
