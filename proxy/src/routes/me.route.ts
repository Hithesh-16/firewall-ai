import { FastifyInstance } from "fastify";
import { z } from "zod";

import { requireAuth } from "../auth/authMiddleware";
import crypto from "node:crypto";

import {
  inferGrantMode,
  isModelGrantedToUser,
  listGrantsForUser,
  resolveGrantsForUser,
} from "../gateway/modelGrantService";
import {
  deleteUserProvider,
  listAvailableProvidersForUser,
  listOrgProviders,
  listUserProviders,
  resolveProviderForUser,
  upsertUserProvider,
} from "../gateway/userProviderService";
import {
  canonicalProviderApiBase,
  listUserModels,
  listUserModelsWithKeys,
} from "../gateway/userModelService";
import {
  listSubscribedItems,
  reconcileCatalogueFiles,
} from "../gateway/orgCatalogueService";
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

      // Single-source architecture: the assistant YAML is a VIEW,
      // not a stored blob. We synthesise it on every call from:
      //   - user_models + model_grants → `models:`
      //   - subscribed org_rules      → `rules:`
      //   - (subscribed org_skills are mirrored to disk instead)
      //
      // Personal rules / MCP servers / prompts that the user
      // authors directly into `~/.ai-firewall/` are read by the
      // IDE/CLI locally and merged after this response — the
      // proxy does NOT store them.
      // Need decrypted per-model keys here so the synthesised
      // assistant YAML can embed each model's own apiKey inline — the
      // `user_providers` fallback in `injectProviderKeys` can't tell
      // apart two rows that share a provider slug but were added with
      // different keys (e.g. personal vs company Groq account).
      const userRows = listUserModelsWithKeys(user.id);
      const grants = user.orgId
        ? listGrantsForUser(user.orgId, user.id).filter(
            (g) => g.modelSlug !== "*",
          )
        : [];
      const canonicalModels = buildCanonicalModels(userRows, grants);
      const subscribedRules = listSubscribedItems("rule", user.id);

      // Reflect subscribed items onto disk so the IDE + CLI pick
      // up markdown files in the layout users can edit directly.
      try {
        reconcileCatalogueFiles("rule", user.id);
        reconcileCatalogueFiles("skill", user.id);
      } catch {
        /* filesystem mirror is best-effort */
      }

      const yaml = buildFallbackAssistantYaml(canonicalModels, subscribedRules);
      const baseEtag =
        "v2:" +
        crypto.createHash("sha256").update(yaml).digest("hex").slice(0, 16);

      const injected = await injectProviderKeys(yaml, user.id, user.orgId);
      const injectedEtag =
        baseEtag +
        ":" +
        crypto.createHash("sha256").update(injected).digest("hex").slice(0, 12);

      const incomingEtag = request.headers["if-none-match"];
      if (incomingEtag && incomingEtag === injectedEtag) {
        return reply.status(304).send();
      }

      reply.header("ETag", injectedEtag);
      return {
        assistant: {
          slug: "default",
          name: "Personal assistant",
          owner: { type: "user" as const, id: user.id },
          yaml: injected,
          etag: injectedEtag,
          isDefault: true,
          updatedAt: Date.now(),
        },
      };
    },
  );

  // NOTE: the `/api/me/assistants/*` CRUD endpoints (PUT, DELETE,
  // default, list) were removed when the `assistants` table was
  // dropped. Rules live in `org_rules`; skills in `org_skills`;
  // models in `user_models`; personal MCP/prompts are local files.
  // The singular `/api/me/assistant` endpoint above synthesises a
  // read-only view from those sources — there's nothing to mutate
  // here anymore.

  // ─── Models (flattened list for clients) ──────────────────────

  app.get("/api/me/models", { preHandler: requireAuth }, async (request) => {
    const user = requireUser(request);
    const available = listAvailableProvidersForUser(user.id, user.orgId);
    const canAddPersonal = effectivePolicyAllowsUserOverride(user);

    // The flat list is built from `user_models` + `model_grants`
    // (the single source of truth after the refactor) — no longer
    // derived from an assistant YAML blob.
    const userModelRows = listUserModels(user.id);
    const grantsForFlat = user.orgId
      ? listGrantsForUser(user.orgId, user.id).filter(
          (g) => g.modelSlug !== "*",
        )
      : [];
    const declaredModels: Array<{
      provider: string;
      model: string;
      displayName?: string;
    }> = [
      ...userModelRows.map((m) => ({
        provider: m.providerSlug,
        model: m.modelSlug,
        displayName: m.displayName ?? undefined,
      })),
      ...grantsForFlat.map((g) => ({
        provider: g.providerSlug,
        model: g.modelSlug,
        displayName: undefined,
      })),
    ];

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
      // Kept for backwards compatibility with callers that expect
      // this key; post-refactor the IDE's gating is based on
      // `hasAny` (user_models + grants). Always true since the
      // synthesised assistant view is never absent.
      hasAssistant: true,
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
    /** Model to add to the user's default assistant. */
    model: z.string().optional(),
    /** Display name for the model. */
    modelDisplayName: z.string().optional(),
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

      // ── Auto-sync assistant YAML ─────────────────────────────
      // When a user adds a provider, ensure their default assistant
      // YAML actually references a model from that provider. Without
      // this, the provider key is stored but `/api/me/models` sees
      // zero reachable models because the YAML only lists models
      // from the OLD provider.
      //
      // Models are managed independently via /api/me/models/add —
      // adding a provider key no longer auto-populates the assistant
      // YAML (there is no assistants table anymore). Users either
      // add a model through Settings → Models, or an admin grants
      // them one via /api/orgs/:id/model-grants.
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

      // Models for this provider in `user_models` become orphaned
      // when the key goes away — but we DON'T delete them here.
      // They stay listed (with an empty `apiKey`) so the user can
      // see "add a key for gpt-4o" rather than "your model vanished".
      // Explicit delete lives under DELETE /api/me/models/:id.
      return { deleted: true };
    },
  );
}

