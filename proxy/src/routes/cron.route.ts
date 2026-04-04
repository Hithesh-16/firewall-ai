/**
 * Cron Routes
 *
 * REST API for scheduled agent triggers.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth/authMiddleware";
import {
  createCronJob,
  getCronJob,
  listCronJobs,
  enableCronJob,
  disableCronJob,
  deleteCronJob,
} from "../services/cronService";

const createSchema = z.object({
  name: z.string().min(1).max(100),
  schedule: z.string().regex(/^\d+(m|h|d)$/, "Format: 5m, 1h, 24h"),
  agentConfig: z.object({
    description: z.string().min(1).max(500),
    prompt: z.string().min(1).max(100_000),
    model: z.string().max(200).optional(),
    background: z.boolean().optional(),
  }),
});

export async function registerCronRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/api/cron",
    { preHandler: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ctx = request.authContext;
      if (!ctx) return reply.status(401).send({ error: "Not authenticated" });
      const jobs = listCronJobs(ctx.user.id);
      return { jobs, total: jobs.length };
    },
  );

  app.post(
    "/api/cron",
    { preHandler: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ctx = request.authContext;
      if (!ctx) return reply.status(401).send({ error: "Not authenticated" });

      const parsed = createSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "Invalid payload", details: parsed.error.flatten() });
      }

      const job = createCronJob(
        ctx.user.id,
        parsed.data.name,
        parsed.data.schedule,
        parsed.data.agentConfig,
      );

      if (!job) {
        return reply
          .status(400)
          .send({ error: "Invalid schedule. Min 1m. Format: 5m, 1h, 24h" });
      }

      return reply.status(201).send({ job });
    },
  );

  app.get(
    "/api/cron/:id",
    { preHandler: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as Record<string, string>;
      const job = getCronJob(id);
      if (!job) return reply.status(404).send({ error: "Cron job not found" });
      return { job };
    },
  );

  app.post(
    "/api/cron/:id/enable",
    { preHandler: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as Record<string, string>;
      const success = enableCronJob(id);
      if (!success)
        return reply.status(404).send({ error: "Cron job not found" });
      return { enabled: true };
    },
  );

  app.post(
    "/api/cron/:id/disable",
    { preHandler: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as Record<string, string>;
      const success = disableCronJob(id);
      if (!success)
        return reply.status(404).send({ error: "Cron job not found" });
      return { disabled: true };
    },
  );

  app.delete(
    "/api/cron/:id",
    { preHandler: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as Record<string, string>;
      const success = deleteCronJob(id);
      if (!success)
        return reply.status(404).send({ error: "Cron job not found" });
      return { deleted: true };
    },
  );
}
