import crypto from "node:crypto";

import sqliteDatabase from "../db/database";

/**
 * Phase A.5 — assistant service.
 *
 * An "assistant" is the full Continue-style YAML definition that
 * used to live in `~/.ai-firewall/config.yaml`. It includes:
 *
 *   - models (referenced by slug — the actual API keys come from
 *     org_providers / user_providers at dispatch time)
 *   - context providers (@file, @codebase, @git, @web, @docs, MCP)
 *   - MCP server configurations
 *   - rules (custom injection-scanned rules)
 *   - prompts (custom prompt templates)
 *   - docs sources
 *
 * The schema in `packages/config-yaml/src/schemas/index.ts` stays
 * the authoritative Zod definition. This service just stores the
 * YAML text as a blob in the `assistants` table, computes an ETag
 * (sha256) on every write, and resolves the effective assistant
 * for a given user (user default → org default → null).
 *
 * Clients fetch via `GET /api/me/assistant` (with an `If-None-Match`
 * header for conditional GETs) and cache locally. The old
 * `config.yaml` loader will be removed in Phase G.
 */

const raw = sqliteDatabase;

export type AssistantOwnerType = "org" | "user";

export interface StoredAssistant {
  id: number;
  slug: string;
  ownerType: AssistantOwnerType;
  ownerId: number;
  name: string;
  yaml: string;
  etag: string;
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
}

function rowToAssistant(row: {
  id: number;
  slug: string;
  owner_type: string;
  owner_id: number;
  name: string;
  yaml_content: string;
  etag: string;
  is_default: number;
  created_at: number;
  updated_at: number;
}): StoredAssistant {
  return {
    id: row.id,
    slug: row.slug,
    ownerType: row.owner_type as AssistantOwnerType,
    ownerId: row.owner_id,
    name: row.name,
    yaml: row.yaml_content,
    etag: row.etag,
    isDefault: row.is_default === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function computeEtag(yaml: string): string {
  return (
    "sha256:" + crypto.createHash("sha256").update(yaml, "utf8").digest("hex")
  );
}

// ─── Reads ────────────────────────────────────────────────────────

export function getAssistant(
  ownerType: AssistantOwnerType,
  ownerId: number,
  slug: string,
): StoredAssistant | null {
  const row = raw
    .prepare(
      `SELECT id, slug, owner_type, owner_id, name, yaml_content, etag,
              is_default, created_at, updated_at
         FROM assistants
        WHERE owner_type = ? AND owner_id = ? AND slug = ?`,
    )
    .get(ownerType, ownerId, slug) as
    | Parameters<typeof rowToAssistant>[0]
    | undefined;
  return row ? rowToAssistant(row) : null;
}

export function getDefaultAssistant(
  ownerType: AssistantOwnerType,
  ownerId: number,
): StoredAssistant | null {
  const row = raw
    .prepare(
      `SELECT id, slug, owner_type, owner_id, name, yaml_content, etag,
              is_default, created_at, updated_at
         FROM assistants
        WHERE owner_type = ? AND owner_id = ? AND is_default = 1
        LIMIT 1`,
    )
    .get(ownerType, ownerId) as
    | Parameters<typeof rowToAssistant>[0]
    | undefined;
  return row ? rowToAssistant(row) : null;
}

export function listAssistants(
  ownerType: AssistantOwnerType,
  ownerId: number,
): StoredAssistant[] {
  const rows = raw
    .prepare(
      `SELECT id, slug, owner_type, owner_id, name, yaml_content, etag,
              is_default, created_at, updated_at
         FROM assistants
        WHERE owner_type = ? AND owner_id = ?
        ORDER BY is_default DESC, slug ASC`,
    )
    .all(ownerType, ownerId) as Parameters<typeof rowToAssistant>[0][];
  return rows.map(rowToAssistant);
}

/**
 * Resolve the effective assistant for a signed-in user.
 *
 * Priority: user default → org default → null.
 *
 * Returns null when neither the user nor the org has a default
 * assistant configured — in that case, `/api/me/assistant` returns
 * 404 and the client shows "No assistant provisioned. Contact
 * your admin." in the mandatory-model onboarding gate.
 */
export function resolveAssistantForUser(
  userId: number | null | undefined,
  orgId: number | null | undefined,
): StoredAssistant | null {
  if (userId) {
    const userDefault = getDefaultAssistant("user", userId);
    if (userDefault) return userDefault;
  }
  if (orgId) {
    const orgDefault = getDefaultAssistant("org", orgId);
    if (orgDefault) return orgDefault;
  }
  return null;
}

// ─── Writes ───────────────────────────────────────────────────────

export interface UpsertAssistantInput {
  ownerType: AssistantOwnerType;
  ownerId: number;
  slug: string;
  name: string;
  yaml: string;
  isDefault?: boolean;
}

export function upsertAssistant(input: UpsertAssistantInput): StoredAssistant {
  const now = Date.now();
  const etag = computeEtag(input.yaml);

  const tx = raw.transaction(() => {
    // If we're marking this one default, clear any other default for
    // the same owner first so the invariant holds.
    if (input.isDefault) {
      raw
        .prepare(
          `UPDATE assistants
              SET is_default = 0, updated_at = ?
            WHERE owner_type = ? AND owner_id = ? AND is_default = 1`,
        )
        .run(now, input.ownerType, input.ownerId);
    }

    raw
      .prepare(
        `INSERT INTO assistants (
           slug, owner_type, owner_id, name, yaml_content, etag,
           is_default, created_at, updated_at
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(owner_type, owner_id, slug) DO UPDATE SET
           name = excluded.name,
           yaml_content = excluded.yaml_content,
           etag = excluded.etag,
           is_default = excluded.is_default,
           updated_at = excluded.updated_at`,
      )
      .run(
        input.slug,
        input.ownerType,
        input.ownerId,
        input.name,
        input.yaml,
        etag,
        input.isDefault ? 1 : 0,
        now,
        now,
      );
  });
  tx();

  const stored = getAssistant(input.ownerType, input.ownerId, input.slug);
  if (!stored) {
    throw new Error("Failed to persist assistant (row not found after upsert)");
  }
  return stored;
}

export function deleteAssistant(
  ownerType: AssistantOwnerType,
  ownerId: number,
  slug: string,
): boolean {
  const result = raw
    .prepare(
      `DELETE FROM assistants
        WHERE owner_type = ? AND owner_id = ? AND slug = ?`,
    )
    .run(ownerType, ownerId, slug);
  return result.changes > 0;
}

export function setDefaultAssistant(
  ownerType: AssistantOwnerType,
  ownerId: number,
  slug: string,
): boolean {
  const now = Date.now();
  const tx = raw.transaction(() => {
    raw
      .prepare(
        `UPDATE assistants
            SET is_default = 0, updated_at = ?
          WHERE owner_type = ? AND owner_id = ?`,
      )
      .run(now, ownerType, ownerId);
    const result = raw
      .prepare(
        `UPDATE assistants
            SET is_default = 1, updated_at = ?
          WHERE owner_type = ? AND owner_id = ? AND slug = ?`,
      )
      .run(now, ownerType, ownerId, slug);
    return result.changes > 0;
  });
  return tx();
}
