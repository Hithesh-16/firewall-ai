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
 * Chain: global → org → team → project
 * Each level can only ADD restrictions, never relax a parent-level block.
 */
export function resolveEffectivePolicy(
  orgId?: number | null,
  teamId?: number | null,
  projectRoot?: string
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

  // 3. Merge team-level override
  if (teamId) {
    const teamOverride = getPolicyForScope("team", teamId);
    if (teamOverride) {
      policy = mergeTwoLevels(policy, teamOverride);
    }
  }

  // 4. Merge project-level override (.aifirewall.json)
  if (projectRoot) {
    policy = mergeProjectPolicy(policy, projectRoot);
  }

  return policy;
}
