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
    // Fallback: check legacy users.role field for backward compatibility
    // This handles users created before RBAC was wired into registration
    const legacyUser = db.prepare(
      "SELECT role FROM users WHERE id = ?"
    ).get(userId) as { role: string } | undefined;

    if (legacyUser?.role) {
      // Find the system role matching the legacy role string
      const systemRole = db.prepare(
        "SELECT r.id, r.name, rc.granted FROM roles r LEFT JOIN role_capabilities rc ON rc.role_id = r.id AND rc.capability_name = ? WHERE r.name = ? AND r.is_system = 1"
      ).get(capabilityName, legacyUser.role) as { id: number; name: string; granted: number | null } | undefined;

      if (systemRole) {
        // Auto-assign the org role for future checks (self-healing)
        try {
          db.prepare(
            "INSERT OR IGNORE INTO user_org_roles (user_id, org_id, role_id, created_at) VALUES (?, ?, ?, ?)"
          ).run(userId, orgId, systemRole.id, now);
        } catch {
          // Non-critical — assignment will happen on next request
        }

        if (systemRole.granted === 1) {
          return { allowed: true, reason: `Legacy role: ${systemRole.name}`, source: "role", roleId: systemRole.id, roleName: systemRole.name };
        }
        if (systemRole.granted === 0) {
          return { allowed: false, reason: `Denied by role: ${systemRole.name}`, source: "explicit_deny", roleId: systemRole.id };
        }
        return { allowed: false, reason: `Capability '${capabilityName}' not in role '${systemRole.name}'`, source: "no_capability", roleId: systemRole.id, roleName: systemRole.name };
      }
    }

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

/**
 * Validate that every resource with a write-style action
 * (`create|edit|delete|export`) also grants `view` (or the legacy `read`).
 *
 * Throws with a message the route handler converts into HTTP 422.
 * Matches the RBAC spec: "Backend MUST reject any role save where
 * create/edit/delete/export exists without view for the same resource."
 */
export function validatePermissionDependencies(
  capabilityNames: string[],
): void {
  const DEPENDS_ON_VIEW = ["create", "edit", "delete", "export"] as const;
  const byResource = new Map<string, Set<string>>();
  for (const cap of capabilityNames) {
    const [resource, action] = cap.split(":");
    if (!resource || !action) continue;
    if (!byResource.has(resource)) byResource.set(resource, new Set());
    byResource.get(resource)!.add(action);
  }

  const problems: string[] = [];
  for (const [resource, actions] of byResource) {
    const hasView = actions.has("view") || actions.has("read");
    if (hasView) continue;
    for (const dep of DEPENDS_ON_VIEW) {
      if (actions.has(dep)) {
        problems.push(
          `${resource}:${dep} requires ${resource}:view (dependency rule)`,
        );
      }
    }
  }
  if (problems.length > 0) {
    const err = new Error(problems.join("; "));
    (err as Error & { code?: string }).code = "RBAC_DEPENDENCY_VIOLATION";
    throw err;
  }
}

export function createCustomRole(
  orgId: number,
  name: string,
  displayName: string,
  description: string,
  capabilityNames: string[],
): RoleInfo {
  validatePermissionDependencies(capabilityNames);
  if (capabilityNames.length === 0) {
    const err = new Error("Role must grant at least one permission");
    (err as Error & { code?: string }).code = "RBAC_EMPTY_ROLE";
    throw err;
  }
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
  const role = db
    .prepare("SELECT is_system FROM roles WHERE id = ?")
    .get(roleId) as { is_system: number } | undefined;
  if (!role) {
    const err = new Error("Role not found");
    (err as Error & { code?: string }).code = "RBAC_ROLE_NOT_FOUND";
    throw err;
  }
  if (role.is_system) {
    const err = new Error("Cannot modify built-in system roles");
    (err as Error & { code?: string }).code = "RBAC_SYSTEM_ROLE_LOCKED";
    throw err;
  }

  validatePermissionDependencies(capabilityNames);
  if (capabilityNames.length === 0) {
    const err = new Error("Role must grant at least one permission");
    (err as Error & { code?: string }).code = "RBAC_EMPTY_ROLE";
    throw err;
  }

  const now = Date.now();
  // Remove existing capabilities
  db.prepare("DELETE FROM role_capabilities WHERE role_id = ?").run(roleId);

  // Add new ones
  const insert = db.prepare(
    "INSERT INTO role_capabilities (role_id, capability_name, scope, granted, created_at) VALUES (?, ?, 'org', 1, ?)",
  );
  for (const cap of capabilityNames) {
    insert.run(roleId, cap, now);
  }

  db.prepare("UPDATE roles SET updated_at = ? WHERE id = ?").run(now, roleId);
}

