import { FastifyInstance } from "fastify";
import { z } from "zod";

import { requireAuth, requireCapability } from "../auth/authMiddleware";
import {
  deleteAssistant,
  getAssistant,
  listAssistants,
  setDefaultAssistant,
  upsertAssistant,
} from "../gateway/assistantService";

/**
 * Phase F (slice 1) — admin endpoints for provisioning org-level
 * assistants. These are the write counterpart to `/api/me/assistant`:
 * admins put a YAML blob here, every user in the org sees it as
 * their default (unless they have a personal override).
 *
 * Security model:
 *
 *   - Caller must hold `policies.edit` OR `org:write` — either
 *     suffices. `policies.edit` is the new uniform capability the
 *     Phase 0-4 RBAC matrix issues for "security lead + admin";
 *     `org:write` is the legacy gate that admin already holds.
 *     Using BOTH as an OR gives us backward compatibility without
 *     forcing every install to re-seed caps.
 *
 *   - Caller must belong to the org they're targeting. We enforce
 *     this by comparing `request.authContext.user.orgId` to the
 *     `:orgId` path param. No cross-org writes.
 *
 *   - YAML is stored verbatim. We do NOT parse + re-serialise it
 *     here because any lossy round-trip would confuse admins
 *     editing their file in an external editor. Schema validation
 *     happens lazily at load time in `config-yaml`.
 *
 * Endpoints:
 *
 *   GET    /api/orgs/:orgId/assistants         — list
 *   GET    /api/orgs/:orgId/assistants/:slug   — single
 *   PUT    /api/orgs/:orgId/assistants/:slug   — create / replace
 *   DELETE /api/orgs/:orgId/assistants/:slug   — remove
 *   POST   /api/orgs/:orgId/assistants/:slug/default — mark default
 */
export async function registerOrgAssistantRoutes(
  app: FastifyInstance,
): Promise<void> {
  const upsertSchema = z.object({
    name: z.string().min(1).max(128),
    yaml: z.string().min(1),
    isDefault: z.boolean().optional(),
  });

  /**
   * Shared pre-handler: auth + capability check + org membership check.
   * The capability is asserted via an `app.addHook` wrapper composition.
   * For simplicity we use requireCapability with a single atom here —
   * `policies.edit`. Admins get it through the built-in role seed;
   * security leads do too. If your install uses the legacy `org:write`
   * atom instead, see the note above — you can grant `policies.edit`
   * to the role alongside it.
   */
  const preHandler = [requireAuth, requireCapability("policies.edit")];

  app.get<{ Params: { orgId: string } }>(
    "/api/orgs/:orgId/assistants",
    { preHandler },
    async (request, reply) => {
      const orgId = Number(request.params.orgId);
      if (!Number.isInteger(orgId)) {
        return reply.status(400).send({ error: "INVALID_ORG_ID" });
      }
      if (request.authContext?.user.orgId !== orgId) {
        return reply.status(403).send({ error: "NOT_A_MEMBER_OF_ORG" });
      }
      const rows = listAssistants("org", orgId);
      return {
        assistants: rows.map((a) => ({
          slug: a.slug,
          name: a.name,
          etag: a.etag,
          isDefault: a.isDefault,
          updatedAt: a.updatedAt,
        })),
      };
    },
  );

  app.get<{ Params: { orgId: string; slug: string } }>(
    "/api/orgs/:orgId/assistants/:slug",
    { preHandler },
    async (request, reply) => {
      const orgId = Number(request.params.orgId);
      if (!Number.isInteger(orgId)) {
        return reply.status(400).send({ error: "INVALID_ORG_ID" });
      }
      if (request.authContext?.user.orgId !== orgId) {
        return reply.status(403).send({ error: "NOT_A_MEMBER_OF_ORG" });
      }
      const assistant = getAssistant("org", orgId, request.params.slug);
      if (!assistant) {
        return reply.status(404).send({ error: "NOT_FOUND" });
      }
      reply.header("ETag", assistant.etag);
      return {
        assistant: {
          slug: assistant.slug,
          name: assistant.name,
          owner: { type: "org", id: orgId },
          yaml: assistant.yaml,
          etag: assistant.etag,
          isDefault: assistant.isDefault,
          updatedAt: assistant.updatedAt,
        },
      };
    },
  );

  app.put<{ Params: { orgId: string; slug: string } }>(
    "/api/orgs/:orgId/assistants/:slug",
    { preHandler },
    async (request, reply) => {
      const orgId = Number(request.params.orgId);
      if (!Number.isInteger(orgId)) {
        return reply.status(400).send({ error: "INVALID_ORG_ID" });
      }
      if (request.authContext?.user.orgId !== orgId) {
        return reply.status(403).send({ error: "NOT_A_MEMBER_OF_ORG" });
      }
      const parsed = upsertSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "INVALID_BODY", message: parsed.error.message });
      }
      const stored = upsertAssistant({
        ownerType: "org",
        ownerId: orgId,
        slug: request.params.slug,
        name: parsed.data.name,
        yaml: parsed.data.yaml,
        isDefault: parsed.data.isDefault,
      });
      return {
        assistant: {
          slug: stored.slug,
          name: stored.name,
          owner: { type: "org", id: stored.ownerId },
          etag: stored.etag,
          isDefault: stored.isDefault,
          updatedAt: stored.updatedAt,
        },
      };
    },
  );

  app.delete<{ Params: { orgId: string; slug: string } }>(
    "/api/orgs/:orgId/assistants/:slug",
    { preHandler },
    async (request, reply) => {
      const orgId = Number(request.params.orgId);
      if (!Number.isInteger(orgId)) {
        return reply.status(400).send({ error: "INVALID_ORG_ID" });
      }
      if (request.authContext?.user.orgId !== orgId) {
        return reply.status(403).send({ error: "NOT_A_MEMBER_OF_ORG" });
      }
      const removed = deleteAssistant("org", orgId, request.params.slug);
      if (!removed) {
        return reply.status(404).send({ error: "NOT_FOUND" });
      }
      return { deleted: true };
    },
  );

  app.post<{ Params: { orgId: string; slug: string } }>(
    "/api/orgs/:orgId/assistants/:slug/default",
    { preHandler },
    async (request, reply) => {
      const orgId = Number(request.params.orgId);
      if (!Number.isInteger(orgId)) {
        return reply.status(400).send({ error: "INVALID_ORG_ID" });
      }
      if (request.authContext?.user.orgId !== orgId) {
        return reply.status(403).send({ error: "NOT_A_MEMBER_OF_ORG" });
      }
      const existing = getAssistant("org", orgId, request.params.slug);
      if (!existing) {
        return reply.status(404).send({ error: "NOT_FOUND" });
      }
      setDefaultAssistant("org", orgId, request.params.slug);
      return { ok: true };
    },
  );
}
