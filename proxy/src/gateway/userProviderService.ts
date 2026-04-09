import sqliteDatabase from "../db/database";
import { decrypt, encrypt } from "../vault/encryption";

/**
 * Phase A — per-org and per-user provider services.
 *
 * The legacy `providers` table is a global catalogue of provider
 * definitions (openai, anthropic, gemini, ollama, ...). Keys now
 * live in two new tables:
 *
 *   org_providers  — keys provisioned by an org admin
 *   user_providers — optional per-user overrides
 *
 * Resolution rule (in `resolveProviderForUser`):
 *
 *   1. If the user has a user_providers row for the slug AND it's
 *      enabled, use that key.
 *   2. Otherwise, if the user's org has an org_providers row for
 *      the slug AND it's enabled, use that key.
 *   3. Otherwise, return null (the caller should 403 with
 *      NO_PROVIDER_CONFIGURED).
 *
 * Role policy can forbid user-level overrides by setting
 * `rules.allow_user_provider_override: false` — the routes that
 * mutate user_providers check this before inserting.
 *
 * Keys are AES-256-GCM encrypted at rest via `vault/encryption.ts`
 * and only decrypted in-memory at the gateway layer when a request
 * is about to be dispatched to the upstream provider.
 */

// Raw better-sqlite handle so we can use parameterized SQL without
// threading through drizzle schema definitions for the two new tables.
const raw = sqliteDatabase;

export interface OrgProviderRow {
  id: number;
  orgId: number;
  providerSlug: string;
  apiKey: string; // decrypted
  baseUrl: string | null;
  displayName: string | null;
  enabled: boolean;
  costCapUsd: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface UserProviderRow {
  id: number;
  userId: number;
  providerSlug: string;
  apiKey: string; // decrypted
  baseUrl: string | null;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ResolvedProvider {
  providerSlug: string;
  apiKey: string;
  baseUrl: string | null;
  source: "user" | "org";
}

// ─── Org providers ────────────────────────────────────────────────

export function listOrgProviders(
  orgId: number,
): Array<Omit<OrgProviderRow, "apiKey"> & { hasKey: boolean }> {
  const rows = raw
    .prepare(
      `SELECT id, org_id, provider_slug, api_key_encrypted, base_url,
              display_name, enabled, cost_cap_usd, created_at, updated_at
         FROM org_providers
        WHERE org_id = ?
        ORDER BY provider_slug`,
    )
    .all(orgId) as Array<{
    id: number;
    org_id: number;
    provider_slug: string;
    api_key_encrypted: string;
    base_url: string | null;
    display_name: string | null;
    enabled: number;
    cost_cap_usd: number | null;
    created_at: number;
    updated_at: number;
  }>;
  return rows.map((r) => ({
    id: r.id,
    orgId: r.org_id,
    providerSlug: r.provider_slug,
    baseUrl: r.base_url,
    displayName: r.display_name,
    enabled: r.enabled === 1,
    costCapUsd: r.cost_cap_usd,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    hasKey: !!r.api_key_encrypted,
  }));
}

export function upsertOrgProvider(
  orgId: number,
  providerSlug: string,
  apiKey: string,
  opts: {
    baseUrl?: string | null;
    displayName?: string | null;
    enabled?: boolean;
    costCapUsd?: number | null;
  } = {},
): void {
  const encrypted = encrypt(apiKey);
  const now = Date.now();
  raw
    .prepare(
      `INSERT INTO org_providers (
         org_id, provider_slug, api_key_encrypted, base_url,
         display_name, enabled, cost_cap_usd, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(org_id, provider_slug) DO UPDATE SET
         api_key_encrypted = excluded.api_key_encrypted,
         base_url = excluded.base_url,
         display_name = excluded.display_name,
         enabled = excluded.enabled,
         cost_cap_usd = excluded.cost_cap_usd,
         updated_at = excluded.updated_at`,
    )
    .run(
      orgId,
      providerSlug,
      encrypted,
      opts.baseUrl ?? null,
      opts.displayName ?? null,
      opts.enabled === false ? 0 : 1,
      opts.costCapUsd ?? null,
      now,
      now,
    );
}

export function deleteOrgProvider(
  orgId: number,
  providerSlug: string,
): boolean {
  const result = raw
    .prepare(`DELETE FROM org_providers WHERE org_id = ? AND provider_slug = ?`)
    .run(orgId, providerSlug);
  return result.changes > 0;
}

// ─── User providers ───────────────────────────────────────────────

export function listUserProviders(
  userId: number,
): Array<Omit<UserProviderRow, "apiKey"> & { hasKey: boolean }> {
  const rows = raw
    .prepare(
      `SELECT id, user_id, provider_slug, api_key_encrypted, base_url,
              enabled, created_at, updated_at
         FROM user_providers
        WHERE user_id = ?
        ORDER BY provider_slug`,
    )
    .all(userId) as Array<{
    id: number;
    user_id: number;
    provider_slug: string;
    api_key_encrypted: string;
    base_url: string | null;
    enabled: number;
    created_at: number;
    updated_at: number;
  }>;
  return rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    providerSlug: r.provider_slug,
    baseUrl: r.base_url,
    enabled: r.enabled === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    hasKey: !!r.api_key_encrypted,
  }));
}