/**
 * Compute the flat list of capability atoms the given user effectively
 * holds in the given org.
 *
 * Resolution order mirrors `checkPermission`:
 *   1. Start from the user's org role's granted capabilities.
 *   2. Layer on user_capability_overrides — grants add, denies remove.
 *   3. Drop expired overrides.
 *
 * Used by the frontend's `/api/me/permissions` endpoint so the UI can
 * cache the full permission set in Redux and answer `usePermission()`
 * calls locally without a round trip.
 */
export function listEffectiveCapabilities(
  userId: number,
  orgId: number,
): string[] {
  const now = Date.now();

  // 1. Role's granted caps
  const roleCaps = db
    .prepare(
      `SELECT rc.capability_name AS name
         FROM user_org_roles uor
         JOIN role_capabilities rc
           ON rc.role_id = uor.role_id
         WHERE uor.user_id = ?
           AND uor.org_id  = ?
           AND rc.granted  = 1
           AND (uor.expires_at IS NULL OR uor.expires_at > ?)`,
    )
    .all(userId, orgId, now) as Array<{ name: string }>;

  const set = new Set<string>(roleCaps.map((r) => r.name));

  // Fallback for legacy users who never got a user_org_roles row
  if (set.size === 0) {
    const legacyUser = db
      .prepare("SELECT role FROM users WHERE id = ?")
      .get(userId) as { role: string } | undefined;
    if (legacyUser?.role) {
      const rows = db
        .prepare(
          `SELECT rc.capability_name AS name
             FROM roles r
             JOIN role_capabilities rc ON rc.role_id = r.id
             WHERE r.name = ? AND r.is_system = 1 AND rc.granted = 1`,
        )
        .all(legacyUser.role) as Array<{ name: string }>;
      for (const r of rows) set.add(r.name);
    }
  }

  // 2. User-level overrides (grants add, denies remove)
  const overrides = db
    .prepare(
      `SELECT capability_name AS name, granted, expires_at
         FROM user_capability_overrides
         WHERE user_id = ? AND org_id = ?`,
    )
    .all(userId, orgId) as Array<{
    name: string;
    granted: number;
    expires_at: number | null;
  }>;
  for (const o of overrides) {
    if (o.expires_at && o.expires_at < now) continue;
    if (o.granted === 1) set.add(o.name);
    else set.delete(o.name);
  }

  return Array.from(set).sort();
}

/**
 * Count how many users currently have a given role. Used to block
 * deleting a custom role that still has active assignments (spec rule:
 * return 409 with the affected count).
 */
export function countUsersWithRole(roleId: number): number {
  const row = db
    .prepare(
      "SELECT COUNT(*) AS n FROM user_org_roles WHERE role_id = ?",
    )
    .get(roleId) as { n: number };
  return row?.n ?? 0;
}

export function deleteCustomRole(roleId: number): boolean {
  const role = db
    .prepare("SELECT is_system FROM roles WHERE id = ?")
    .get(roleId) as { is_system: number } | undefined;
  if (!role) return false;
  if (role.is_system) {
    const err = new Error("Cannot delete built-in system roles");
    (err as Error & { code?: string }).code = "RBAC_SYSTEM_ROLE_LOCKED";
    throw err;
  }

  const activeUsers = countUsersWithRole(roleId);
  if (activeUsers > 0) {
    const err = new Error(
      `${activeUsers} user${activeUsers === 1 ? " is" : "s are"} still assigned this role — reassign them before deleting.`,
    );
    (err as Error & { code?: string; count?: number }).code =
      "RBAC_ROLE_IN_USE";
    (err as Error & { count?: number }).count = activeUsers;
    throw err;
  }

  const result = db
    .prepare("DELETE FROM roles WHERE id = ? AND is_system = 0")
    .run(roleId);
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
