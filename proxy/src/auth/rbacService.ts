/**
 * RBAC Service — Capability-Based Permission Resolution
 *
 * Resolves whether a user has a specific capability by checking:
 *   1. User's org-level role → role_capabilities
 *   2. User's team-level role override (if team context)
 *   3. User-specific capability overrides (grants/denies)
 *
 * Explicit deny always wins over grant.
 * Overrides win over role capabilities.
 * Team role wins over org role (for team-scoped checks).
 */

import db from "../db/database";
import crypto from "node:crypto";

// ── Types ─────────────────────────────────────────────────────────────

export interface PermissionCheckResult {
  allowed: boolean;
  reason: string;
  source: "role" | "override" | "no_role" | "no_capability" | "expired" | "explicit_deny";
  roleId?: number;
  roleName?: string;
}

export interface RoleInfo {
  id: number;
  orgId: number | null;
  name: string;
  displayName: string;
  description: string | null;
  isSystem: number;
  isCustom: number;
  createdAt: number;
}

export interface CapabilityInfo {
  name: string;
  resource: string;
  action: string;
  description: string | null;
  category: string;
  riskLevel: string;
}

// ── Permission Check ──────────────────────────────────────────────────

export function checkPermission(
  userId: number,
  orgId: number,
  capabilityName: string,
  teamId?: number | null,
): PermissionCheckResult {
  const now = Date.now();

  // 1. Check user-level override first (highest priority)
  const override = db.prepare(`
    SELECT granted, reason, expires_at FROM user_capability_overrides
    WHERE user_id = ? AND org_id = ? AND capability_name = ?
  `).get(userId, orgId, capabilityName) as { granted: number; reason: string; expires_at: number | null } | undefined;

  if (override) {
    if (override.expires_at && override.expires_at < now) {
      // Override expired — fall through to role check
    } else if (override.granted === 0) {
      return { allowed: false, reason: override.reason, source: "explicit_deny" };
    } else {
      return { allowed: true, reason: override.reason, source: "override" };
    }
  }

  // 2. If team context, check team-level role first
  if (teamId) {
    const teamRole = db.prepare(`
      SELECT utr.role_id, r.name as role_name, rc.granted, rc.scope
      FROM user_team_roles utr
      JOIN roles r ON r.id = utr.role_id
      LEFT JOIN role_capabilities rc ON rc.role_id = utr.role_id AND rc.capability_name = ?
      WHERE utr.user_id = ? AND utr.team_id = ?
        AND (utr.expires_at IS NULL OR utr.expires_at > ?)
    `).get(capabilityName, userId, teamId, now) as {
      role_id: number; role_name: string; granted: number | null; scope: string | null;
    } | undefined;

    if (teamRole?.granted === 1) {
      return { allowed: true, reason: `Team role: ${teamRole.role_name}`, source: "role", roleId: teamRole.role_id, roleName: teamRole.role_name };
    }
    if (teamRole?.granted === 0) {
      return { allowed: false, reason: `Denied by team role: ${teamRole.role_name}`, source: "explicit_deny", roleId: teamRole.role_id };
    }
    // Team role exists but doesn't have this capability — fall through to org role
  }

  // 3. Check org-level role
  const orgRole = db.prepare(`
    SELECT uor.role_id, r.name as role_name, rc.granted, rc.scope
    FROM user_org_roles uor
    JOIN roles r ON r.id = uor.role_id
    LEFT JOIN role_capabilities rc ON rc.role_id = uor.role_id AND rc.capability_name = ?
    WHERE uor.user_id = ? AND uor.org_id = ?
      AND (uor.expires_at IS NULL OR uor.expires_at > ?)
  `).get(capabilityName, userId, orgId, now) as {
    role_id: number; role_name: string; granted: number | null; scope: string | null;
  } | undefined;

  if (!orgRole) {
    return { allowed: false, reason: "User has no role in this organization", source: "no_role" };
  }

  if (orgRole.granted === null) {
    return { allowed: false, reason: `Capability '${capabilityName}' not in role '${orgRole.role_name}'`, source: "no_capability", roleId: orgRole.role_id, roleName: orgRole.role_name };
  }

  if (orgRole.granted === 0) {
    return { allowed: false, reason: `Explicitly denied by role '${orgRole.role_name}'`, source: "explicit_deny", roleId: orgRole.role_id };
  }

  return { allowed: true, reason: `Role: ${orgRole.role_name}`, source: "role", roleId: orgRole.role_id, roleName: orgRole.role_name };
}

// ── Role CRUD ─────────────────────────────────────────────────────────

export function listRolesForOrg(orgId: number): RoleInfo[] {
  const rows = db.prepare(`
    SELECT * FROM roles WHERE org_id IS NULL OR org_id = ? ORDER BY is_system DESC, name ASC
  `).all(orgId) as Array<Record<string, unknown>>;

  return rows.map(toRoleInfo);
}

export function createCustomRole(
  orgId: number,
  name: string,
  displayName: string,
  description: string,
  capabilityNames: string[],
): RoleInfo {
  const now = Date.now();
  const slug = name.toLowerCase().replace(/[^a-z0-9-]/g, "-");

  const result = db.prepare(
    "INSERT INTO roles (org_id, name, display_name, description, is_system, is_custom, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 1, ?, ?)"
  ).run(orgId, slug, displayName, description, now, now);

  const roleId = Number(result.lastInsertRowid);

  // Add capabilities
  const insertCap = db.prepare(
    "INSERT OR IGNORE INTO role_capabilities (role_id, capability_name, scope, granted, created_at) VALUES (?, ?, 'org', 1, ?)"
  );
  for (const cap of capabilityNames) {
    insertCap.run(roleId, cap, now);
  }

  return {
    id: roleId,
    orgId,
    name: slug,
    displayName,
    description,
    isSystem: 0,
    isCustom: 1,
    createdAt: now,
  };
}

