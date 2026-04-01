import { FastifyInstance } from "fastify";
import crypto from "node:crypto";
import { db } from "../db/index";
import { webhooks } from "../db/schema";
import { requireAuth, requireRole } from "../auth/authMiddleware";
import { eq } from "drizzle-orm";

export type WebhookEvent =
  | "policy_violation"
  | "credit_exceeded"
  | "new_user"
  | "high_risk_request"
  | "block";

interface Webhook {
  id: number;
  orgId: number | null;
  url: string;
  events: string; // JSON array of WebhookEvent
  secret: string | null;
  enabled: number;
  createdAt: number;
}

export async function fireWebhooks(
  event: WebhookEvent,
  payload: Record<string, unknown>,
): Promise<void> {
  const activeWebhooks = db.select().from(webhooks).where(eq(webhooks.enabled, 1)).all();

  for (const wh of activeWebhooks) {
    try {
      const events: string[] = JSON.parse(wh.events);
      if (!events.includes(event)) continue;

      const body = JSON.stringify({ event, timestamp: Date.now(), data: payload });
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "X-AF-Event": event,
      };

      if (wh.secret) {
        const sig = crypto
          .createHmac("sha256", wh.secret)
          .update(body)
          .digest("hex");
        headers["X-AF-Signature"] = `sha256=${sig}`;
      }

      fetch(wh.url, { method: "POST", headers, body }).catch(() => {
        // Silently ignore webhook delivery failures
      });
    } catch {
      // Ignore malformed webhook configs
    }
  }
}

export async function registerWebhookRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.post(
    "/api/webhooks",
    { preHandler: [requireAuth, requireRole("admin", "security_lead")] },
    async (request, reply) => {
      const { url, events, secret } = request.body as {
        url: string;
        events: WebhookEvent[];
        secret?: string;
      };

      if (!url || !events || events.length === 0) {
        return reply.status(400).send({ error: "url and events are required" });
      }

      const auth = (request as any).authContext;
      const orgId = auth?.user?.orgId ?? null;

      const result = db.insert(webhooks).values({
        orgId,
        url,
        events: JSON.stringify(events),
        secret: secret ?? null,
        enabled: 1,
        createdAt: Date.now()
      }).run();

      return { id: result.lastInsertRowid, url, events, enabled: true };
    },
  );

  app.get(
    "/api/webhooks",
    { preHandler: [requireAuth, requireRole("admin", "security_lead")] },
    async () => {
      const rows = db.select().from(webhooks).all();
      return rows.map((wh) => ({
        ...wh,
        events: JSON.parse(wh.events),
        secret: wh.secret ? "***" : null,
      }));
    },
  );

  app.delete(
    "/api/webhooks/:id",
    { preHandler: [requireAuth, requireRole("admin")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      db.delete(webhooks).where(eq(webhooks.id, Number(id))).run();
      return { deleted: true };
    },
  );

  app.post(
    "/api/webhooks/test",
    { preHandler: [requireAuth, requireRole("admin", "security_lead")] },
    async (request) => {
      const { url } = request.body as { url: string };
      await fireWebhooks("policy_violation", {
        test: true,
        message: "This is a test webhook from AI Firewall",
      });
      return { sent: true, url };
    },
  );
}
