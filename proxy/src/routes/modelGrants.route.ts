import { FastifyInstance } from "fastify";
import { z } from "zod";

import { requireAuth, requireCapability } from "../auth/authMiddleware";
import {
  createGrant,
  deleteGrant,
  deleteGrantsForUser,
  listGrantsForOrg,
  listGrantsForUser,
} from "../gateway/modelGrantService";

/**
 * Phase F (slice 2) — admin CRUD for `model_grants`.
 *
 * Endpoints are scoped under /api/orgs/:orgId/... so the route
 * itself enforces "same-org only" writes. The capability gate
 * is `policies.edit` — any role that can edit policies (admin,
 * security_lead, and custom roles with the same atom) can also
 * manage model grants.
 *
 * Route map:
 *
 *   GET    /api/orgs/:orgId/model-grants                list all grants in the org
 *   GET    /api/orgs/:orgId/model-grants/by-user/:uid   grants for a single user
 *   POST   /api/orgs/:orgId/model-grants                create a grant (upsert)
 *   POST   /api/orgs/:orgId/model-grants/bulk           create many grants at once
 *   DELETE /api/orgs/:orgId/model-grants/:grantId       revoke a single grant
 *   DELETE /api/orgs/:orgId/model-grants/by-user/:uid   revoke every grant for a user
 *
 * The bulk endpoint is what the admin UI calls when saving the
 * grant matrix — one round-trip, N inserts inside a transaction.
 */

const createGrantSchema = z.object({
  granteeType: z.enum(["user", "team"]),
  granteeId: z.number().int().positive(),
  providerSlug: z.string().min(1),
  /**
   * `"*"` is a valid wildcard meaning "every model this provider
   * catalogues". Scanner pipeline treats it identically to an
   * exact match.
   */
  modelSlug: z.string().min(1),
});

const bulkCreateSchema = z.object({
  grants: z.array(createGrantSchema).min(1).max(500),
});

export async function registerModelGrantRoutes(
  app: FastifyInstance,
): Promise<void> {
  const preHandler = [requireAuth, requireCapability("policies.edit")];

  app.get<{ Params: { orgId: string } }>(
    "/api/orgs/:orgId/model-grants",
    { preHandler },
    async (request, reply) => {
      const orgId = Number(request.params.orgId);
      if (!Number.isInteger(orgId)) {
        return reply.status(400).send({ error: "INVALID_ORG_ID" });
      }
      if (request.authContext?.user.orgId !== orgId) {
        return reply.status(403).send({ error: "NOT_A_MEMBER_OF_ORG" });
      }
      return { grants: listGrantsForOrg(orgId) };
    },
  );

  app.get<{ Params: { orgId: string; userId: string } }>(
    "/api/orgs/:orgId/model-grants/by-user/:userId",
    { preHandler },
    async (request, reply) => {
      const orgId = Number(request.params.orgId);
      const userId = Number(request.params.userId);
      if (!Number.isInteger(orgId) || !Number.isInteger(userId)) {
        return reply.status(400).send({ error: "INVALID_ID" });
      }
      if (request.authContext?.user.orgId !== orgId) {
        return reply.status(403).send({ error: "NOT_A_MEMBER_OF_ORG" });
      }
      return { grants: listGrantsForUser(orgId, userId) };
    },
  );

  app.post<{ Params: { orgId: string } }>(
    "/api/orgs/:orgId/model-grants",
    { preHandler },
    async (request, reply) => {
      const orgId = Number(request.params.orgId);
      if (!Number.isInteger(orgId)) {
        return reply.status(400).send({ error: "INVALID_ORG_ID" });
      }
      if (request.authContext?.user.orgId !== orgId) {
        return reply.status(403).send({ error: "NOT_A_MEMBER_OF_ORG" });
      }
      const parsed = createGrantSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "INVALID_BODY",
          message: parsed.error.message,
        });
      }
      const grant = createGrant({
        orgId,
        granteeType: parsed.data.granteeType,
        granteeId: parsed.data.granteeId,
        providerSlug: parsed.data.providerSlug,
        modelSlug: parsed.data.modelSlug,
        grantedBy: request.authContext?.user.id ?? null,
      });
      return { grant };
    },
  );

  app.post<{ Params: { orgId: string } }>(
    "/api/orgs/:orgId/model-grants/bulk",
    { preHandler },
    async (request, reply) => {
      const orgId = Number(request.params.orgId);
      if (!Number.isInteger(orgId)) {
        return reply.status(400).send({ error: "INVALID_ORG_ID" });
      }
      if (request.authContext?.user.orgId !== orgId) {
        return reply.status(403).send({ error: "NOT_A_MEMBER_OF_ORG" });
      }
      const parsed = bulkCreateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "INVALID_BODY",
          message: parsed.error.message,
        });
      }
      const grantedBy = request.authContext?.user.id ?? null;
      const created = parsed.data.grants.map((g) =>
        createGrant({
          orgId,
          granteeType: g.granteeType,
          granteeId: g.granteeId,
          providerSlug: g.providerSlug,
          modelSlug: g.modelSlug,
          grantedBy,
        }),
      );
      return { grants: created, count: created.length };
    },
  );

  app.delete<{ Params: { orgId: string; grantId: string } }>(
    "/api/orgs/:orgId/model-grants/:grantId",
    { preHandler },
    async (request, reply) => {
      const orgId = Number(request.params.orgId);
      const grantId = Number(request.params.grantId);
      if (!Number.isInteger(orgId) || !Number.isInteger(grantId)) {
        return reply.status(400).send({ error: "INVALID_ID" });
      }
      if (request.authContext?.user.orgId !== orgId) {
        return reply.status(403).send({ error: "NOT_A_MEMBER_OF_ORG" });
      }
      const ok = deleteGrant(orgId, grantId);
      if (!ok) return reply.status(404).send({ error: "NOT_FOUND" });
      return { deleted: true };
    },
  );

  app.delete<{ Params: { orgId: string; userId: string } }>(
    "/api/orgs/:orgId/model-grants/by-user/:userId",
    { preHandler },
    async (request, reply) => {
      const orgId = Number(request.params.orgId);
      const userId = Number(request.params.userId);
      if (!Number.isInteger(orgId) || !Number.isInteger(userId)) {
        return reply.status(400).send({ error: "INVALID_ID" });
      }
      if (request.authContext?.user.orgId !== orgId) {
        return reply.status(403).send({ error: "NOT_A_MEMBER_OF_ORG" });
      }
      const count = deleteGrantsForUser(orgId, userId);
      return { deleted: count };
    },
  );
}
