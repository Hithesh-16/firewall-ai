import { FastifyInstance } from "fastify";
import { z } from "zod";

import { requireAuth, requireCapability } from "../auth/authMiddleware";
import { CAP } from "../auth/capabilities";
import { listGrantsForUser } from "../gateway/modelGrantService";
import {
  addModelForUser,
  addUserModel,
  listUserModels,
  listUserModelsPaginated,
  removeUserModelById,
  type UserModelPublic,
} from "../gateway/userModelService";

/**
 * Unified /api/me/models CRUD — the single endpoint every client
 * uses to add, list, and remove models for the signed-in user.
 *
 * Replaces:
 *   - POST /api/providers (Phase 4 legacy)
 *   - PUT  /api/me/providers/:slug (Phase A)
 *   - The models[] block in the assistants YAML
 *   - model_grants admin endpoints
 *
 * Shape:
 *   GET    /api/me/models          → list all models for the caller
 *   POST   /api/me/models          → add a model (provider + key + slug)
 *   DELETE /api/me/models/:id      → remove a model by ID
 *
 * Admin (capability: policies.edit):
 *   GET    /api/admin/users/:userId/models   → list another user's models
 *   POST   /api/admin/users/:userId/models   → assign a model to another user
 *   DELETE /api/admin/users/:userId/models/:id → remove a model from another user
 */

const addModelSchema = z.object({
  providerSlug: z.string().min(1),
  modelSlug: z.string().min(1),
  displayName: z.string().optional(),
  // API key must not be empty and must not be our own opt-out marker.
  // Users sometimes paste `user-managed: true` from the config.yaml
  // header by mistake; that then looks like a valid non-empty string
  // to Zod but makes every upstream LLM call 401. Reject at the
  // boundary so no client can seed a broken row.
  apiKey: z
    .string()
    .min(1)
    .refine((v) => !/user-managed/i.test(v.trim()), {
      message:
        "apiKey looks like an AI Firewall marker string — paste the actual provider key instead.",
    }),
  apiBase: z.string().optional(),
  roles: z.array(z.string()).optional(),
});