export function upsertUserProvider(
  userId: number,
  providerSlug: string,
  apiKey: string,
  opts: { baseUrl?: string | null; enabled?: boolean } = {},
): void {
  const encrypted = encrypt(apiKey);
  const now = Date.now();
  raw
    .prepare(
      `INSERT INTO user_providers (
         user_id, provider_slug, api_key_encrypted, base_url,
         enabled, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, provider_slug) DO UPDATE SET
         api_key_encrypted = excluded.api_key_encrypted,
         base_url = excluded.base_url,
         enabled = excluded.enabled,
         updated_at = excluded.updated_at`,
    )
    .run(
      userId,
      providerSlug,
      encrypted,
      opts.baseUrl ?? null,
      opts.enabled === false ? 0 : 1,
      now,
      now,
    );
}

export function deleteUserProvider(
  userId: number,
  providerSlug: string,
): boolean {
  const result = raw
    .prepare(
      `DELETE FROM user_providers WHERE user_id = ? AND provider_slug = ?`,
    )
    .run(userId, providerSlug);
  return result.changes > 0;
}

// ─── Resolution ───────────────────────────────────────────────────

/**
 * The single function the gateway calls at request dispatch time.
 * Implements the user → org → null resolution rule.
 *
 * Returns the decrypted API key + optional base URL override + the
 * source tag so callers can log which key was used for audit.
 */
export function resolveProviderForUser(
  userId: number | null | undefined,
  orgId: number | null | undefined,
  providerSlug: string,
): ResolvedProvider | null {
  // 1. User override
  if (userId) {
    const userRow = raw
      .prepare(
        `SELECT api_key_encrypted, base_url
           FROM user_providers
          WHERE user_id = ? AND provider_slug = ? AND enabled = 1`,
      )
      .get(userId, providerSlug) as
      | { api_key_encrypted: string; base_url: string | null }
      | undefined;
    if (userRow?.api_key_encrypted) {
      return {
        providerSlug,
        apiKey: decrypt(userRow.api_key_encrypted),
        baseUrl: userRow.base_url,
        source: "user",
      };
    }
  }

  // 2. Org default
  if (orgId) {
    const orgRow = raw
      .prepare(
        `SELECT api_key_encrypted, base_url
           FROM org_providers
          WHERE org_id = ? AND provider_slug = ? AND enabled = 1`,
      )
      .get(orgId, providerSlug) as
      | { api_key_encrypted: string; base_url: string | null }
      | undefined;
    if (orgRow?.api_key_encrypted) {
      return {
        providerSlug,
        apiKey: decrypt(orgRow.api_key_encrypted),
        baseUrl: orgRow.base_url,
        source: "org",
      };
    }
  }

  return null;
}

/**
 * List every provider slug the user can reach (union of user
 * overrides + org defaults). Used by `/api/me/models` and the
 * mandatory-model gate in onboarding.
 */
export function listAvailableProvidersForUser(
  userId: number | null | undefined,
  orgId: number | null | undefined,
): Array<{
  providerSlug: string;
  source: "user" | "org";
  baseUrl: string | null;
}> {
  const result = new Map<
    string,
    { providerSlug: string; source: "user" | "org"; baseUrl: string | null }
  >();

  // Org defaults first so user overrides clobber them via Map.set
  if (orgId) {
    const orgRows = raw
      .prepare(
        `SELECT provider_slug, base_url
           FROM org_providers
          WHERE org_id = ? AND enabled = 1`,
      )
      .all(orgId) as Array<{
      provider_slug: string;
      base_url: string | null;
    }>;
    for (const r of orgRows) {
      result.set(r.provider_slug, {
        providerSlug: r.provider_slug,
        source: "org",
        baseUrl: r.base_url,
      });
    }
  }

  if (userId) {
    const userRows = raw
      .prepare(
        `SELECT provider_slug, base_url
           FROM user_providers
          WHERE user_id = ? AND enabled = 1`,
      )
      .all(userId) as Array<{
      provider_slug: string;
      base_url: string | null;
    }>;
    for (const r of userRows) {
      result.set(r.provider_slug, {
        providerSlug: r.provider_slug,
        source: "user",
        baseUrl: r.base_url,
      });
    }
  }

  return Array.from(result.values());
}