/**
 * Inject resolved provider API keys into an assistant YAML.
 *
 * The stored YAML is key-free — API keys live in the encrypted
 * `user_providers` / `org_providers` tables and are only
 * materialised into the wire response. For each `models:` entry
 * we look up the key via `resolveProviderForUser` (user override
 * first, org default second) and rewrite the block with an
 * `apiKey:` line.
 *
 * Design notes:
 *
 *   - Uses a string-replacement pass rather than a full YAML
 *     parse/re-serialise, because yaml.parse + yaml.stringify
 *     rewrites comments, ordering, and quoting, which would
 *     surprise users who hand-edit the YAML in the Monaco
 *     editor. The regex is deliberately conservative — it only
 *     touches lines inside the `models:` block and it only
 *     inserts (never removes) `apiKey:` lines.
 *
 *   - If a user has no provider for a model's slug we silently
 *     skip the injection. The CLI's unroller will list the
 *     model but calling it will fail with a clear
 *     "missing credentials" error from the upstream SDK —
 *     which is the correct UX for "you forgot to add a key".
 *
 *   - `baseUrl` from the user/org provider overrides the YAML's
 *     base URL when the provider has a non-default endpoint
 *     (Azure, Ollama, Bedrock). We only inject if the YAML
 *     doesn't already have its own `apiBase:` line.
 */
/**
 * The canonical, single-source-of-truth shape for a user-visible
 * model. Built by merging `user_models` (self-added) with
 * non-wildcard `model_grants` (admin-assigned). This is what every
 * consumer of `/api/me/assistant` sees as the `models:` block,
 * regardless of whether the user has an `assistants` row or not.
 */
interface CanonicalModel {
  name: string;
  providerSlug: string;
  modelSlug: string;
  apiBase: string | null;
  /**
   * Per-model API key decrypted from `user_models.api_key_encrypted`.
   * Populated for rows the user added via `/api/me/models/add`; grants
   * leave it null and fall through to `injectProviderKeys` which pulls
   * an org-wide key from `user_providers` / `org_providers`.
   *
   * Keeping the key on the canonical model (instead of re-resolving
   * from `user_providers` like the pre-refactor path did) is what lets
   * users add two models on the same provider with different keys —
   * e.g. a personal Groq key for chat + a company Groq key for edits —
   * without one clobbering the other.
   */
  apiKey: string | null;
  roles: string[];
}

