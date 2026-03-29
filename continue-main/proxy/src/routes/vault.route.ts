import { FastifyInstance } from "fastify";
import { resolveToken, listTokens, purgeExpired } from "../vault/tokenVault";
import { requireRole } from "../auth/authMiddleware";
import { db } from "../db/index";
import { adminAudit } from "../db/schema";

export async function registerVaultRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/vault/tokens", { preHandler: requireRole("admin") }, async (request, reply) => {
    const tokens = listTokens();
    return reply.send({ tokens });
  });

  app.post<{ Body: { tokenId: string } }>(
    "/api/vault/resolve",
    { preHandler: requireRole("admin") },
    async (request, reply) => {
      const { tokenId } = request.body ?? {};
      if (!tokenId) {
        return reply.status(400).send({ error: "tokenId required" });
      }

      const resolved = resolveToken(tokenId);
      if (resolved === null) {
        return reply.status(404).send({ error: "Token not found or expired" });
      }

      try {
        const userId = (request as any).authContext?.user?.id ?? null;
        db.insert(adminAudit).values({
          timestamp: Date.now(),
          userId,
          action: "vault_resolve",
          details: JSON.stringify({ tokenId })
        }).run();
      } catch (e) { request.log.error({ err: e }, "vault resolve audit log failed"); }

      return reply.send({ tokenId, originalValue: resolved });
    }
  );

  app.post("/api/vault/purge", { preHandler: requireRole("admin") }, async (request, reply) => {
    const count = purgeExpired();
    try {
      const userId = (request as any).authContext?.user?.id ?? null;
      db.insert(adminAudit).values({
        timestamp: Date.now(),
        userId,
        action: "vault_purge",
        details: JSON.stringify({ purged: count })
      }).run();
    } catch (e) { request.log.error({ err: e }, "vault purge audit log failed — purge still executed"); }
    return reply.send({ purged: count });
  });
}
