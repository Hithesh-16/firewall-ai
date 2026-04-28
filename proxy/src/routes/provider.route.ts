import { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth, requireCapability } from "../auth/authMiddleware";
import {
  createProvider,
  decryptProviderKey,
  deleteProvider,
  getProviderBySlug,
  listProviders,
  getProviderById,
  updateProvider,
} from "../gateway/providerService";
import {
  deleteOrgProvider,
  deleteUserProvider,
  listOrgProviders,
  listUserProviders,
  resolveProviderForUser,
  upsertOrgProvider,
  upsertUserProvider,
} from "../gateway/userProviderService";
import { createGrant } from "../gateway/modelGrantService";
import {
  addModel,
  deleteModel,
  listModels,
  updateModel,
} from "../gateway/modelService";
import { addUserModel } from "../gateway/userModelService";

/**
 * Canonical "default model" per provider kind. When an admin adds a
 * provider during onboarding we auto-map one sensible model into their
 * personal `user_models` table so they can chat immediately — the
 * mandatory-models gate (`ModelGate` in web) counts `user_models`
 * rows, not wildcard grants, so an admin with only a provider key
 * would otherwise be bounced to a blank /settings/models page.
 *
 * Admins can add more via Settings → Models; this just picks the
 * single flagship so the first-run experience isn't broken.
 */
const DEFAULT_MODEL_BY_KIND: Record<
  string,
  { modelSlug: string; displayName: string } | null
> = {
  openai: { modelSlug: "gpt-4o", displayName: "GPT-4o" },
  anthropic: {
    modelSlug: "claude-sonnet-4-5-20250929",
    displayName: "Claude 4.5 Sonnet",
  },
  gemini: { modelSlug: "gemini-1.5-pro", displayName: "Gemini 1.5 Pro" },
  mistral: { modelSlug: "mistral-large-latest", displayName: "Mistral Large" },
  ollama: { modelSlug: "llama3.2:latest", displayName: "Llama 3.2" },
  // Azure + custom: the caller has to supply deployment/model names;
  // we can't guess a correct default so skip the seed.
  azure: null,
  custom: null,
};

/**
 * Deterministic djb2-style hash for a string. Used to synthesise
 * stable negative pseudo-ids for org-scoped provider rows in the
 * flat `GET /api/providers` response.
 */
function hashSlug(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  }
  return h % 1_000_000_000 || 1;
}

/**
 * Default base URLs per provider kind. The web onboarding wizard sends
 * `kind` and relies on us to fill in `baseUrl` when the user didn't
 * provide one (which is the common case for OpenAI/Anthropic/Gemini).
 *
 * Keys match `OnboardingProviderDraft.kind` in the web/ slice.
 */
const DEFAULT_PROVIDER_BASE_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
  mistral: "https://api.mistral.ai/v1",
  ollama: "http://localhost:11434",
};

const createProviderSchema = z
  .object({
    name: z.string().min(1),
    /**
     * Optional high-level kind hint from the onboarding wizard.
     * When provided, `baseUrl` may be omitted and will be filled in
     * from DEFAULT_PROVIDER_BASE_URLS.
     */
    kind: z
      .enum([
        "openai",
        "anthropic",
        "gemini",
        "mistral",
        "azure",
        "ollama",
        "custom",
      ])
      .optional(),
    apiKey: z.string().optional(),
    baseUrl: z.string().url().optional(),
    deploymentName: z.string().optional(),
  })
  .refine((v) => v.baseUrl || (v.kind && DEFAULT_PROVIDER_BASE_URLS[v.kind]), {
    message:
      "baseUrl is required (or send a `kind` with a known default, e.g. openai)",
    path: ["baseUrl"],
  })
  .refine(
    (v) => {
      // Ollama doesn't need a key; everyone else does.
      if (v.kind === "ollama") return true;
      return typeof v.apiKey === "string" && v.apiKey.length > 0;
    },
    { message: "apiKey is required for this provider", path: ["apiKey"] },
  );

const updateProviderSchema = z.object({
  name: z.string().min(1).optional(),
  apiKey: z.string().min(1).optional(),
  baseUrl: z.string().url().optional(),
  enabled: z.boolean().optional(),
});

const addModelSchema = z.object({
  modelName: z.string().min(1),
  displayName: z.string().optional(),
  inputCostPer1k: z.number().min(0).optional(),
  outputCostPer1k: z.number().min(0).optional(),
  maxContextTokens: z.number().int().min(0).optional(),
});