export function updateRoleCapabilities(
  roleId: number,
  capabilityNames: string[],
): void {
  const role = db.prepare("SELECT is_system FROM roles WHERE id = ?").get(roleId) as { is_system: number } | undefined;
  if (role?.is_system) {
    throw new Error("Cannot modify built-in system roles");
  }

  const now = Date.now();
  // Remove existing capabilities
  db.prepare("DELETE FROM role_capabilities WHERE role_id = ?").run(roleId);

  // Add new ones
  const insert = db.prepare(
    "INSERT INTO role_capabilities (role_id, capability_name, scope, granted, created_at) VALUES (?, ?, 'org', 1, ?)"
  );
  for (const cap of capabilityNames) {
    insert.run(roleId, cap, now);
  }

  db.prepare("UPDATE roles SET updated_at = ? WHERE id = ?").run(now, roleId);
}

export function deleteCustomRole(roleId: number): boolean {
  const role = db.prepare("SELECT is_system FROM roles WHERE id = ?").get(roleId) as { is_system: number } | undefined;
  if (role?.is_system) {
    throw new Error("Cannot delete built-in system roles");
  }

  const result = db.prepare("DELETE FROM roles WHERE id = ? AND is_system = 0").run(roleId);
  return result.changes > 0;
}

export function getRoleCapabilities(roleId: number): Array<{ capabilityName: string; scope: string; granted: number }> {
  const rows = db.prepare(
    "SELECT capability_name, scope, granted FROM role_capabilities WHERE role_id = ?"
  ).all(roleId) as Array<{ capability_name: string; scope: string; granted: number }>;

  return rows.map((r) => ({
    capabilityName: r.capability_name,
    scope: r.scope,
    granted: r.granted,
  }));
}

// ── Capabilities ──────────────────────────────────────────────────────

export function listAllCapabilities(): CapabilityInfo[] {
  return db.prepare(
    "SELECT name, resource, action, description, category, risk_level FROM capabilities ORDER BY category, name"
  ).all() as CapabilityInfo[];
}

// ── User Role Assignment ──────────────────────────────────────────────

export function assignOrgRole(userId: number, orgId: number, roleId: number, grantedBy?: number): void {
  const now = Date.now();
  db.prepare(
    "INSERT OR REPLACE INTO user_org_roles (user_id, org_id, role_id, granted_by, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run(userId, orgId, roleId, grantedBy ?? null, now);
}

export function assignTeamRole(userId: number, teamId: number, roleId: number, grantedBy?: number): void {
  const now = Date.now();
  db.prepare(
    "INSERT OR REPLACE INTO user_team_roles (user_id, team_id, role_id, granted_by, created_at) VALUES (?, ?, ?, ?, ?)"
  ).run(userId, teamId, roleId, grantedBy ?? null, now);
}

// ── Overrides ─────────────────────────────────────────────────────────

export function addCapabilityOverride(
  userId: number,
  orgId: number,
  capabilityName: string,
  granted: boolean,
  reason: string,
  grantedBy: number,
  expiresAt?: number,
): void {
  const now = Date.now();
  db.prepare(
    "INSERT OR REPLACE INTO user_capability_overrides (user_id, org_id, capability_name, granted, reason, granted_by, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(userId, orgId, capabilityName, granted ? 1 : 0, reason, grantedBy, expiresAt ?? null, now);
}

export function removeCapabilityOverride(userId: number, orgId: number, capabilityName: string): boolean {
  const result = db.prepare(
    "DELETE FROM user_capability_overrides WHERE user_id = ? AND org_id = ? AND capability_name = ?"
  ).run(userId, orgId, capabilityName);
  return result.changes > 0;
}

export function listOverridesForUser(userId: number, orgId: number) {
  return db.prepare(
    "SELECT * FROM user_capability_overrides WHERE user_id = ? AND org_id = ?"
  ).all(userId, orgId);
}

// ── Audit Logging ─────────────────────────────────────────────────────

export function logPermissionCheck(
  userId: number,
  orgId: number,
  capabilityName: string,
  result: PermissionCheckResult,
  requestId?: string,
  ipAddress?: string,
  teamId?: number,
): void {
  const now = Date.now();

  // Get previous hash for chain
  const prev = db.prepare(
    "SELECT row_hash FROM permission_audit_log ORDER BY id DESC LIMIT 1"
  ).get() as { row_hash: string } | undefined;
  const prevHash = prev?.row_hash ?? "GENESIS";

  // Compute row hash
  const payload = `${userId}:${orgId}:${capabilityName}:${result.allowed}:${now}:${prevHash}`;
  const rowHash = crypto.createHash("sha256").update(payload).digest("hex");

  db.prepare(`
    INSERT INTO permission_audit_log
    (user_id, org_id, team_id, capability_name, action, result, reason, role_id_used, ip_address, request_id, prev_hash, row_hash, ts)
    VALUES (?, ?, ?, ?, 'check', ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    userId, orgId, teamId ?? null, capabilityName,
    result.allowed ? "allowed" : "denied",
    result.reason, result.roleId ?? null,
    ipAddress ?? null, requestId ?? null,
    prevHash, rowHash, now
  );
}

// ── Helpers ───────────────────────────────────────────────────────────

function toRoleInfo(row: Record<string, unknown>): RoleInfo {
  return {
    id: row.id as number,
    orgId: (row.org_id as number | null) ?? null,
    name: row.name as string,
    displayName: row.display_name as string,
    description: (row.description as string | null) ?? null,
    isSystem: row.is_system as number,
    isCustom: row.is_custom as number,
    createdAt: row.created_at as number,
  };
}