export async function registerUserModelRoutes(
  app: FastifyInstance,
): Promise<void> {
  // ─── User-facing (self) ───────────────────────────────────

  // NOTE: This registers as /api/me/models/list to avoid
  // conflicting with the existing GET /api/me/models in me.route.ts.
  // Once the old endpoint is removed, rename this to /api/me/models.
  app.get(
    "/api/me/models/list",
    { preHandler: requireAuth },
    async (request) => {
      const userId = request.authContext?.user?.id;
      const orgId = request.authContext?.user?.orgId ?? null;
      if (!userId) throw new Error("Not authenticated");

      // Pagination + search, BE-driven. Web's `useServerTable` hook
      // sends `?page=&pageSize=&search=`; default to returning the
      // full list when none are supplied so legacy callers (the IDE
      // sync, older dashboards) keep working.
      const query = (request.query as Record<string, unknown>) || {};
      const hasPageParams =
        typeof query.page !== "undefined" ||
        typeof query.pageSize !== "undefined" ||
        typeof query.search !== "undefined";

      // Self-added models (rows in user_models owned by this user).
      const selfModels = listUserModels(userId);

      // Org-granted models (rows in model_grants). Synthesized into the
      // same UserModelPublic shape so the client can render one unified
      // list. We use negative IDs so DELETE /api/me/models/:id (which
      // validates positive int) cannot clobber a grant — grants are
      // revoked only via /api/orgs/:orgId/model-grants/:grantId by an
      // admin, which keeps the "user can't delete what admin assigned"
      // invariant intact.
      const grantModels: UserModelPublic[] = orgId
        ? listGrantsForUser(orgId, userId)
            // Wildcard grants (model_slug="*") can't be rendered as a
            // single row without expanding against the org catalogue —
            // skip them here so the UI doesn't show "openai/*" literally.
            // The gateway still honours them at request time.
            .filter((g) => g.modelSlug !== "*")
            .map((g) => ({
              id: -g.id,
              providerSlug: g.providerSlug,
              modelSlug: g.modelSlug,
              displayName: null,
              apiBase: null,
              enabled: true,
              roles: ["chat", "edit", "apply"],
              createdAt: g.grantedAt,
              updatedAt: g.grantedAt,
              createdBy: g.grantedBy,
            }))
        : [];

      // De-dupe: if a self-added model and a grant name the same
      // (providerSlug, modelSlug), the self-added one wins (user owns
      // the key). Grants for pairs the user already has are redundant.
      const selfKeys = new Set(
        selfModels.map((m) => `${m.providerSlug}/${m.modelSlug}`),
      );
      const grantsDeduped = grantModels.filter(
        (g) => !selfKeys.has(`${g.providerSlug}/${g.modelSlug}`),
      );

      const models = [...selfModels, ...grantsDeduped];

      if (hasPageParams) {
        // BE-paginated response — filter + slice the merged list
        // rather than going back to the DB, because the grant set
        // is tiny (one row per {provider, model} per user) and we
        // already have everything in memory.
        const page = Math.max(1, Math.floor(Number(query.page) || 1));
        const pageSize = Math.min(
          100,
          Math.max(1, Math.floor(Number(query.pageSize) || 20)),
        );
        const search =
          typeof query.search === "string" ? query.search.trim() : "";
        const filtered = search
          ? models.filter((m) => {
              const hay =
                `${m.displayName || ""} ${m.modelSlug} ${m.providerSlug}`.toLowerCase();
              return hay.includes(search.toLowerCase());
            })
          : models;
        const total = filtered.length;
        const start = (page - 1) * pageSize;
        const items = filtered.slice(start, start + pageSize);
        return {
          items,
          // Kept for backwards compat with callers that don't yet
          // read `items` (older web bundle, CLI /sync). Will be
          // dropped once every consumer switches to `items`.
          models: items,
          total,
          page,
          pageSize,
          hasMore: start + items.length < total,
          hasAny: models.length > 0,
        };
      }

      return {
        models,
        hasAny: models.length > 0,
      };
    },
  );

  app.post(
    "/api/me/models/add",
    { preHandler: requireAuth },
    async (request, reply) => {
      const userId = request.authContext?.user?.id;
      if (!userId) throw new Error("Not authenticated");
      const parsed = addModelSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "INVALID_BODY",
          message: parsed.error.message,
        });
      }
      const model = addUserModel({
        userId,
        providerSlug: parsed.data.providerSlug,
        modelSlug: parsed.data.modelSlug,
        displayName: parsed.data.displayName,
        apiKey: parsed.data.apiKey,
        apiBase: parsed.data.apiBase ?? null,
        roles: parsed.data.roles,
      });
      return { model };
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/me/models/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      const userId = request.authContext?.user?.id;
      if (!userId) throw new Error("Not authenticated");
      const modelId = Number(request.params.id);
      if (!Number.isInteger(modelId)) {
        return reply.status(400).send({ error: "INVALID_ID" });
      }
      const removed = removeUserModelById(userId, modelId);
      if (!removed) {
        return reply.status(404).send({ error: "NOT_FOUND" });
      }
      return { deleted: true };
    },
  );

  // ─── Admin (assign models to other users) ─────────────────

  app.get<{ Params: { userId: string } }>(
    "/api/admin/users/:userId/models",
    { preHandler: [requireAuth, requireCapability(CAP.policies_edit)] },
    async (request, reply) => {
      const targetUserId = Number(request.params.userId);
      if (!Number.isInteger(targetUserId)) {
        return reply.status(400).send({ error: "INVALID_USER_ID" });
      }
      const models = listUserModels(targetUserId);
      return { models };
    },
  );

  app.post<{ Params: { userId: string } }>(
    "/api/admin/users/:userId/models",
    { preHandler: [requireAuth, requireCapability(CAP.policies_edit)] },
    async (request, reply) => {
      const adminUserId = request.authContext?.user?.id;
      if (!adminUserId) throw new Error("Not authenticated");
      const targetUserId = Number(request.params.userId);
      if (!Number.isInteger(targetUserId)) {
        return reply.status(400).send({ error: "INVALID_USER_ID" });
      }
      const parsed = addModelSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "INVALID_BODY",
          message: parsed.error.message,
        });
      }
      const model = addModelForUser(adminUserId, targetUserId, {
        providerSlug: parsed.data.providerSlug,
        modelSlug: parsed.data.modelSlug,
        displayName: parsed.data.displayName,
        apiKey: parsed.data.apiKey,
        apiBase: parsed.data.apiBase ?? null,
        roles: parsed.data.roles,
      });
      return { model };
    },
  );

  app.delete<{ Params: { userId: string; id: string } }>(
    "/api/admin/users/:userId/models/:id",
    { preHandler: [requireAuth, requireCapability(CAP.policies_edit)] },
    async (request, reply) => {
      const targetUserId = Number(request.params.userId);
      const modelId = Number(request.params.id);
      if (!Number.isInteger(targetUserId) || !Number.isInteger(modelId)) {
        return reply.status(400).send({ error: "INVALID_ID" });
      }
      const removed = removeUserModelById(targetUserId, modelId);
      if (!removed) {
        return reply.status(404).send({ error: "NOT_FOUND" });
      }
      return { deleted: true };
    },
  );
}
