/**
 * Compliance Routes
 *
 * Map security events to regulatory requirements and generate
 * evidence packages for audit and compliance reporting.
 *
 * Endpoints:
 *   POST /api/compliance/map       — Map event to regulations
 *   POST /api/compliance/evidence  — Generate evidence package
 *   GET  /api/compliance/regulations — List supported regulations
 */

import { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth/authMiddleware";
import {
  mapToRegulations,
  generateEvidence,
  listRegulations,
} from "../compliance/complianceMapper";

// ── Schemas ────────────────────────────────────────────────────────────────

const securityEventSchema = z.object({
  type: z.string().min(1),
  severity: z.enum(["critical", "high", "medium", "low"]),
  timestamp: z.number(),
  details: z.record(z.string(), z.unknown()).optional(),
  source: z.string().optional(),
});

const complianceMapSchema = securityEventSchema;

const evidenceSchema = z.object({
  events: z.array(securityEventSchema).min(1).max(1000),
  timeRange: z.object({
    start: z.number(),
    end: z.number(),
  }),
});

// ── Route Registration ─────────────────────────────────────────────────────

export async function registerComplianceRoutes(
  app: FastifyInstance,
): Promise<void> {
  /**
   * POST /api/compliance/map — Map event to regulations
   *
   * Takes a security event and returns which regulatory frameworks
   * it maps to (GDPR, HIPAA, SOC2, etc.) with relevant controls.
   */
  app.post(
    "/api/compliance/map",
    { preHandler: requireAuth },
    async (request, reply) => {
      const parsed = complianceMapSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "Invalid payload", details: parsed.error.flatten() });
      }

      return mapToRegulations(parsed.data);
    },
  );

  /**
   * POST /api/compliance/evidence — Generate evidence package
   *
   * Generates a compliance evidence package from a set of security events
   * within a time range, suitable for auditor review.
   */
  app.post(
    "/api/compliance/evidence",
    { preHandler: requireAuth },
    async (request, reply) => {
      const parsed = evidenceSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "Invalid payload", details: parsed.error.flatten() });
      }

      const { events, timeRange } = parsed.data;
      return generateEvidence(events, timeRange);
    },
  );

  /**
   * GET /api/compliance/regulations — List supported regulations
   *
   * Returns the set of regulatory frameworks the compliance engine supports.
   */
  app.get(
    "/api/compliance/regulations",
    { preHandler: requireAuth },
    async () => {
      return { regulations: listRegulations() };
    },
  );
}
