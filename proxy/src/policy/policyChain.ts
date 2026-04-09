/**
 * Policy Inheritance Chain
 *
 * Resolves effective policy by merging multiple levels:
 *   1. Global policy.json (baseline)
 *   2. Org-level policy override (from DB)
 *   3. Team-level policy override (from DB)
 *   4. Project-level policy override (.aifirewall.json file)
 *
 * Merge semantics — STRICTEST WINS:
 *   - Boolean rules: OR (if ANY level says true, result is true)
 *   - Severity threshold: MIN (use the strictest / lowest threshold)
 *   - Blocklists: UNION (combine all patterns from all levels)
 *   - Allowlists: INTERSECTION (file must be in ALL allowlists)
 *   - No child scope can relax a parent-level block
 */

import db from "../db/database";
import { loadPolicyConfig } from "../config";
import { mergeProjectPolicy } from "./projectPolicy";
import type { PolicyConfig, PolicyRules } from "../types";

// ── Types ─────────────────────────────────────────────────────────────

interface StoredPolicy {
  id: number;
  scopeType: string;
  scopeId: number | null;
  policyJson: string;
  createdAt: number;
  updatedAt: number;
}

export type PartialPolicy = Omit<Partial<PolicyConfig>, "rules"> & {
  rules?: Partial<PolicyRules>;
};

// ── DB Operations ─────────────────────────────────────────────────────

function getPolicyForScope(scopeType: string, scopeId: number | null): PartialPolicy | null {
  const row = db.prepare(
    "SELECT policy_json FROM policies WHERE scope_type = ? AND scope_id IS ?"
  ).get(scopeType, scopeId) as { policy_json: string } | undefined;

  if (!row) return null;

  try {
    return JSON.parse(row.policy_json) as PartialPolicy;
  } catch {
    return null;
  }
}

export function saveScopedPolicy(
  scopeType: string,
  scopeId: number | null,
  policy: PartialPolicy
): void {
  const now = Date.now();
  const json = JSON.stringify(policy);

  const existing = db.prepare(
    "SELECT id FROM policies WHERE scope_type = ? AND scope_id IS ?"
  ).get(scopeType, scopeId) as { id: number } | undefined;

  if (existing) {
    db.prepare(
      "UPDATE policies SET policy_json = ?, updated_at = ? WHERE id = ?"
    ).run(json, now, existing.id);
  } else {
    db.prepare(
      "INSERT INTO policies (scope_type, scope_id, policy_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
    ).run(scopeType, scopeId, json, now, now);
  }
}

export function deleteScopedPolicy(scopeType: string, scopeId: number | null): boolean {
  const result = db.prepare(
    "DELETE FROM policies WHERE scope_type = ? AND scope_id IS ?"
  ).run(scopeType, scopeId);
  return result.changes > 0;
}

export function listScopedPolicies(orgId: number): StoredPolicy[] {
  const rows = db.prepare(`
    SELECT id, scope_type, scope_id, policy_json, created_at, updated_at
    FROM policies
    WHERE scope_type = 'org' AND scope_id = ?
       OR scope_type = 'team' AND scope_id IN (SELECT id FROM teams WHERE org_id = ?)
    ORDER BY scope_type, scope_id
  `).all(orgId, orgId) as Array<Record<string, unknown>>;

  return rows.map((r) => ({
    id: r.id as number,
    scopeType: r.scope_type as string,
    scopeId: (r.scope_id as number | null) ?? null,
    policyJson: r.policy_json as string,
    createdAt: r.created_at as number,
    updatedAt: r.updated_at as number,
  }));
}

// ── Role-scoped policies ──────────────────────────────────────────────

import {
  ROLE_DEFAULT_POLICIES,
  SYSTEM_ROLE_NAMES,
  isSystemRoleName,
} from "./roleDefaults";

/**
 * Legacy export: the four proxy-wide system role names. Kept for
 * backward compatibility with callers that want to enumerate the
 * built-ins. Custom roles are stored in the same `role_policies`
 * table using their own name, so the accepted `role` argument type
 * everywhere is `string`.
 */
export const SYSTEM_ROLES = SYSTEM_ROLE_NAMES;
export type SystemRole = (typeof SYSTEM_ROLE_NAMES)[number];

