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
import { resolveProviderForUser } from "../gateway/userProviderService";
import {
  addModel,
  deleteModel,
  listModels,
  updateModel,
} from "../gateway/modelService";

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
        const provider = createProvider(data.name, apiKey, resolvedBaseUrl);
        return reply.status(201).send({
          id: provider.id,
          name: provider.name,
          slug: provider.slug,
          baseUrl: provider.baseUrl,
          enabled: provider.enabled,
          createdAt: provider.createdAt,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        if (msg.includes("UNIQUE constraint")) {
          return reply
            .status(409)
            .send({ error: "Provider with this name already exists" });
        }
        return reply.status(500).send({ error: msg });
      }
    },
  );

  app.get(
    "/api/providers",
    { preHandler: [requireAuth, requireCapability("provider:read")] },
    async () => {
      const providers = listProviders();
      return providers.map((p) => ({
        id: p.id,
        name: p.name,
        slug: p.slug,
        baseUrl: p.baseUrl,
        enabled: p.enabled,
        createdAt: p.createdAt,
      }));
    },
  );

  app.get(
    "/api/providers/:id",
    { preHandler: [requireAuth, requireCapability("provider:read")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const provider = getProviderById(Number(id));
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

      // 3: legacy global registry fallback. Will be removed once C2
      // makes the user/org scope the canonical write path.
      const global = getProviderBySlug(slug);
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
      const { id } = request.params as { id: string };
      const parsed = updateProviderSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "Invalid payload", details: parsed.error.flatten() });
      }
      const updated = updateProvider(Number(id), parsed.data);
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
      const { id } = request.params as { id: string };
      const deleted = deleteProvider(Number(id));
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
      const { providerId } = request.params as { providerId: string };
      const provider = getProviderById(Number(providerId));
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
        const model = addModel(Number(providerId), parsed.data.modelName, {
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
      const { providerId } = request.params as { providerId: string };
      const provider = getProviderById(Number(providerId));
      if (!provider) {
        return reply.status(404).send({ error: "Provider not found" });
      }
      return listModels(Number(providerId));
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
