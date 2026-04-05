/**
 * Multi-Turn Scan Routes
 *
 * Track conversation sessions for cumulative risk analysis.
 * Detects multi-turn prompt injection attacks that spread payloads
 * across individual messages.
 *
 * Endpoints:
 *   POST   /api/scan/multi-turn              — Record a turn and get session risk
 *   GET    /api/scan/multi-turn/:sessionId    — Get current session risk
 *   DELETE /api/scan/multi-turn/expired       — Clean expired sessions
 */

import { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth/authMiddleware";
import {
  trackTurn,
  getSessionRisk,
  cleanExpiredSessions,
} from "../scanner/multiTurnTracker";

// ── Schemas ────────────────────────────────────────────────────────────────

const recordTurnSchema = z.object({
  sessionId: z.string().min(1).max(256),
  text: z.string().min(1),
  riskScore: z.number().min(0).max(100),
  categories: z.array(z.string()).optional(),
});

const sessionIdParamSchema = z.object({
  sessionId: z.string().min(1).max(256),
});

// ── Route Registration ─────────────────────────────────────────────────────

export async function registerMultiTurnRoutes(
  app: FastifyInstance,
): Promise<void> {
  /**
   * POST /api/scan/multi-turn — Record a turn and get session risk
   *
   * Adds the turn to the session history and returns the cumulative
   * risk assessment including escalation detection.
   */
  app.post(
    "/api/scan/multi-turn",
    { preHandler: requireAuth },
    async (request, reply) => {
      const parsed = recordTurnSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "Invalid payload", details: parsed.error.flatten() });
      }

      const { sessionId, text, riskScore, categories } = parsed.data;
      return trackTurn(sessionId, text, {
        score: riskScore,
        matches: (categories ?? []).map((pattern) => ({ pattern })),
      });
    },
  );

  /**
   * GET /api/scan/multi-turn/:sessionId — Get current session risk
   *
   * Returns the cumulative risk profile for the given session
   * without recording a new turn.
   */
  app.get(
    "/api/scan/multi-turn/:sessionId",
    { preHandler: requireAuth },
    async (request, reply) => {
      const parsed = sessionIdParamSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "Invalid sessionId",
          details: parsed.error.flatten(),
        });
      }

      const { sessionId } = parsed.data;
      const result = getSessionRisk(sessionId);
      if (!result) {
        return reply.status(404).send({ error: "Session not found" });
      }
      return result;
    },
  );

  /**
   * DELETE /api/scan/multi-turn/expired — Clean expired sessions
   *
   * Removes sessions that have exceeded the configured TTL.
   * Returns count of cleaned sessions.
   */
  app.delete(
    "/api/scan/multi-turn/expired",
    { preHandler: requireAuth },
    async () => {
      const cleaned = cleanExpiredSessions();
      return { cleaned };
    },
  );
}