export interface StoredRolePolicy {
  id: number;
  orgId: number;
  role: string;
  policy: PartialPolicy;
  policyJson: string;
  createdAt: number;
  updatedAt: number;
}

function rowToRolePolicy(row: Record<string, unknown>): StoredRolePolicy {
  const json = row.policy_json as string;
  let policy: PartialPolicy;
  try {
    policy = JSON.parse(json) as PartialPolicy;
  } catch {
    policy = {};
  }
  return {
    id: row.id as number,
    orgId: row.org_id as number,
    role: row.role as string,
    policy,
    policyJson: json,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  };
}

/**
 * Read the role-scoped policy override for a given (org, role) pair.
 *
 * If no row exists AND the role name matches one of the four system
 * roles, we LAZY-SEED the default from `ROLE_DEFAULT_POLICIES` before
 * returning. This makes the Policy tab in the RBAC UI always show
 * populated defaults for system roles instead of an empty `{}`, and
 * gives users a starting point they can edit.
 *
 * For custom roles with no override, we still return `null` so the
 * UI can render the commented JSONC template from
 * `ROLE_POLICY_TEMPLATE_JSONC` as a starting point.
 */
export function getRolePolicy(
  orgId: number,
  role: string,
): StoredRolePolicy | null {
  const row = db
    .prepare(
      "SELECT id, org_id, role, policy_json, created_at, updated_at FROM role_policies WHERE org_id = ? AND role = ?",
    )
    .get(orgId, role) as Record<string, unknown> | undefined;
  if (row) return rowToRolePolicy(row);

  // Lazy-seed defaults for system roles only. Custom roles stay null
  // so the UI can show the template instead.
  if (isSystemRoleName(role)) {
    const defaults = ROLE_DEFAULT_POLICIES[role];
    return saveRolePolicy(orgId, role, defaults);
  }

  return null;
}

/**
 * List all role-scoped policies for an org. Returns one row per role
 * that has an override; roles without an override are omitted.
 */
export function listRolePolicies(orgId: number): StoredRolePolicy[] {
  const rows = db
    .prepare(
      "SELECT id, org_id, role, policy_json, created_at, updated_at FROM role_policies WHERE org_id = ? ORDER BY role",
    )
    .all(orgId) as Array<Record<string, unknown>>;
  return rows.map(rowToRolePolicy);
}

/**
 * Upsert a role-scoped policy. The policy is stored as a JSON string in
 * SQLite — we validate it's JSON.stringify-able but don't enforce the
 * full PolicyConfig shape here (the route handler does Zod validation).
 */
