import { FastifyInstance } from "fastify";
import { db } from "../db/index";
import { auditQueue } from "../db/schema";
import { requireAuth, requireCapability } from "../auth/authMiddleware";
import { eq, desc } from "drizzle-orm";

export async function registerAuditRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: { snippet_masked: string; metadata?: Record<string, unknown>; blindmi_score?: number; github_hits?: number } }>(
    "/api/audit/queue",
    { preHandler: [requireAuth, requireCapability("audit:read")] },
    async (request, reply) => {
      const { snippet_masked, metadata, blindmi_score = 0, github_hits = 0 } = request.body ?? {};
      if (!snippet_masked) return reply.status(400).send({ error: "snippet_masked required" });
      const submitterId = (request as any).authContext?.user?.id ?? null;
      
      const info = db.insert(auditQueue).values({
        createdAt: Date.now(),
        submitterId,
        snippetMasked: snippet_masked,
        metadata: JSON.stringify(metadata ?? {}),
        blindmiScore: blindmi_score,
        githubHits: github_hits,
        status: "pending"
      }).run();
      
      return reply.send({ id: info.lastInsertRowid });
    }
  );

  app.get("/api/audit/queue", { preHandler: [requireAuth, requireCapability("audit:read")] }, async (request, reply) => {
    const rows = db.select().from(auditQueue).orderBy(desc(auditQueue.createdAt)).limit(200).all();
    return reply.send({ items: rows });
  });

  app.post<{ Body: { id: number; action: "approve" | "redact" | "block" | "false_positive"; notes?: string } }>(
    "/api/audit/action",
    { preHandler: [requireAuth, requireCapability("audit:read")] },
    async (request, reply) => {
      const { id, action, notes } = request.body ?? {};
      if (!id || !action) return reply.status(400).send({ error: "id and action required" });
      const reviewerId = (request as any).authContext?.user?.id ?? null;
      
      db.update(auditQueue).set({
        status: action,
        reviewerId,
        reviewedAt: Date.now(),
        action,
        notes: notes ?? null
      }).where(eq(auditQueue.id, id)).run();
      
      return reply.send({ ok: true });
    }
  );
}
