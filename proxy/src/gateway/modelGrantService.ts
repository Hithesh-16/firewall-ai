import sqliteDatabase from "../db/database";

/**
 * Phase F (slice 2) — model access grants.
 *
 * The org-wide API keys live in `org_providers`. That tells the
 * gateway "we have a key for OpenAI, Anthropic, …", but it says
 * nothing about **which users are allowed to call which models**.
 *
 * `model_grants` closes that gap: every row is a triple of
 * `(grantee, provider_slug, model_slug)` where grantee is either
 * a user or a team. A user can reach a model iff:
 *
 *   1. The org has a provider for the model's slug (`org_providers`
 *      or the user's personal `user_providers` override), AND
 *   2. At least one of the following grants exists:
 *        a. `(grantee_type='user', grantee_id=user.id, provider_slug, model_slug)`
 *        b. `(grantee_type='user', ..., model_slug='*')` — provider-wide grant
 *        c. `(grantee_type='team', grantee_id=team.id, ...)` for any team
 *           the user belongs to
 *
 * This lets an admin:
 *
 *   - Grant `openai/gpt-4o` to a single senior engineer while keeping
 *     everyone else on `openai/gpt-4o-mini`
 *   - Grant `anthropic/*` to the whole platform team at once
 *   - Revoke a model for a leaving contractor in a single DELETE
 *
 * The personal provider path (`user_providers`) bypasses grants
 * because if a user paid for their own key, the admin has no
 * business restricting which of that key's models they can call.
 * Only org-provisioned keys go through the grant gate.
 */

const raw = sqliteDatabase;

export type GranteeType = "user" | "team";

export interface ModelGrant {
  id: number;
  orgId: number;
  granteeType: GranteeType;
  granteeId: number;
  providerSlug: string;
  modelSlug: string;
  grantedAt: number;
  grantedBy: number | null;
}

interface RawGrantRow {
  id: number;
  org_id: number;
  grantee_type: string;
  grantee_id: number;
  provider_slug: string;
  model_slug: string;
  granted_at: number;
  granted_by: number | null;
}

function rowToGrant(row: RawGrantRow): ModelGrant {
  return {
    id: row.id,
    orgId: row.org_id,
    granteeType: row.grantee_type as GranteeType,
    granteeId: row.grantee_id,
    providerSlug: row.provider_slug,
    modelSlug: row.model_slug,
    grantedAt: row.granted_at,
    grantedBy: row.granted_by,
  };
}

// ─── CRUD ─────────────────────────────────────────────────────────

export function listGrantsForOrg(orgId: number): ModelGrant[] {
  const rows = raw
    .prepare(
      `SELECT id, org_id, grantee_type, grantee_id, provider_slug,
              model_slug, granted_at, granted_by
         FROM model_grants
        WHERE org_id = ?
        ORDER BY granted_at DESC`,
    )
    .all(orgId) as RawGrantRow[];
  return rows.map(rowToGrant);
}

export function listGrantsForUser(orgId: number, userId: number): ModelGrant[] {
  // Direct user grants only — team grants are expanded at
  // `resolveGrantsForUser` time so the caller gets a single flat
  // list that includes inherited team grants.
  const rows = raw
    .prepare(
      `SELECT id, org_id, grantee_type, grantee_id, provider_slug,
              model_slug, granted_at, granted_by
         FROM model_grants
        WHERE org_id = ? AND grantee_type = 'user' AND grantee_id = ?
        ORDER BY granted_at DESC`,
    )
    .all(orgId, userId) as RawGrantRow[];
  return rows.map(rowToGrant);
}

export function createGrant(input: {
  orgId: number;
  granteeType: GranteeType;
  granteeId: number;
  providerSlug: string;
  modelSlug: string;
  grantedBy: number | null;
}): ModelGrant {
  const now = Date.now();
  const result = raw
    .prepare(
      `INSERT INTO model_grants (
         org_id, grantee_type, grantee_id, provider_slug,
         model_slug, granted_at, granted_by
       )
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(org_id, grantee_type, grantee_id, provider_slug, model_slug)
         DO UPDATE SET granted_at = excluded.granted_at,
                       granted_by = excluded.granted_by
       RETURNING id`,
    )
    .get(
      input.orgId,
      input.granteeType,
      input.granteeId,
      input.providerSlug,
      input.modelSlug,
      now,
      input.grantedBy,
    ) as { id: number };

  return {
    id: result.id,
    orgId: input.orgId,
    granteeType: input.granteeType,
    granteeId: input.granteeId,
    providerSlug: input.providerSlug,
    modelSlug: input.modelSlug,
    grantedAt: now,
    grantedBy: input.grantedBy,
  };
}

export function deleteGrant(orgId: number, grantId: number): boolean {
  const result = raw
    .prepare(`DELETE FROM model_grants WHERE id = ? AND org_id = ?`)
    .run(grantId, orgId);
  return result.changes > 0;
}

