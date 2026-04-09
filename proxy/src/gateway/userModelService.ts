import sqliteDatabase from "../db/database";
import { decrypt, encrypt } from "../vault/encryption";

/**
 * Unified user_models service.
 *
 * One table, one source of truth. Every row = "user X has access to
 * model Y from provider Z with key K." The gateway reads this table
 * on every /v1/chat/completions request via resolveUserModel().
 *
 * Replaces: providers, models, user_providers, org_providers,
 * model_grants, and the models[] block in the assistants YAML.
 */

const raw = sqliteDatabase;

// ─── Types ────────────────────────────────────────────────────────

export interface UserModel {
  id: number;
  userId: number;
  providerSlug: string;
  modelSlug: string;
  displayName: string | null;
  apiKey: string; // decrypted
  apiBase: string | null;
  enabled: boolean;
  roles: string[];
  createdAt: number;
  updatedAt: number;
  createdBy: number | null;
}

/** Public-safe shape — no API key. */
export interface UserModelPublic {
  id: number;
  providerSlug: string;
  modelSlug: string;
  displayName: string | null;
  apiBase: string | null;
  enabled: boolean;
  roles: string[];
  createdAt: number;
  updatedAt: number;
}

interface RawRow {
  id: number;
  user_id: number;
  provider_slug: string;
  model_slug: string;
  display_name: string | null;
  api_key_encrypted: string;
  api_base: string | null;
  enabled: number;
  roles: string | null;
  created_at: number;
  updated_at: number;
  created_by: number | null;
}

function parseRoles(s: string | null): string[] {
  if (!s) return ["chat", "edit", "apply"];
  return s
    .split(",")
    .map((r) => r.trim())
    .filter(Boolean);
}

function rowToModel(row: RawRow): UserModel {
  return {
    id: row.id,
    userId: row.user_id,
    providerSlug: row.provider_slug,
    modelSlug: row.model_slug,
    displayName: row.display_name,
    apiKey: decrypt(row.api_key_encrypted),
    apiBase: row.api_base,
    enabled: row.enabled === 1,
    roles: parseRoles(row.roles),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
  };
}

