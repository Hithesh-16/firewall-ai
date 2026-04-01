/**
 * Notification Routes
 *
 * Endpoints for managing notification channels (Slack, webhook, email, Web Push).
 *
 * SOLID:
 * - SRP: Route handling only — delegates to notificationService.
 */

import { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth/authMiddleware";
import {
  addChannel,
  getChannels,
  removeChannel,
  sendNotification,
} from "../notifications/notificationService";
import type { WsEvent } from "../types";

const channelSchema = z.object({
  channelType: z.enum(["webpush", "slack", "email", "webhook"]),
  config: z.record(z.string(), z.unknown()),
});

export async function registerNotificationRoutes(app: FastifyInstance): Promise<void> {
  /** GET /api/notifications/channels — list configured channels */
  app.get("/api/notifications/channels", { preHandler: requireAuth }, async (request) => {
    const userId = (request.query as Record<string, string>).userId
      ? Number((request.query as Record<string, string>).userId)
      : 1;

    return { channels: getChannels(userId) };
  });

  /** POST /api/notifications/channels — configure a new channel */
  app.post("/api/notifications/channels", { preHandler: requireAuth }, async (request, reply) => {
    const parsed = channelSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
    }

    const userId = ((request.body as Record<string, unknown>).userId as number) ?? 1;
    const id = addChannel(userId, parsed.data.channelType, parsed.data.config);

    return { id, channelType: parsed.data.channelType };
  });

  /** DELETE /api/notifications/channels/:id — remove a channel */
  app.delete("/api/notifications/channels/:id", { preHandler: requireAuth }, async (request, reply) => {
    const id = Number((request.params as Record<string, string>).id);
    if (isNaN(id)) {
      return reply.status(400).send({ error: "Invalid channel ID" });
    }

    const deleted = removeChannel(id);
    if (!deleted) {
      return reply.status(404).send({ error: "Channel not found" });
    }

    return { deleted: true };
  });

  /** POST /api/notifications/test — send a test notification */
  app.post("/api/notifications/test", { preHandler: requireAuth }, async (request) => {
    const userId = ((request.body as Record<string, unknown>).userId as number) ?? 1;

    const testEvent: WsEvent = {
      type: "scan_blocked",
      payload: {
        message: "Test notification from AI Firewall",
        test: true,
      },
      timestamp: Date.now(),
    };

    const result = await sendNotification(userId, testEvent);
    return result;
  });
}