const updateModelSchema = z.object({
  displayName: z.string().optional(),
  inputCostPer1k: z.number().min(0).optional(),
  outputCostPer1k: z.number().min(0).optional(),
  maxContextTokens: z.number().int().min(0).optional(),
  enabled: z.boolean().optional(),
});

export async function registerProviderRoutes(
  app: FastifyInstance,
): Promise<void> {
  // --- Providers ---

  app.post(
    "/api/providers",
    { preHandler: [requireAuth, requireCapability("provider:manage")] },
    async (request, reply) => {
      const parsed = createProviderSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "Invalid payload", details: parsed.error.flatten() });
      }

      // Multi-tenancy: every new provider must belong to an org. The
      // caller is authenticated here (requireAuth preHandler), so we
      // pull their org from the auth context rather than trusting the
      // request body.
      const ctxOrgId = request.authContext?.user?.orgId;
      if (!ctxOrgId) {
        return reply.status(403).send({
          error: "Caller is not attached to an organisation",
          code: "NO_ORG",
        });
      }

      try {
        const data = parsed.data;
        const resolvedBaseUrl =
          data.baseUrl ??
          (data.kind ? DEFAULT_PROVIDER_BASE_URLS[data.kind] : undefined);
        if (!resolvedBaseUrl) {
          return reply
            .status(400)
            .send({ error: "Could not resolve provider base URL" });
        }
        // Ollama doesn't have an API key; pass a sentinel placeholder
        // so the encrypted-vault layer doesn't blow up on empty string.
        const apiKey = data.apiKey ?? "__no_key_required__";

        // Derive a deterministic slug from the kind (preferred — matches
        // provider slugs the gateway resolves against, e.g. "anthropic",
        // "openai") falling back to a slugified name. The kind is what
        // onboarding Step 5 sends; the display name is arbitrary.
        const slug = (
          data.kind && data.kind !== "custom" ? data.kind : data.name
        )
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/(^-|-$)/g, "");

        // Write into `org_providers` via upsert. This matches the
        // scoped read paths (`GET /api/providers`, `/api/me/providers`)
        // and lets admins rotate a key by re-submitting without hitting
        // a 409. Prior versions wrote to the legacy `providers` table,
        // which diverged from the read path and surfaced "already
        // exists" to users whose fresh org had been seeded by the
        // legacy-copy boot migration.
        upsertOrgProvider(ctxOrgId, slug, apiKey, {
          baseUrl: resolvedBaseUrl,
          displayName: data.name,
          enabled: true,
        });

        // Mirror into the legacy `providers` table as a vault fallback
        // for the few resolver paths that still hit it (e.g. token
        // refresh jobs). Safe to no-op if the row already exists.
        try {
          const existingLegacy = getProviderBySlug(slug, ctxOrgId);
          if (!existingLegacy) {
            createProvider(data.name, apiKey, resolvedBaseUrl, ctxOrgId);
          }
        } catch {
          // Non-fatal: the legacy mirror is a belt-and-braces fallback,
          // org_providers is the source of truth.
        }

        // Auto-grant + auto-seed for the admin who just added the
        // provider so the web `/settings/models` page and the
        // mandatory-models gate both recognise them as ready.
        //
        //   1. Wildcard model_grants row — covers any future model
        //      on this provider. Cheap; makes team-grants additive.
        //   2. user_models seed with a canonical default model slug —
        //      the `ModelGate` reads `user_models` (grants with
        //      modelSlug="*" are deliberately filtered out of the
        //      list) so without this the admin would land on a
        //      blank page and be forced to re-enter their key.
        const grantorId = request.authContext?.user?.id;
        if (grantorId) {
          try {
            createGrant({
              orgId: ctxOrgId,
              granteeType: "user",
              granteeId: grantorId,
              providerSlug: slug,
              modelSlug: "*",
              grantedBy: grantorId,
            });
          } catch {
            // Non-fatal.
          }

          const defaultModel = data.kind
            ? DEFAULT_MODEL_BY_KIND[data.kind]
            : null;
          if (defaultModel) {
            try {
              addUserModel({
                userId: grantorId,
                providerSlug: slug,
                modelSlug: defaultModel.modelSlug,
                displayName: defaultModel.displayName,
                apiKey,
                apiBase: resolvedBaseUrl,
                roles: ["chat", "edit", "apply"],
                createdBy: grantorId,
              });
            } catch {
              // Non-fatal: provider is still registered; admin can add
              // models manually from Settings → Models.
            }
          }
        }

        // Respond with the shape onboarding expects. Use the synthesised
        // negative ID consistent with the GET /api/providers list so
        // subsequent calls to /api/providers/:id/models can resolve it.
        const synthesisedId = -Math.abs(hashSlug(`org:${ctxOrgId}:${slug}`));
        const row = listOrgProviders(ctxOrgId).find(
          (p) => p.providerSlug === slug,
        );
        return reply.status(201).send({
          id: synthesisedId,
          name: data.name,
          slug,
          baseUrl: resolvedBaseUrl,
          enabled: true,
          createdAt: row?.createdAt ?? Date.now(),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        return reply.status(500).send({ error: msg });
      }
    },
  );

  app.get(
    "/api/providers",
    { preHandler: [requireAuth, requireCapability("provider:read")] },
    async (request) => {
      // Scope to the caller's user + org so the admin provider list
      // can't leak other orgs' rows. Returns the SAME flat-array
      // shape the endpoint has always returned (existing callers:
      // ModelPicker, SecurityDashboard, ProvidersTab, UserModelsTab
      // all expect an array), just scoped via user_providers +
      // org_providers rather than `listProviders()` globally.
      //
      // Each row is shaped {id, name, slug, baseUrl, enabled,
      // createdAt} to match the existing contract. Personal rows
      // carry their real db id; org rows get a synthesised negative
      // id so the two namespaces can't collide on the client.
      const user = request.authContext?.user;
      const userId = user?.id;
      const orgId = user?.orgId;

      const personal = userId ? listUserProviders(userId) : [];
      const org = orgId ? listOrgProviders(orgId) : [];

      const personalRows = personal.map((p) => ({
        id:
          -Math.abs(hashSlug(`user:${userId}:${p.providerSlug}`)) - 2000000000,
        name: p.providerSlug,
        slug: p.providerSlug,
        baseUrl: p.baseUrl ?? "",
        enabled: p.enabled,
        createdAt: p.createdAt,
      }));

      // Synthesise ids for org rows using a djb2-style hash so two
      // orgs with overlapping slugs don't collide. Kept negative to
      // signal "not a real personal-provider row" to downstream
      // code that tries to call DELETE /api/providers/:id on it.
      const orgRows = org.map((p) => ({
        id: -Math.abs(hashSlug(`org:${orgId}:${p.providerSlug}`)),
        name: p.displayName ?? p.providerSlug,
        slug: p.providerSlug,
        baseUrl: p.baseUrl ?? "",
        enabled: p.enabled,
        createdAt: 0,
      }));

      // De-dupe: if a user has a personal override for the same slug
      // they see in the org list, the personal row wins.
      const seen = new Set(personalRows.map((r) => r.slug));
      const combined = [
        ...personalRows,
        ...orgRows.filter((r) => !seen.has(r.slug)),
      ];
      return combined;
    },
  );

  app.get(
    "/api/providers/:id",
    { preHandler: [requireAuth, requireCapability("provider:read")] },
    async (request, reply) => {
      const { id: idStr } = request.params as { id: string };
      const id = Number(idStr);
      const user = request.authContext?.user;

      if (id < 0) {
        // Handle synthesised IDs for org/user scoped providers
        if (user?.orgId) {
          const org = listOrgProviders(user.orgId);
          const match = org.find(
            (p) =>
              -Math.abs(hashSlug(`org:${user.orgId}:${p.providerSlug}`)) === id,
          );
          if (match) {
            return {
              id,
              name: match.displayName ?? match.providerSlug,
              slug: match.providerSlug,
              baseUrl: match.baseUrl ?? "",
              enabled: match.enabled,
              createdAt: match.createdAt,
              updatedAt: match.updatedAt,
            };
          }
        }
        if (user?.id) {
          const personal = listUserProviders(user.id);
          const match = personal.find(
            (p) =>
              -Math.abs(hashSlug(`user:${user.id}:${p.providerSlug}`)) -
                2000000000 ===
              id,
          );
          if (match) {
            return {
              id,
              name: match.providerSlug,
              slug: match.providerSlug,
              baseUrl: match.baseUrl ?? "",
              enabled: match.enabled,
              createdAt: match.createdAt,
              updatedAt: match.updatedAt,
            };
          }
        }
      }

      const provider = getProviderById(id);
      if (!provider) {
        return reply.status(404).send({ error: "Provider not found" });
      }
      return {
        id: provider.id,
        name: provider.name,
        slug: provider.slug,
        baseUrl: provider.baseUrl,
        enabled: provider.enabled,
        createdAt: provider.createdAt,
        updatedAt: provider.updatedAt,
      };
    },
  );

  /**
   * GET /api/providers/by-slug/:slug — Phase C.C1
   * (SECURITY_HARDENING_PLAN.md)
   *
   * Vault resolver. Authenticated callers (the BaseLLM constructor
   * once C3 lands, plus any other proxy-side resolver) hit this
   * endpoint with `apiKeyRef: vault://<slug>` material to get the
   * decrypted API key + base URL out of the vault.
   *
   * Resolution order matches `resolveProviderForUser`:
   *   1. user override   (caller's personal `user_providers` row)
   *   2. org default     (caller's org's `org_providers` row)
   *   3. global registry (the legacy `providers` table)
   *
   * The first match wins. If nothing matches, return 404 — callers
   * MUST fail closed (Phase C principle: "no silent downgrade to
   * plaintext"). The legacy global fallback is kept until C2/C3
   * fully migrate the onboarding flow; future PRs can drop it.
   *
   * Audit: every successful resolve is logged via the existing
   * `admin_audit` channel (TODO in Phase C follow-up).
   */
  app.get(
    "/api/providers/by-slug/:slug",
    { preHandler: [requireAuth, requireCapability("provider:read")] },
    async (request, reply) => {
      const { slug } = request.params as { slug: string };
      if (!slug || slug.length === 0) {
        return reply.status(400).send({ error: "slug is required" });
      }

      const ctx = request.authContext;
      const userId = ctx?.user?.id ?? null;
      const orgId = ctx?.user?.orgId ?? null;

      // 1 + 2: user / org scoped resolution.
      const resolved = resolveProviderForUser(userId, orgId, slug);
      if (resolved) {
        return {
          slug: resolved.providerSlug,
          baseUrl: resolved.baseUrl ?? null,
          source: resolved.source,
          decryptedKey: resolved.apiKey,
        };
      }

      // 3: legacy global registry fallback. Only fires when the caller
      // has an org — global lookups without org scope were removed in
      // the BUG-ONBOARD migration to prevent cross-org leakage.
      const global = orgId ? getProviderBySlug(slug, orgId) : null;
      if (global && global.enabled) {
        return {
          slug: global.slug,
          providerId: global.id,
          baseUrl: global.baseUrl,
          source: "global" as const,
          decryptedKey: decryptProviderKey(global),
        };
      }

      return reply.status(404).send({
        error: "Provider not found",
        slug,
        message:
          "No vault entry resolves this slug. Add it via POST /api/providers " +
          "or PUT /api/me/providers/:slug. SECURITY_HARDENING_PLAN.md C2 " +
          "tracks the onboarding rewrite that makes this the only write path.",
      });
    },
  );

  app.patch(
    "/api/providers/:id",
    { preHandler: [requireAuth, requireCapability("provider:manage")] },
    async (request, reply) => {
      const { id: idStr } = request.params as { id: string };
      const id = Number(idStr);
      const user = request.authContext?.user;

      const parsed = updateProviderSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "Invalid payload", details: parsed.error.flatten() });
      }

      if (id < 0) {
        // Handle synthesised IDs for org/user scoped providers
        if (user?.orgId) {
          const org = listOrgProviders(user.orgId);
          const match = org.find(
            (p) =>
              -Math.abs(hashSlug(`org:${user.orgId}:${p.providerSlug}`)) === id,
          );
          if (match) {
            upsertOrgProvider(
              user.orgId,
              match.providerSlug,
              parsed.data.apiKey ?? "",
              {
                baseUrl: parsed.data.baseUrl,
                displayName: parsed.data.name,
                enabled: parsed.data.enabled,
              },
            );
            return { success: true };
          }
        }
        if (user?.id) {
          const personal = listUserProviders(user.id);
          const match = personal.find(
            (p) =>
              -Math.abs(hashSlug(`user:${user.id}:${p.providerSlug}`)) -
                2000000000 ===
              id,
          );
          if (match) {
            upsertUserProvider(
              user.id,
              match.providerSlug,
              parsed.data.apiKey ?? "",
              {
                baseUrl: parsed.data.baseUrl,
                enabled: parsed.data.enabled,
              },
            );
            return { success: true };
          }
        }
      }

      const updated = updateProvider(id, parsed.data);
      if (!updated) {
        return reply.status(404).send({ error: "Provider not found" });
      }
      return {
        id: updated.id,
        name: updated.name,
        slug: updated.slug,
        baseUrl: updated.baseUrl,
        enabled: updated.enabled,
        updatedAt: updated.updatedAt,
      };
    },
  );

  app.delete(
    "/api/providers/:id",
    { preHandler: [requireAuth, requireCapability("provider:manage")] },
    async (request, reply) => {
      const { id: idStr } = request.params as { id: string };
      const id = Number(idStr);
      const user = request.authContext?.user;

      if (id < 0) {
        // Handle synthesised IDs for org/user scoped providers
        if (user?.orgId) {
          const org = listOrgProviders(user.orgId);
          const match = org.find(
            (p) =>
              -Math.abs(hashSlug(`org:${user.orgId}:${p.providerSlug}`)) === id,
          );
          if (match) {
            const success = deleteOrgProvider(user.orgId, match.providerSlug);
            return { success };
          }
        }
        if (user?.id) {
          const personal = listUserProviders(user.id);
          const match = personal.find(
            (p) =>
              -Math.abs(hashSlug(`user:${user.id}:${p.providerSlug}`)) -
                2000000000 ===
              id,
          );
          if (match) {
            const success = deleteUserProvider(user.id, match.providerSlug);
            return { success };
          }
        }
      }

      const deleted = deleteProvider(id);
      if (!deleted) {
        return reply.status(404).send({ error: "Provider not found" });
      }
      return { success: true };
    },
  );

  // --- Models ---

  app.post(
    "/api/providers/:providerId/models",
    { preHandler: [requireAuth, requireCapability("provider:manage")] },
    async (request, reply) => {
      const { providerId: idStr } = request.params as { providerId: string };
      const id = Number(idStr);
      const user = request.authContext?.user;

      let provider = null;
      if (id < 0 && user?.orgId) {
        const org = listOrgProviders(user.orgId);
        const match = org.find(
          (p) =>
            -Math.abs(hashSlug(`org:${user.orgId}:${p.providerSlug}`)) === id,
        );
        if (match) {
          provider = getProviderBySlug(match.providerSlug, user.orgId);
        }
      } else {
        provider = getProviderById(id);
      }

      if (!provider) {
        return reply.status(404).send({ error: "Provider not found" });
      }

      const parsed = addModelSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "Invalid payload", details: parsed.error.flatten() });
      }

      try {
        const model = addModel(provider.id, parsed.data.modelName, {
          displayName: parsed.data.displayName,
          inputCostPer1k: parsed.data.inputCostPer1k,
          outputCostPer1k: parsed.data.outputCostPer1k,
          maxContextTokens: parsed.data.maxContextTokens,
        });
        return reply.status(201).send(model);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        if (msg.includes("UNIQUE constraint")) {
          return reply
            .status(409)
            .send({ error: "Model already exists for this provider" });
        }
        return reply.status(500).send({ error: msg });
      }
    },
  );

  app.get(
    "/api/providers/:providerId/models",
    { preHandler: [requireAuth, requireCapability("provider:read")] },
    async (request, reply) => {
      const { providerId: idStr } = request.params as { providerId: string };
      const id = Number(idStr);
      const user = request.authContext?.user;

      let provider = null;
      if (id < 0 && user?.orgId) {
        const org = listOrgProviders(user.orgId);
        const match = org.find(
          (p) =>
            -Math.abs(hashSlug(`org:${user.orgId}:${p.providerSlug}`)) === id,
        );
        if (match) {
          provider = getProviderBySlug(match.providerSlug, user.orgId);
        }
      } else {
        provider = getProviderById(id);
      }

      if (!provider) {
        return reply.status(404).send({ error: "Provider not found" });
      }
      return listModels(provider.id);
    },
  );

  app.get(
    "/api/models",
    { preHandler: [requireAuth, requireCapability("provider:read")] },
    async () => {
      return listModels();
    },
  );

  app.patch(
    "/api/models/:id",
    { preHandler: [requireAuth, requireCapability("provider:manage")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = updateModelSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "Invalid payload", details: parsed.error.flatten() });
      }
      const updated = updateModel(Number(id), parsed.data);
      if (!updated) {
        return reply.status(404).send({ error: "Model not found" });
      }
      return updated;
    },
  );

  app.delete(
    "/api/models/:id",
    { preHandler: [requireAuth, requireCapability("provider:manage")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const deleted = deleteModel(Number(id));
      if (!deleted) {
        return reply.status(404).send({ error: "Model not found" });
      }
      return { success: true };
    },
  );
}
