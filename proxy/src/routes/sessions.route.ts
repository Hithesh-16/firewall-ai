/**
 * Session Routes
 *
 * Endpoints for cross-device session awareness.
 *
 * SOLID:
 * - SRP: Route handling only — delegates to sessionTracker.
 */

import { FastifyInstance } from "fastify";
import { requireAuth } from "../auth/authMiddleware";
import {
  getActiveSessions,
  getSessionById,
} from "../services/sessionTracker";

export async function registerSessionRoutes(app: FastifyInstance): Promise<void> {
  /** GET /api/sessions/active — list active sessions across devices */
  app.get("/api/sessions/active", { preHandler: requireAuth }, async (request) => {
    const userId = (request.query as Record<string, string>).userId
      ? Number((request.query as Record<string, string>).userId)
      : 1;

    return { sessions: getActiveSessions(userId) };
  });

  /** GET /api/sessions/:id — get a specific session */
  app.get("/api/sessions/:id", { preHandler: requireAuth }, async (request, reply) => {
    const id = (request.params as Record<string, string>).id;
    const session = getSessionById(id);

    if (!session) {
      return reply.status(404).send({ error: "Session not found" });
    }

    return session;
  });
}
