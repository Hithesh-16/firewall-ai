/**
 * Hooks Route
 *
 * CRUD endpoints for managing event hooks (webhook registrations).
 */

import type { FastifyInstance } from "fastify";
import { hookRegistrationSchema } from "../schemas/hookSchemas";
import {
  registerHook,
  unregisterHook,
  getRegisteredHooks,
  type Hook,
} from "../hooks/hookRegistry";
import { enqueueWebhookEvent } from "../services/webhookQueue";
import { v4 as uuidv4 } from "uuid";

export async function registerHooksRoute(app: FastifyInstance): Promise<void> {
  // List all registered hooks
  app.get("/api/hooks", async (_request, reply) => {
    const hooks = getRegisteredHooks();
    return reply.send(
      hooks.map((h) => ({ id: h.id, event: h.event })),
    );
  });

  // Register a new webhook hook
  app.post("/api/hooks", async (request, reply) => {
    const parsed = hookRegistrationSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "Invalid hook registration",
        details: parsed.error.flatten(),
      });
    }

    const { event, url, description } = parsed.data;
    const hookId = `webhook:${uuidv4()}`;

    const hook: Hook = {
      id: hookId,
      event,
      execute: async (context) => {
        enqueueWebhookEvent(event, {
          hookId,
          event: context.event,
          riskScore: context.riskScore ?? 0,
          action: context.action ?? "unknown",
          model: context.model ?? "unknown",
          timestamp: context.timestamp,
          // Sanitized — no raw content
        });
      },
    };

    registerHook(hook);

    return reply.status(201).send({
      id: hookId,
      event,
      url,
      description,
    });
  });

  // Delete a hook
  app.delete<{ Params: { id: string } }>(
    "/api/hooks/:id",
    async (request, reply) => {
      unregisterHook(request.params.id);
      return reply.status(204).send();
    },
  );
}
