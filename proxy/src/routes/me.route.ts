import { FastifyInstance } from "fastify";
import { z } from "zod";

import { requireAuth } from "../auth/authMiddleware";
import {
  deleteAssistant,
  getAssistant,
  listAssistants,
  resolveAssistantForUser,
  setDefaultAssistant,
  upsertAssistant,
} from "../gateway/assistantService";
import {
  inferGrantMode,
  isModelGrantedToUser,
  resolveGrantsForUser,
} from "../gateway/modelGrantService";
import {
  deleteUserProvider,
  listAvailableProvidersForUser,
  listOrgProviders,
  listUserProviders,
  upsertUserProvider,
} from "../gateway/userProviderService";
import { resolveEffectivePolicy } from "../policy/policyChain";

/**
 * Phase A/A.5/B/D — the "me" routes.
 *
 * Every extension (CLI, VS Code, JetBrains) hits these endpoints
 * immediately after sign-in to bootstrap its runtime state:
 *
 *   GET  /api/me/policy      → effective PolicyConfig for this user
 *   GET  /api/me/assistant   → default assistant YAML + etag
 *   GET  /api/me/assistants  → list all assistants reachable by this user
 *   PUT  /api/me/assistants/:slug → create/update a user assistant override
 *   DELETE /api/me/assistants/:slug → remove a user assistant override
 *   POST /api/me/assistants/:slug/default → mark as default
 *
 *   GET  /api/me/models      → flattened list of available models +
 *                              mandatory-gate metadata (hasAny, canAddPersonal)
 *
 *   GET  /api/me/providers   → list of the caller's personal providers
 *   PUT  /api/me/providers/:slug → upsert a personal provider (gated
 *                              by the effective role policy's
 *                              `rules.allow_user_provider_override`)
 *   DELETE /api/me/providers/:slug → remove a personal provider
 *
 * All routes are authenticated (no capability check beyond that —
 * they're caller-scoped). Role-based feature gates (e.g. "can
 * add personal providers") are checked against the effective
 * policy, not capabilities, because they're policy decisions not
 * permission decisions.
 */

// Type helper: the (non-optional) user shape on every request here.
type AuthedUser = {
  id: number;
  orgId: number | null;
  role: string | null;
};

function requireUser(request: {
  authContext?: {
    user: { id: number; orgId: number | null; role?: string | null };
  };
}): AuthedUser {
  const user = request.authContext?.user;
  if (!user) {
    throw new Error("requireAuth should have rejected this request");
  }
  return {
    id: user.id,
    orgId: user.orgId ?? null,
    role: user.role ?? null,
  };
}

/**
 * Shared helper: does the caller's effective policy allow
 * user-level provider/assistant overrides? Defaults to `true`
 * when the rule isn't set, so small teams don't need to
 * explicitly opt in.
 */
function effectivePolicyAllowsUserOverride(user: AuthedUser): boolean {
  const policy = resolveEffectivePolicy(user.orgId, user.role, null, undefined);
  const rules = (policy as Record<string, unknown>).rules as
    | Record<string, unknown>
    | undefined;
  const flag = rules?.allow_user_provider_override;
  if (flag === false) return false;
  return true;
}