export function deleteGrantsForUser(orgId: number, userId: number): number {
  const result = raw
    .prepare(
      `DELETE FROM model_grants
        WHERE org_id = ? AND grantee_type = 'user' AND grantee_id = ?`,
    )
    .run(orgId, userId);
  return result.changes;
}

// ─── Resolution ───────────────────────────────────────────────────

/**
 * Flatten every grant that applies to a user. Includes:
 *
 *   - Direct user grants (`grantee_type='user', grantee_id=userId`)
 *   - Team grants for any team the user belongs to
 *
 * Returns a de-duplicated set of `(provider_slug, model_slug)` pairs
 * where `model_slug === '*'` means "every model this provider
 * catalogues". Callers pass this set to
 * `isModelGrantedToUser(provider, model, grantSet)` for O(1) checks.
 */
export interface ResolvedGrantSet {
  exact: Set<string>; // "provider/model"
  wildcard: Set<string>; // provider_slug
}

export function resolveGrantsForUser(
  orgId: number,
  userId: number,
): ResolvedGrantSet {
  // 1. Direct user grants
  const directRows = raw
    .prepare(
      `SELECT provider_slug, model_slug
         FROM model_grants
        WHERE org_id = ? AND grantee_type = 'user' AND grantee_id = ?`,
    )
    .all(orgId, userId) as Array<{
    provider_slug: string;
    model_slug: string;
  }>;

  // 2. Team grants. Joins against `user_team_roles` (or whichever
  //    table stores team membership — we fall back gracefully if
  //    the schema isn't available on this install).
  let teamRows: Array<{ provider_slug: string; model_slug: string }> = [];
  try {
    teamRows = raw
      .prepare(
        `SELECT mg.provider_slug, mg.model_slug
           FROM model_grants mg
           JOIN user_team_roles utr
             ON utr.team_id = mg.grantee_id
          WHERE mg.org_id = ?
            AND mg.grantee_type = 'team'
            AND utr.user_id = ?`,
      )
      .all(orgId, userId) as Array<{
      provider_slug: string;
      model_slug: string;
    }>;
  } catch {
    // `user_team_roles` may not exist on older installs — team
    // grants are silently skipped rather than failing the whole
    // resolution.
    teamRows = [];
  }

  const exact = new Set<string>();
  const wildcard = new Set<string>();
  for (const row of [...directRows, ...teamRows]) {
    if (row.model_slug === "*") {
      wildcard.add(row.provider_slug);
    } else {
      exact.add(`${row.provider_slug}/${row.model_slug}`);
    }
  }
  return { exact, wildcard };
}

/**
 * Cheap predicate for the `/api/me/models` filter. Given the
 * pre-resolved grant set for a user, is this specific
 * `(provider, model)` pair reachable?
 */
export function isModelGrantedToUser(
  providerSlug: string,
  modelSlug: string,
  grants: ResolvedGrantSet,
): boolean {
  if (grants.wildcard.has(providerSlug)) return true;
  return grants.exact.has(`${providerSlug}/${modelSlug}`);
}

/**
 * When a user has ZERO grants of any kind AND the org has provider
 * keys configured, the sensible default is "admin hasn't assigned
 * anything yet" — NOT "block everything". Callers that want
 * explicit allowlist behaviour can check `hasAnyGrants(orgId, userId)`
 * first and fall back to "deny all" only when it's true.
 *
 * Use this helper to tell the two cases apart:
 *
 *   - no grants on the org → return `allow-all` (bootstrap mode)
 *   - grants exist on the org but not this user → return `deny-all`
 */
export function inferGrantMode(
  orgId: number,
  userId: number,
): "allow-all" | "scoped" {
  const orgTotal = raw
    .prepare(`SELECT COUNT(*) AS n FROM model_grants WHERE org_id = ?`)
    .get(orgId) as { n: number };
  if (orgTotal.n === 0) return "allow-all";

  const userTotal = raw
    .prepare(
      `SELECT COUNT(*) AS n FROM model_grants
        WHERE org_id = ?
          AND ((grantee_type = 'user' AND grantee_id = ?))`,
    )
    .get(orgId, userId) as { n: number };

  // Also count team grants the user would inherit.
  let teamTotal = 0;
  try {
    const t = raw
      .prepare(
        `SELECT COUNT(*) AS n
           FROM model_grants mg
           JOIN user_team_roles utr
             ON utr.team_id = mg.grantee_id
          WHERE mg.org_id = ?
            AND mg.grantee_type = 'team'
            AND utr.user_id = ?`,
      )
      .get(orgId, userId) as { n: number };
    teamTotal = t.n;
  } catch {
    teamTotal = 0;
  }

  if (userTotal.n + teamTotal === 0) return "scoped";
  return "scoped";
}
