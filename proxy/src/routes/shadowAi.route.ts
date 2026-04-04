/**
 * Shadow AI Detection Routes
 *
 * Detect unauthorized AI/LLM API calls on the network and manage
 * approved endpoint lists.
 *
 * Endpoints:
 *   POST /api/network/analyze   — Analyze a network request
 *   POST /api/network/approved  — Register approved endpoints
 *   GET  /api/network/stats     — Get detection stats
 *   GET  /api/network/endpoints — Get known LLM endpoints
 */

import { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth/authMiddleware";
import {
  analyzeRequest,
  registerApprovedEndpoints,
  getDetectionStats,
  getKnownEndpoints,
} from "../network/shadowAiDetector";

// ── Schemas ────────────────────────────────────────────────────────────────

const networkRequestSchema = z.object({
  url: z.string().min(1),
  method: z.string().min(1),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.string().optional(),
  sourceIp: z.string().optional(),
  timestamp: z.number().optional(),
});

const approvedEndpointsSchema = z.object({
  endpoints: z
    .array(
      z.object({
        url: z.string().min(1),
        name: z.string().min(1),
        provider: z.string().optional(),
        approvedBy: z.string().optional(),
      }),
    )
    .min(1)
    .max(500),
});

// ── Route Registration ─────────────────────────────────────────────────────

export async function registerShadowAiRoutes(
  app: FastifyInstance,
): Promise<void> {
  /**
   * POST /api/network/analyze — Analyze a network request
   *
   * Checks whether the request targets a known AI/LLM endpoint
   * and whether it is on the approved list.
   */
  app.post(
    "/api/network/analyze",
    { preHandler: requireAuth },
    async (request, reply) => {
      const parsed = networkRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "Invalid payload", details: parsed.error.flatten() });
      }

      return analyzeRequest(parsed.data);
    },
  );

  /**
   * POST /api/network/approved — Register approved endpoints
   *
   * Adds endpoints to the approved list. Requests matching these
   * endpoints will not be flagged as shadow AI.
   */
  app.post(
    "/api/network/approved",
    { preHandler: requireAuth },
    async (request, reply) => {
      const parsed = approvedEndpointsSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "Invalid payload", details: parsed.error.flatten() });
      }

      const { endpoints } = parsed.data;
      return registerApprovedEndpoints(endpoints);
    },
  );

  /**
   * GET /api/network/stats — Get detection stats
   *
   * Returns aggregate statistics on shadow AI detections.
   */
  app.get("/api/network/stats", { preHandler: requireAuth }, async () => {
    return getDetectionStats();
  });

  /**
   * GET /api/network/endpoints — Get known LLM endpoints
   *
   * Returns the list of known AI/LLM API endpoints used for detection.
   */
  app.get("/api/network/endpoints", { preHandler: requireAuth }, async () => {
    return getKnownEndpoints();
  });
}