export async function registerMeRoutes(app: FastifyInstance): Promise<void> {
  // ─── Effective policy ─────────────────────────────────────────

  app.get("/api/me/policy", { preHandler: requireAuth }, async (request) => {
    const user = requireUser(request);
    const policy = resolveEffectivePolicy(
      user.orgId,
      user.role,
      null,
      undefined,
    );
    return { policy };
  });

  // ─── Assistants ───────────────────────────────────────────────

  app.get(
    "/api/me/assistant",
    { preHandler: requireAuth },
    async (request, reply) => {
      const user = requireUser(request);
      const assistant = resolveAssistantForUser(user.id, user.orgId);
      if (!assistant) {
        return reply.status(404).send({
          error: "NO_ASSISTANT_CONFIGURED",
          message:
            "No default assistant is configured for your user or org. " +
            "Ask your admin to provision an org assistant, or create a " +
            "personal assistant via the web dashboard.",
        });
      }

      // Conditional GET — cheap etag round-trip for client caches.
      const incoming = request.headers["if-none-match"];
      if (incoming && incoming === assistant.etag) {
        return reply.status(304).send();
      }

      reply.header("ETag", assistant.etag);
      return {
        assistant: {
          slug: assistant.slug,
          name: assistant.name,
          owner: { type: assistant.ownerType, id: assistant.ownerId },
          yaml: assistant.yaml,
          etag: assistant.etag,
          isDefault: assistant.isDefault,
          updatedAt: assistant.updatedAt,
        },
      };
    },
  );

  app.get(
    "/api/me/assistants",
    { preHandler: requireAuth },
    async (request) => {
      const user = requireUser(request);
      const userAssistants = listAssistants("user", user.id);
      const orgAssistants = user.orgId ? listAssistants("org", user.orgId) : [];
      return {
        user: userAssistants.map((a) => ({
          slug: a.slug,
          name: a.name,
          etag: a.etag,
          isDefault: a.isDefault,
          updatedAt: a.updatedAt,
        })),
        org: orgAssistants.map((a) => ({
          slug: a.slug,
          name: a.name,
          etag: a.etag,
          isDefault: a.isDefault,
          updatedAt: a.updatedAt,
        })),
      };
    },
  );

  const upsertAssistantSchema = z.object({
    name: z.string().min(1).max(128),
    yaml: z.string().min(1),
    isDefault: z.boolean().optional(),
  });

  app.put<{ Params: { slug: string } }>(
    "/api/me/assistants/:slug",
    { preHandler: requireAuth },
    async (request, reply) => {
      const user = requireUser(request);
      if (!effectivePolicyAllowsUserOverride(user)) {
        return reply.status(403).send({
          error: "USER_OVERRIDE_NOT_ALLOWED",
          message:
            "Your org's policy does not permit per-user assistant overrides.",
        });
      }
      const parse = upsertAssistantSchema.safeParse(request.body);
      if (!parse.success) {
        return reply.status(400).send({
          error: "INVALID_BODY",
          message: parse.error.message,
        });
      }
      const stored = upsertAssistant({
        ownerType: "user",
        ownerId: user.id,
        slug: request.params.slug,
        name: parse.data.name,
        yaml: parse.data.yaml,
        isDefault: parse.data.isDefault,
      });
      return {
        assistant: {
          slug: stored.slug,
          name: stored.name,
          owner: { type: stored.ownerType, id: stored.ownerId },
          etag: stored.etag,
          isDefault: stored.isDefault,
          updatedAt: stored.updatedAt,
        },
      };
    },
  );

  app.delete<{ Params: { slug: string } }>(
    "/api/me/assistants/:slug",
    { preHandler: requireAuth },
    async (request, reply) => {
      const user = requireUser(request);
      const removed = deleteAssistant("user", user.id, request.params.slug);
      if (!removed) {
        return reply.status(404).send({ error: "NOT_FOUND" });
      }
      return { deleted: true };
    },
  );

  app.post<{ Params: { slug: string } }>(
    "/api/me/assistants/:slug/default",
    { preHandler: requireAuth },
    async (request, reply) => {
      const user = requireUser(request);
      const existing = getAssistant("user", user.id, request.params.slug);
      if (!existing) {
        return reply.status(404).send({ error: "NOT_FOUND" });
      }
      setDefaultAssistant("user", user.id, request.params.slug);
      return { ok: true };
    },
  );

  // ─── Models (flattened list for clients) ──────────────────────

  app.get("/api/me/models", { preHandler: requireAuth }, async (request) => {
    const user = requireUser(request);
    const available = listAvailableProvidersForUser(user.id, user.orgId);
    const canAddPersonal = effectivePolicyAllowsUserOverride(user);

    // The flat list is built by cross-referencing available
    // providers against the default assistant's `models:` array.
    // If the user has no default assistant yet, we still return
    // the list of available providers so the onboarding wizard
    // can show "Pick a model" using the upstream provider's
    // default model list.
    const assistant = resolveAssistantForUser(user.id, user.orgId);

    // Parse YAML model slugs on demand — we avoid loading the full
    // YAML parser at module init time by importing lazily.
    let declaredModels: Array<{
      provider: string;
      model: string;
      displayName?: string;
    }> = [];
    if (assistant) {
      try {
        const yamlModule = await import("yaml");
        const parsed = yamlModule.parse(assistant.yaml) as {
          models?: Array<{
            provider: string;
            model: string;
            name?: string;
          }>;
        };
        declaredModels = (parsed.models ?? []).map((m) => ({
          provider: m.provider,
          model: m.model,
          displayName: m.name,
        }));
      } catch {
        declaredModels = [];
      }
    }

    // Cross-reference: a declared model is "reachable" only when
    //   1. the user has an available provider for its slug, AND
    //   2. the user either has an explicit grant for the model,
    //      or the org is in "allow-all" mode (no grants configured
    //      anywhere — bootstrap phase).
    //
    // Personal providers (`source === 'user'`) bypass the grant
    // check entirely — an individual's own key is not subject to
    // the admin's allow-list.
    const availableSlugs = new Set(available.map((p) => p.providerSlug));
    const providerSource = new Map(
      available.map((p) => [p.providerSlug, p.source] as const),
    );

    const grantMode =
      user.orgId !== null ? inferGrantMode(user.orgId, user.id) : "allow-all";
    const grants =
      user.orgId !== null
        ? resolveGrantsForUser(user.orgId, user.id)
        : { exact: new Set<string>(), wildcard: new Set<string>() };

    const reachable = declaredModels.filter((m) => {
      if (!availableSlugs.has(m.provider)) return false;
      // Personal provider overrides bypass the grant check.
      if (providerSource.get(m.provider) === "user") return true;
      // Bootstrap mode: no grants anywhere, don't gate.
      if (grantMode === "allow-all") return true;
      return isModelGrantedToUser(m.provider, m.model, grants);
    });

    return {
      models: reachable.map((m) => ({
        provider: m.provider,
        model: m.model,
        displayName: m.displayName,
        source: providerSource.get(m.provider) ?? "org",
      })),
      availableProviders: available,
      hasAny: reachable.length > 0,
      canAddPersonal,
      hasAssistant: !!assistant,
      grantMode,
    };
  });

  // ─── Personal providers ───────────────────────────────────────

  app.get("/api/me/providers", { preHandler: requireAuth }, async (request) => {
    const user = requireUser(request);
    const personal = listUserProviders(user.id);
    const org = user.orgId ? listOrgProviders(user.orgId) : [];
    return {
      personal,
      org: org.map((p) => ({
        providerSlug: p.providerSlug,
        displayName: p.displayName,
        baseUrl: p.baseUrl,
        enabled: p.enabled,
        source: "org" as const,
      })),
      canAddPersonal: effectivePolicyAllowsUserOverride(user),
    };
  });

  const upsertProviderSchema = z.object({
    apiKey: z.string().min(1),
    baseUrl: z.string().url().optional(),
    enabled: z.boolean().optional(),
  });

  app.put<{ Params: { slug: string } }>(
    "/api/me/providers/:slug",
    { preHandler: requireAuth },
    async (request, reply) => {
      const user = requireUser(request);
      if (!effectivePolicyAllowsUserOverride(user)) {
        return reply.status(403).send({
          error: "USER_OVERRIDE_NOT_ALLOWED",
          message:
            "Your org's policy does not permit per-user provider overrides.",
        });
      }
      const parse = upsertProviderSchema.safeParse(request.body);
      if (!parse.success) {
        return reply.status(400).send({
          error: "INVALID_BODY",
          message: parse.error.message,
        });
      }
      upsertUserProvider(user.id, request.params.slug, parse.data.apiKey, {
        baseUrl: parse.data.baseUrl ?? null,
        enabled: parse.data.enabled,
      });
      return { ok: true };
    },
  );

  app.delete<{ Params: { slug: string } }>(
    "/api/me/providers/:slug",
    { preHandler: requireAuth },
    async (request, reply) => {
      const user = requireUser(request);
      const removed = deleteUserProvider(user.id, request.params.slug);
      if (!removed) {
        return reply.status(404).send({ error: "NOT_FOUND" });
      }
      return { deleted: true };
    },
  );
}