export function saveRolePolicy(
  orgId: number,
  role: string,
  policy: PartialPolicy,
): StoredRolePolicy {
  const now = Date.now();
  const json = JSON.stringify(policy);

  const existing = db
    .prepare("SELECT id FROM role_policies WHERE org_id = ? AND role = ?")
    .get(orgId, role) as { id: number } | undefined;

  if (existing) {
    db.prepare(
      "UPDATE role_policies SET policy_json = ?, updated_at = ? WHERE id = ?",
    ).run(json, now, existing.id);
  } else {
    db.prepare(
      "INSERT INTO role_policies (org_id, role, policy_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run(orgId, role, json, now, now);
  }

  // Fetch directly (bypass the lazy-seed path in getRolePolicy) so
  // this never recurses.
  const row = db
    .prepare(
      "SELECT id, org_id, role, policy_json, created_at, updated_at FROM role_policies WHERE org_id = ? AND role = ?",
    )
    .get(orgId, role) as Record<string, unknown>;
  return rowToRolePolicy(row);
}

/**
 * Remove a role-scoped policy override. Returns true if a row was
 * deleted, false if no override existed for that (org, role) pair.
 */
export function deleteRolePolicy(orgId: number, role: string): boolean {
  const result = db
    .prepare("DELETE FROM role_policies WHERE org_id = ? AND role = ?")
    .run(orgId, role);
  return result.changes > 0;
}

// ── Merge Logic (strictest wins) ──────────────────────────────────────

function mergeRulesStrictest(base: PolicyRules, override: Partial<PolicyRules>): PolicyRules {
  const merged = { ...base };
  for (const key of Object.keys(override) as Array<keyof PolicyRules>) {
    const overrideValue = override[key];
    if (typeof overrideValue === "boolean") {
      // OR semantics: if either level enables blocking/redaction, it stays on
      (merged as any)[key] = base[key] || overrideValue;
    }
  }
  return merged;
}

const SEVERITY_ORDER: Record<string, number> = {
  medium: 1,
  high: 2,
  critical: 3,
};

function stricterThreshold(
  a: PolicyConfig["severity_threshold"],
  b?: PolicyConfig["severity_threshold"]
): PolicyConfig["severity_threshold"] {
  if (!b) return a;
  // Lower threshold = stricter (medium catches more than critical)
  return (SEVERITY_ORDER[a] ?? 1) <= (SEVERITY_ORDER[b] ?? 1) ? a : b;
}

function mergeBlocklists(base: string[], override: string[]): string[] {
  return [...new Set([...base, ...override])];
}

function mergeAllowlists(base: string[], override: string[]): string[] {
  if (base.length === 0) return override;
  if (override.length === 0) return base;
  // Intersection — file must be in BOTH allowlists
  const overrideSet = new Set(override);
  return base.filter((pattern) => overrideSet.has(pattern));
}

function mergeTwoLevels(base: PolicyConfig, override: PartialPolicy): PolicyConfig {
  return {
    ...base,
    rules: override.rules ? mergeRulesStrictest(base.rules, override.rules) : base.rules,
    severity_threshold: stricterThreshold(base.severity_threshold, override.severity_threshold),
    file_scope: {
      ...base.file_scope,
      blocklist: mergeBlocklists(
        base.file_scope.blocklist,
        override.file_scope?.blocklist ?? []
      ),
      allowlist: mergeAllowlists(
        base.file_scope.allowlist,
        override.file_scope?.allowlist ?? []
      ),
    },
    blocked_paths: mergeBlocklists(
      base.blocked_paths,
      override.blocked_paths ?? []
    ),
    // Smart routing: child can only tighten, not relax
    smart_routing: override.smart_routing
      ? { ...base.smart_routing, ...override.smart_routing }
      : base.smart_routing,
    // Prompt injection: use stricter threshold
    prompt_injection: override.prompt_injection
      ? {
          ...base.prompt_injection,
          ...override.prompt_injection,
          threshold: Math.min(
            base.prompt_injection?.threshold ?? 60,
            override.prompt_injection?.threshold ?? 60
          ),
        }
      : base.prompt_injection,
  };
}

// ── Public API ────────────────────────────────────────────────────────

/**
 * Resolve the effective policy for a request by merging all applicable levels.
 *
 * Chain (strictest wins at every level):
 *   1. global policy.json
 *   2. org-level override
 *   3. role-level override (new in Phase 4.5)
 *   4. team-level override
 *   5. project-level override (.aifirewall.json)
 *
 * Role slots between org and team because:
 *   - Role is less specific than a team (one team has many roles)
 *   - Role is more specific than an org (one org has many roles)
 *   - Every user has exactly one role at a time, so resolution is
 *     deterministic.
 *
 * Each level can only ADD restrictions, never relax a parent-level block.
 */
export function resolveEffectivePolicy(
  orgId?: number | null,
  teamId?: number | null,
  projectRoot?: string,
  role?: string | null,
): PolicyConfig {
  // 1. Start with global policy.json
  let policy = loadPolicyConfig();

  // 2. Merge org-level override
  if (orgId) {
    const orgOverride = getPolicyForScope("org", orgId);
    if (orgOverride) {
      policy = mergeTwoLevels(policy, orgOverride);
    }
  }

  // 3. Merge role-level override (requires orgId — role is org-scoped)
  if (orgId && role) {
    const roleOverride = getRolePolicy(orgId, role);
    if (roleOverride) {
      policy = mergeTwoLevels(policy, roleOverride.policy);
    }
  }

  // 4. Merge team-level override
  if (teamId) {
    const teamOverride = getPolicyForScope("team", teamId);
    if (teamOverride) {
      policy = mergeTwoLevels(policy, teamOverride);
    }
  }

  // 5. Merge project-level override (.aifirewall.json)
  if (projectRoot) {
    policy = mergeProjectPolicy(policy, projectRoot);
  }

  return policy;
}
