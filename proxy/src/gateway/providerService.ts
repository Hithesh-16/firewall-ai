import { db } from "../db/index";
import { providers } from "../db/schema";
import { Provider } from "../types";
import { decrypt, encrypt } from "../vault/encryption";
import { and, asc, eq, isNull } from "drizzle-orm";

/**
 * Multi-tenancy note (BUG-ONBOARD follow-up):
 *
 * Every query in this module is now org-scoped by default. Callers
 * MUST pass an `orgId` — we no longer expose a "global list" because
 * that was the root cause of the onboarding provider leak. Rows with
 * a NULL org_id (legacy data that missed the backfill) are never
 * returned.
 *
 * The few remaining places that need to look up a provider without
 * knowing the org (e.g. a token-scope refresh that only carries a
 * slug) have explicit `*ByIdAcrossOrgs` / `*BySlugAcrossOrgs` helpers
 * below. Use those sparingly and always document why in the caller.
 */

function toProvider(row: any): Provider {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    baseUrl: row.baseUrl,
    apiKeyEncrypted: row.apiKeyEncrypted,
    enabled: row.enabled === 1,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    orgId: row.orgId ?? null,
  };
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function createProvider(
  name: string,
  apiKey: string,
  baseUrl: string,
  orgId: number,
): Provider {
  const slug = slugify(name);
  const now = Date.now();
  const encrypted = encrypt(apiKey);

  const result = db
    .insert(providers)
    .values({
      name,
      slug,
      baseUrl,
      apiKeyEncrypted: encrypted,
      enabled: 1,
      createdAt: now,
      updatedAt: now,
      orgId,
    })
    .run();

  return getProviderById(Number(result.lastInsertRowid))!;
}

/**
 * List all providers scoped to a single org. Rows with NULL org_id
 * (legacy data from pre-multitenancy) are intentionally excluded —
 * admins can reassign via SQL if needed.
 */
export function listProviders(orgId: number): Provider[] {
  const rows = db
    .select()
    .from(providers)
    .where(eq(providers.orgId, orgId))
    .orderBy(asc(providers.name))
    .all();
  return rows.map(toProvider);
}

export function getProviderById(id: number): Provider | null {
  const row = db.select().from(providers).where(eq(providers.id, id)).get();
  return row ? toProvider(row) : null;
}

/**
 * Slug lookup scoped to an org. Required because two orgs can
 * register the same slug (e.g. both "openai"); the slug alone is
 * ambiguous without the org.
 */
export function getProviderBySlug(
  slug: string,
  orgId: number,
): Provider | null {
  const row = db
    .select()
    .from(providers)
    .where(and(eq(providers.slug, slug), eq(providers.orgId, orgId)))
    .get();
  return row ? toProvider(row) : null;
}

/**
 * Rare: look up by slug without knowing the org. Used by token
 * refresh jobs and similar system paths that need to resolve a slug
 * before an auth context is available. Prefer the org-scoped
 * variant whenever the caller knows the org — this one returns the
 * first match and is only safe for system-wide identifiers.
 */
export function getProviderBySlugAcrossOrgs(slug: string): Provider | null {
  const row = db.select().from(providers).where(eq(providers.slug, slug)).get();
  return row ? toProvider(row) : null;
}

/**
 * Legacy global listing — returns only rows with NULL org_id.
 * Exists for admin tooling that needs to find rows missed by the
 * backfill. DO NOT use in request paths.
 */
export function listUnscopedLegacyProviders(): Provider[] {
  const rows = db
    .select()
    .from(providers)
    .where(isNull(providers.orgId))
    .orderBy(asc(providers.name))
    .all();
  return rows.map(toProvider);
}

export function updateProvider(
  id: number,
  updates: {
    name?: string;
    baseUrl?: string;
    apiKey?: string;
    enabled?: boolean;
  },
): Provider | null {
  const provider = getProviderById(id);
  if (!provider) return null;

  const now = Date.now();
  const setObj: Record<string, any> = { updatedAt: now };

  if (updates.name !== undefined) {
    setObj.name = updates.name;
    setObj.slug = slugify(updates.name);
  }
  if (updates.baseUrl !== undefined) {
    setObj.baseUrl = updates.baseUrl;
  }
  if (updates.apiKey !== undefined) {
    setObj.apiKeyEncrypted = encrypt(updates.apiKey);
  }
  if (updates.enabled !== undefined) {
    setObj.enabled = updates.enabled ? 1 : 0;
  }

  db.update(providers).set(setObj).where(eq(providers.id, id)).run();

  return getProviderById(id);
}

export function deleteProvider(id: number): boolean {
  const result = db.delete(providers).where(eq(providers.id, id)).run();
  return result.changes > 0;
}

export function decryptProviderKey(provider: Provider): string {
  return decrypt(provider.apiKeyEncrypted);
}
