/**
 * File Restriction Service
 *
 * Manages per-org/team/user file restrictions stored in the database.
 * Resolves effective file policy by merging all applicable restriction levels.
 *
 * Resolution order (strictest wins):
 *   1. Global policy.json file_scope (baseline)
 *   2. Org-level restrictions
 *   3. Team-level restrictions
 *   4. User-level restrictions
 *
 * Blocklists: union (any block = blocked)
 * Allowlists: intersection (must be allowed at ALL levels)
 */

import db from "../db/database";
import { loadPolicyConfig } from "../config";
import type { FileScopeConfig } from "../types";

// ── Types ─────────────────────────────────────────────────────────────

interface FileRestriction {
  id: number;
  orgId: number;
  teamId: number | null;
  userId: number | null;
  mode: "blocklist" | "allowlist";
  patterns: string[];
  createdAt: number;
  updatedAt: number;
}

interface EffectiveFilePolicy {
  mode: "blocklist" | "allowlist";
  blocklist: string[];
  allowlist: string[];
  sources: Array<{ level: string; patterns: string[] }>;
}

// ── Internal helpers ──────────────────────────────────────────────────

function parsePatterns(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === "string") : [];
  } catch {
    return [];
  }
}

function toRestriction(row: Record<string, unknown>): FileRestriction {
  return {
    id: row.id as number,
    orgId: row.org_id as number,
    teamId: (row.team_id as number | null) ?? null,
    userId: (row.user_id as number | null) ?? null,
    mode: row.mode as "blocklist" | "allowlist",
    patterns: parsePatterns(row.patterns as string),
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  };
}

// ── Public API ────────────────────────────────────────────────────────

/**
 * Returns the effective file policy for a given user, merging all levels.
 * Global baseline + org + team + user restrictions.
 */
export function getEffectiveFilePolicy(
  orgId: number,
  teamId?: number | null,
  userId?: number | null
): EffectiveFilePolicy {
  const globalPolicy = loadPolicyConfig();
  const globalScope = globalPolicy.file_scope ?? { mode: "blocklist", blocklist: [], allowlist: [] };

  const mergedBlocklist = [...globalScope.blocklist];
  const mergedAllowlist = [...globalScope.allowlist];
  const sources: Array<{ level: string; patterns: string[] }> = [];

  if (globalScope.blocklist.length > 0) {
    sources.push({ level: "global", patterns: globalScope.blocklist });
  }

  // Org-level restrictions
  const orgRestrictions = getRestrictions(orgId, null, null);
  for (const r of orgRestrictions) {
    if (r.mode === "blocklist") {
      mergedBlocklist.push(...r.patterns);
      sources.push({ level: "org", patterns: r.patterns });
    } else {
      mergedAllowlist.push(...r.patterns);
      sources.push({ level: "org", patterns: r.patterns });
    }
  }

  // Team-level restrictions
  if (teamId) {
    const teamRestrictions = getRestrictions(orgId, teamId, null);
    for (const r of teamRestrictions) {
      if (r.mode === "blocklist") {
        mergedBlocklist.push(...r.patterns);
        sources.push({ level: "team", patterns: r.patterns });
      } else {
        mergedAllowlist.push(...r.patterns);
        sources.push({ level: "team", patterns: r.patterns });
      }
    }
  }

  // User-level restrictions
  if (userId) {
    const userRestrictions = getRestrictions(orgId, null, userId);
    for (const r of userRestrictions) {
      if (r.mode === "blocklist") {
        mergedBlocklist.push(...r.patterns);
        sources.push({ level: "user", patterns: r.patterns });
      } else {
        mergedAllowlist.push(...r.patterns);
        sources.push({ level: "user", patterns: r.patterns });
      }
    }
  }

  // Determine effective mode: if any allowlist exists, mode is allowlist
  // (intersection semantics — file must be in ALL allowlists)
  const hasAllowlists = mergedAllowlist.length > 0;

  return {
    mode: hasAllowlists ? "allowlist" : "blocklist",
    blocklist: [...new Set(mergedBlocklist)],
    allowlist: [...new Set(mergedAllowlist)],
    sources,
  };
}

/**
 * Get file restrictions at a specific level.
 */
function getRestrictions(
  orgId: number,
  teamId: number | null,
  userId: number | null
): FileRestriction[] {
  let query: string;
  const params: unknown[] = [orgId];

  if (userId !== null) {
    query = "SELECT * FROM file_restrictions WHERE org_id = ? AND user_id = ?";
    params.push(userId);
  } else if (teamId !== null) {
    query = "SELECT * FROM file_restrictions WHERE org_id = ? AND team_id = ? AND user_id IS NULL";
    params.push(teamId);
  } else {
    query = "SELECT * FROM file_restrictions WHERE org_id = ? AND team_id IS NULL AND user_id IS NULL";
  }

  const stmt = db.prepare(query);
  const rows = stmt.all(...params) as Record<string, unknown>[];
  return rows.map(toRestriction);
}

/**
 * Set file restriction at a specific level (upsert).
 */
export function setFileRestriction(
  orgId: number,
  teamId: number | null,
  userId: number | null,
  mode: "blocklist" | "allowlist",
  patterns: string[]
): FileRestriction {
  const now = Date.now();
  const patternsJson = JSON.stringify(patterns);

  // Check for existing restriction at this exact level
  const existing = getRestrictions(orgId, teamId ?? null, userId ?? null);

  if (existing.length > 0) {
    const id = existing[0].id;
    db.prepare(
      "UPDATE file_restrictions SET mode = ?, patterns = ?, updated_at = ? WHERE id = ?"
    ).run(mode, patternsJson, now, id);

    return { ...existing[0], mode, patterns, updatedAt: now };
  }

  const result = db.prepare(
    "INSERT INTO file_restrictions (org_id, team_id, user_id, mode, patterns, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(orgId, teamId, userId, mode, patternsJson, now, now);

  return {
    id: Number(result.lastInsertRowid),
    orgId,
    teamId,
    userId,
    mode,
    patterns,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Delete a file restriction by ID.
 */
export function deleteFileRestriction(id: number): boolean {
  const result = db.prepare("DELETE FROM file_restrictions WHERE id = ?").run(id);
  return result.changes > 0;
}

/**
 * List all file restrictions for an org (admin view).
 */
export function listFileRestrictions(orgId: number): FileRestriction[] {
  const rows = db.prepare(
    "SELECT * FROM file_restrictions WHERE org_id = ? ORDER BY created_at ASC"
  ).all(orgId) as Record<string, unknown>[];
  return rows.map(toRestriction);
}