function rowToPublic(row: RawRow): UserModelPublic {
  return {
    id: row.id,
    providerSlug: row.provider_slug,
    modelSlug: row.model_slug,
    displayName: row.display_name,
    apiBase: row.api_base,
    enabled: row.enabled === 1,
    roles: parseRoles(row.roles),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ─── CRUD ─────────────────────────────────────────────────────────

export function listUserModels(userId: number): UserModelPublic[] {
  const rows = raw
    .prepare(
      `SELECT * FROM user_models
        WHERE user_id = ? AND enabled = 1
        ORDER BY created_at DESC`,
    )
    .all(userId) as RawRow[];
  return rows.map(rowToPublic);
}

export function listUserModelsWithKeys(userId: number): UserModel[] {
  const rows = raw
    .prepare(
      `SELECT * FROM user_models
        WHERE user_id = ? AND enabled = 1
        ORDER BY created_at DESC`,
    )
    .all(userId) as RawRow[];
  return rows.map(rowToModel);
}

export function getUserModel(
  userId: number,
  providerSlug: string,
  modelSlug: string,
): UserModel | null {
  const row = raw
    .prepare(
      `SELECT * FROM user_models
        WHERE user_id = ? AND provider_slug = ? AND model_slug = ?`,
    )
    .get(userId, providerSlug, modelSlug) as RawRow | undefined;
  return row ? rowToModel(row) : null;
}

/**
 * AUTODETECT resolution: when the user has a row with
 * model_slug = "AUTODETECT" for a provider, any model name
 * the client sends for that provider is valid — the key is
 * the same.
 */
export function resolveUserModelForGateway(
  userId: number,
  requestedModel: string,
): UserModel | null {
  // Strategy:
  //   1. Try exact match on model_slug first.
  //   2. Try provider-prefix match (e.g. "openai/gpt-4o" → provider=openai, model=gpt-4o).
  //   3. Try AUTODETECT for any provider that has it.
  //   4. Try substring match (model name might not have provider prefix).

  // 1. Exact slug match
  const exact = raw
    .prepare(
      `SELECT * FROM user_models
        WHERE user_id = ? AND model_slug = ? AND enabled = 1
        LIMIT 1`,
    )
    .get(userId, requestedModel) as RawRow | undefined;
  if (exact) return rowToModel(exact);

  // 2. Provider/model split (e.g. "openai/gpt-4o")
  if (requestedModel.includes("/")) {
    const [provSlug, modSlug] = requestedModel.split("/", 2);
    const split = raw
      .prepare(
        `SELECT * FROM user_models
          WHERE user_id = ? AND provider_slug = ? AND model_slug = ? AND enabled = 1
          LIMIT 1`,
      )
      .get(userId, provSlug, modSlug) as RawRow | undefined;
    if (split) return rowToModel(split);

    // 2b. AUTODETECT for that specific provider
    const autoForProvider = raw
      .prepare(
        `SELECT * FROM user_models
          WHERE user_id = ? AND provider_slug = ? AND model_slug = 'AUTODETECT' AND enabled = 1
          LIMIT 1`,
      )
      .get(userId, provSlug) as RawRow | undefined;
    if (autoForProvider) {
      const m = rowToModel(autoForProvider);
      m.modelSlug = modSlug; // use the requested model, not AUTODETECT
      return m;
    }
  }

  // 3. Global AUTODETECT — any provider with AUTODETECT
  const autoAny = raw
    .prepare(
      `SELECT * FROM user_models
        WHERE user_id = ? AND model_slug = 'AUTODETECT' AND enabled = 1
        ORDER BY updated_at DESC
        LIMIT 1`,
    )
    .get(userId) as RawRow | undefined;
  if (autoAny) {
    const m = rowToModel(autoAny);
    m.modelSlug = requestedModel;
    return m;
  }

  // 4. Fuzzy: model name without provider prefix (e.g. "gpt-4o")
  const fuzzy = raw
    .prepare(
      `SELECT * FROM user_models
        WHERE user_id = ? AND model_slug = ? AND enabled = 1
        LIMIT 1`,
    )
    .get(userId, requestedModel) as RawRow | undefined;
  if (fuzzy) return rowToModel(fuzzy);

  return null;
}

export function addUserModel(input: {
  userId: number;
  providerSlug: string;
  modelSlug: string;
  displayName?: string;
  apiKey: string;
  apiBase?: string | null;
  roles?: string[];
  createdBy?: number | null;
}): UserModelPublic {
  const now = Date.now();
  const encrypted = encrypt(input.apiKey);
  const rolesStr = (input.roles ?? ["chat", "edit", "apply"]).join(",");

  raw
    .prepare(
      `INSERT INTO user_models (
         user_id, provider_slug, model_slug, display_name,
         api_key_encrypted, api_base, enabled, roles,
         created_at, updated_at, created_by
       )
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
       ON CONFLICT(user_id, provider_slug, model_slug) DO UPDATE SET
         display_name = excluded.display_name,
         api_key_encrypted = excluded.api_key_encrypted,
         api_base = excluded.api_base,
         roles = excluded.roles,
         updated_at = excluded.updated_at`,
    )
    .run(
      input.userId,
      input.providerSlug,
      input.modelSlug,
      input.displayName ?? null,
      encrypted,
      input.apiBase ?? null,
      rolesStr,
      now,
      now,
      input.createdBy ?? null,
    );

  // Return the upserted row
  const row = raw
    .prepare(
      `SELECT * FROM user_models
        WHERE user_id = ? AND provider_slug = ? AND model_slug = ?`,
    )
    .get(input.userId, input.providerSlug, input.modelSlug) as RawRow;
  return rowToPublic(row);
}

export function removeUserModel(
  userId: number,
  providerSlug: string,
  modelSlug: string,
): boolean {
  const result = raw
    .prepare(
      `DELETE FROM user_models
        WHERE user_id = ? AND provider_slug = ? AND model_slug = ?`,
    )
    .run(userId, providerSlug, modelSlug);
  return result.changes > 0;
}

export function removeUserModelById(userId: number, modelId: number): boolean {
  const result = raw
    .prepare(`DELETE FROM user_models WHERE user_id = ? AND id = ?`)
    .run(userId, modelId);
  return result.changes > 0;
}

export function removeAllUserModelsForProvider(
  userId: number,
  providerSlug: string,
): number {
  const result = raw
    .prepare(
      `DELETE FROM user_models
        WHERE user_id = ? AND provider_slug = ?`,
    )
    .run(userId, providerSlug);
  return result.changes;
}

// ─── Admin: assign models to other users ──────────────────────────

export function addModelForUser(
  adminUserId: number,
  targetUserId: number,
  input: {
    providerSlug: string;
    modelSlug: string;
    displayName?: string;
    apiKey: string;
    apiBase?: string | null;
    roles?: string[];
  },
): UserModelPublic {
  return addUserModel({
    userId: targetUserId,
    providerSlug: input.providerSlug,
    modelSlug: input.modelSlug,
    displayName: input.displayName,
    apiKey: input.apiKey,
    apiBase: input.apiBase,
    roles: input.roles,
    createdBy: adminUserId,
  });
}

// ─── Provider URL builder (moved from gatewayRouter.ts) ───────────

const PROVIDER_API_PATHS: Record<string, string> = {
  openai: "/v1/chat/completions",
  anthropic: "/v1/messages",
  groq: "/openai/v1/chat/completions",
  mistral: "/v1/chat/completions",
  deepseek: "/v1/chat/completions",
  cohere: "/v1/chat/completions",
  xai: "/v1/chat/completions",
  openrouter: "/api/v1/chat/completions",
};

export function buildProviderUrl(
  providerSlug: string,
  modelSlug: string,
  apiBase: string | null,
): string {
  const slug = providerSlug.toLowerCase();

  // Known base URLs for providers that don't need one from the user
  const defaultBases: Record<string, string> = {
    openai: "https://api.openai.com",
    anthropic: "https://api.anthropic.com",
    groq: "https://api.groq.com",
    mistral: "https://api.mistral.ai",
    deepseek: "https://api.deepseek.com",
    cohere: "https://api.cohere.ai",
    xai: "https://api.x.ai",
    openrouter: "https://openrouter.ai",
  };

  const base = (
    apiBase ||
    defaultBases[slug] ||
    "http://localhost:11434"
  ).replace(/\/+$/, "");

  if (slug.includes("ollama") || slug === "local") {
    return `${base}/api/chat`;
  }
  if (slug.includes("anthropic") || slug.includes("claude")) {
    return `${base}/v1/messages`;
  }
  if (slug.includes("google") || slug.includes("gemini")) {
    return `${base}/v1beta/models/${modelSlug}:generateContent`;
  }

  const apiPath = PROVIDER_API_PATHS[slug] || "/v1/chat/completions";
  return `${base}${apiPath}`;
}

export function isLocalProvider(providerSlug: string): boolean {
  const slug = providerSlug.toLowerCase();
  return slug.includes("ollama") || slug === "local";
}