function buildCanonicalModels(
  userRows: ReturnType<typeof listUserModelsWithKeys>,
  grants: ReturnType<typeof listGrantsForUser>,
): CanonicalModel[] {
  const seen = new Set<string>();
  const out: CanonicalModel[] = [];

  // Personal rows first — if both sources mention the same pair the
  // personal row wins (it carries the user's own display name + base).
  for (const m of userRows) {
    const key = `${m.providerSlug}/${m.modelSlug}`;
    if (seen.has(key)) continue;
    seen.add(key);
    // Phase H.H2: Map our internal 'custom' slug to Continue's 'openai' adapter
    const providerSlug =
      m.providerSlug === "custom" ? "openai" : m.providerSlug;
    out.push({
      name: m.displayName || m.modelSlug,
      providerSlug,
      modelSlug: m.modelSlug,
      apiBase: m.apiBase ?? null,
      apiKey: m.apiKey || null,
      roles: m.roles && m.roles.length > 0 ? m.roles : ["chat"],
    });
  }

  for (const g of grants) {
    const key = `${g.providerSlug}/${g.modelSlug}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      name: g.modelSlug,
      providerSlug: g.providerSlug,
      modelSlug: g.modelSlug,
      apiBase: null,
      apiKey: null,
      roles: ["chat", "edit", "apply"],
    });
  }
  return out;
}

function serialiseModelsBlock(models: CanonicalModel[]): string {
  if (models.length === 0) return "models: []\n";
  const lines: string[] = ["models:"];
  for (const m of models) {
    lines.push(`  - name: ${JSON.stringify(m.name)}`);
    lines.push(`    provider: ${m.providerSlug}`);
    lines.push(`    model: ${m.modelSlug}`);
    if (m.apiBase) {
      lines.push(`    apiBase: ${m.apiBase}`);
    }
    if (m.apiKey) {
      lines.push(`    apiKey: ${m.apiKey}`);
    }
    lines.push("    roles:");
    for (const r of m.roles) {
      lines.push(`      - ${r}`);
    }
  }
  return lines.join("\n") + "\n";
}

/**
 * Build the fallback assistant YAML when no `assistants` row exists
 * for a user. Produces a minimal but complete Continue-compatible
 * document — `name`/`schema`/`version` + canonical models + any
 * installed org rules.
 */
function buildFallbackAssistantYaml(
  models: CanonicalModel[],
  rules: ReturnType<typeof listSubscribedItems>,
): string {
  const header = "name: Personal assistant\nschema: v1\nversion: 0.0.1\n";
  let body = header + serialiseModelsBlock(models);
  if (rules.length > 0) {
    body += serialiseRulesBlock(rules);
  }
  return body;
}

function serialiseRulesBlock(
  rules: ReturnType<typeof listSubscribedItems>,
): string {
  const lines: string[] = ["rules:"];
  for (const r of rules) {
    // Continue accepts either strings or objects; the object form
    // with `name` + `rule` keeps the catalogue labels visible in
    // logs and debug dumps. Use block-literal (`|`) so newlines in
    // the markdown body are preserved without re-escaping.
    lines.push(`  - name: ${JSON.stringify(r.title)}`);
    lines.push("    rule: |");
    for (const l of r.body.split("\n")) {
      lines.push(`      ${l}`);
    }
  }
  return lines.join("\n") + "\n";
}

// Dead code removed: `appendSubscribedRules`, `replaceModelsBlock`,
// `stripModelsBlock` — all three supported the (retired) `assistants`
// table's stored-YAML path. Post-refactor the synthesised YAML is
// built from scratch every time via `buildFallbackAssistantYaml`,
// so none of the merge/strip helpers have callers.

async function injectProviderKeys(
  yaml: string,
  userId: number,
  orgId: number | null,
): Promise<string> {
  const yamlMod = await import("yaml");
  let parsed: Record<string, unknown>;
  try {
    parsed = yamlMod.parse(yaml) as Record<string, unknown>;
  } catch {
    return yaml;
  }

  const models = Array.isArray(parsed?.models)
    ? (parsed.models as Array<Record<string, unknown>>)
    : [];
  if (models.length === 0) return yaml;

  // Resolve the unique set of providers referenced in the YAML so
  // we only hit the DB once per slug.
  const providerSlugs = Array.from(
    new Set(
      models
        .map((m) => (typeof m?.provider === "string" ? m.provider : null))
        .filter((s): s is string => !!s),
    ),
  );

  const resolved = new Map<
    string,
    { apiKey: string; baseUrl: string | null; source: "user" | "org" }
  >();
  for (const slug of providerSlugs) {
    const r = resolveProviderForUser(userId, orgId, slug);
    if (r) {
      resolved.set(slug, {
        apiKey: r.apiKey,
        baseUrl: r.baseUrl,
        source: r.source,
      });
    }
  }
  if (resolved.size === 0) return yaml;

  // Mutate the parsed object in place with resolved keys.
  for (const m of models) {
    const slug = typeof m?.provider === "string" ? m.provider : null;
    if (!slug) continue;
    const hit = resolved.get(slug);
    if (!hit) continue;

    // Don't clobber a user-supplied apiKey in the YAML.
    if (!m.apiKey && hit.apiKey) {
      m.apiKey = hit.apiKey;
    }
    // Only inject apiBase if the user/org explicitly set one and
    // the YAML didn't already declare one. `user_providers.base_url`
    // is stored as whatever the user typed — including bare origins
    // like `https://api.anthropic.com` that need `/v1/` appended
    // before an SDK client can resolve `new URL("messages", apiBase)`
    // correctly. Canonicalise here so every consumer of the synthesised
    // YAML (CLI sync, IDE config, etc.) sees a usable prefix.
    if (!m.apiBase && hit.baseUrl) {
      m.apiBase = canonicalProviderApiBase(slug, hit.baseUrl) ?? hit.baseUrl;
    }
  }

  // Re-serialise. yaml.stringify's defaults are close enough to
  // our input format (2-space indent, no flow style) for CLI
  // consumers — they never see the YAML directly anyway.
  return yamlMod.stringify(parsed);
}
