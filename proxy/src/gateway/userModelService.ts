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
  /**
   * The user_id of the admin who assigned this model, or null when the
   * end user added it themselves. Lets the /settings/models UI render
   * an "Assigned by org" badge and gate the delete button for
   * org-assigned models.
   */
  createdBy: number | null;
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
    apiBase: canonicalProviderApiBase(row.provider_slug, row.api_base),
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
    apiBase: canonicalProviderApiBase(row.provider_slug, row.api_base),
    enabled: row.enabled === 1,
    roles: parseRoles(row.roles),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    createdBy: row.created_by,
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

/**
 * Paginated + searchable variant. Used by the web dashboard's
 * Settings → Models page so the client never has to filter or
 * page through rows in memory.
 *
 * Search is case-insensitive and matches against `display_name`,
 * `model_slug`, and `provider_slug`.
 */
export interface PaginatedUserModels {
  items: UserModelPublic[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export function listUserModelsPaginated(
  userId: number,
  opts: { page?: number; pageSize?: number; search?: string } = {},
): PaginatedUserModels {
  const page = Math.max(1, Math.floor(opts.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.floor(opts.pageSize ?? 20)));
  const offset = (page - 1) * pageSize;
  const search = (opts.search ?? "").trim();

  const whereClauses: string[] = ["user_id = ?", "enabled = 1"];
  const params: unknown[] = [userId];
  if (search.length > 0) {
    const like = `%${search.replace(/[\\%_]/g, "\\$&")}%`;
    whereClauses.push(
      "(LOWER(IFNULL(display_name, '')) LIKE LOWER(?) ESCAPE '\\' OR " +
        "LOWER(model_slug) LIKE LOWER(?) ESCAPE '\\' OR " +
        "LOWER(provider_slug) LIKE LOWER(?) ESCAPE '\\')",
    );
    params.push(like, like, like);
  }
  const whereSql = whereClauses.join(" AND ");

  const totalRow = raw
    .prepare(`SELECT COUNT(*) AS n FROM user_models WHERE ${whereSql}`)
    .get(...params) as { n: number };

  const rows = raw
    .prepare(
      `SELECT * FROM user_models
        WHERE ${whereSql}
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?`,
    )
    .all(...params, pageSize, offset) as RawRow[];

  return {
    items: rows.map(rowToPublic),
    total: totalRow.n,
    page,
    pageSize,
    hasMore: offset + rows.length < totalRow.n,
  };
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
  const canonicalBase = canonicalProviderApiBase(
    input.providerSlug,
    input.apiBase ?? null,
  );

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
      canonicalBase,
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

/**
 * Normalise the `api_base` we persist so SDK clients that treat it as
 * a URL prefix (Continue/Anthropic do `new URL("messages", apiBase)`)
 * don't end up hitting `https://api.anthropic.com/messages` — the
 * origin without `/v1/` — which serves Anthropic's HTML 404 page and
 * breaks JSON parsing at the caller. Keeping the DB canonical means
 * every future /sync writes a usable yaml without a migration.
 *
 * Returns `null` when input is empty so callers store nothing and the
 * adapter's built-in default applies.
 */
export function canonicalProviderApiBase(
  providerSlug: string,
  apiBase: string | null | undefined,
): string | null {
  const trimmed = (apiBase ?? "").trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  const slug = providerSlug.toLowerCase();
  const needsV1 =
    (slug === "anthropic" && url.hostname === "api.anthropic.com") ||
    (slug === "openai" && url.hostname === "api.openai.com");
  if (needsV1) {
    if (!/\/v\d+(\/|$)/.test(url.pathname)) {
      url.pathname = "/v1/";
    } else if (!url.pathname.endsWith("/")) {
      url.pathname = `${url.pathname}/`;
    }
    return url.toString();
  }
  return url.toString().replace(/\/+$/, "");
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

  let apiPath = PROVIDER_API_PATHS[slug] || "/v1/chat/completions";
  const commonPrefixes = ["/v1", "/api/v1", "/openai/v1"];
  for (const prefix of commonPrefixes) {
    if (base.endsWith(prefix) && apiPath.startsWith(prefix + "/")) {
      apiPath = apiPath.substring(prefix.length);
      break;
    }
  }
  return `${base}${apiPath}`;
}

export function isLocalProvider(providerSlug: string): boolean {
  const slug = providerSlug.toLowerCase();
  return slug.includes("ollama") || slug === "local";
}
