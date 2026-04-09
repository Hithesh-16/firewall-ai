/**
 * Policy Inheritance Chain Tests
 *
 * Tests the org → team → project merge with strictest-wins semantics.
 */

import assert from "node:assert";
import db from "../db/database";
import {
  resolveEffectivePolicy,
  saveScopedPolicy,
  deleteScopedPolicy,
} from "../policy/policyChain";

let seqCounter = 0;
function uniq() {
  return `${Date.now()}-${++seqCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

function makeOrg(): number {
  const result = db
    .prepare(
      "INSERT INTO organizations (name, slug, created_at) VALUES (?, ?, ?)",
    )
    .run("Chain Org", `chain-${uniq()}`, Date.now());
  return Number(result.lastInsertRowid);
}

function makeTeam(orgId: number): number {
  const result = db
    .prepare(
      "INSERT INTO teams (org_id, name, slug, created_at) VALUES (?, ?, ?, ?)",
    )
    .run(orgId, "Chain Team", `chain-team-${uniq()}`, Date.now());
  return Number(result.lastInsertRowid);
}

// ── Tests ─────────────────────────────────────────────────────────────

export function testGlobalPolicyReturnsWithoutOverrides() {
  const orgId = makeOrg();
  const policy = resolveEffectivePolicy(orgId);
  // Should return global policy as-is
  assert.ok(policy.version, "Should have a version from global policy");
  assert.ok(policy.rules, "Should have rules from global policy");
  assert.ok(policy.file_scope, "Should have file_scope from global policy");
}

export function testOrgOverrideAddsBlocklistPatterns() {
  const orgId = makeOrg();

  saveScopedPolicy("org", orgId, {
    file_scope: { blocklist: ["org-secret/**"], allowlist: [] },
  } as any);

  const policy = resolveEffectivePolicy(orgId);
  assert.ok(
    policy.file_scope.blocklist.includes("org-secret/**"),
    "Org blocklist pattern should be merged into effective policy",
  );
}

export function testTeamOverrideExtendsOrg() {
  const orgId = makeOrg();
  const teamId = makeTeam(orgId);

  saveScopedPolicy("org", orgId, {
    file_scope: { blocklist: ["org-only/**"], allowlist: [] },
  } as any);
  saveScopedPolicy("team", teamId, {
    file_scope: { blocklist: ["team-only/**"], allowlist: [] },
  } as any);

  const policy = resolveEffectivePolicy(orgId, null, teamId);
  assert.ok(
    policy.file_scope.blocklist.includes("org-only/**"),
    "Should include org blocklist",
  );
  assert.ok(
    policy.file_scope.blocklist.includes("team-only/**"),
    "Should include team blocklist (union)",
  );
}

export function testStrictestRulesWin() {
  const orgId = makeOrg();

  // Org enables blocking database URLs
  saveScopedPolicy("org", orgId, {
    rules: { block_db_urls: true },
  } as any);

  const policy = resolveEffectivePolicy(orgId);
  assert.strictEqual(
    policy.rules.block_db_urls,
    true,
    "Org override should enable block_db_urls (OR semantics)",
  );
}

export function testStrictestThresholdWins() {
  const orgId = makeOrg();

  // Org sets stricter threshold
  saveScopedPolicy("org", orgId, {
    severity_threshold: "medium",
  } as any);

  const policy = resolveEffectivePolicy(orgId);
  assert.strictEqual(
    policy.severity_threshold,
    "medium",
    "Stricter threshold should win",
  );
}

export function testDeleteScopedPolicyReverts() {
  const orgId = makeOrg();

  saveScopedPolicy("org", orgId, {
    file_scope: { blocklist: ["temp-pattern/**"], allowlist: [] },
  } as any);

  let policy = resolveEffectivePolicy(orgId);
  assert.ok(
    policy.file_scope.blocklist.includes("temp-pattern/**"),
    "Should have org pattern before delete",
  );

  deleteScopedPolicy("org", orgId);

  policy = resolveEffectivePolicy(orgId);
  assert.ok(
    !policy.file_scope.blocklist.includes("temp-pattern/**"),
    "Org pattern should be gone after delete",
  );
}

export function testChildCannotRelaxParentBlock() {
  const orgId = makeOrg();
  const teamId = makeTeam(orgId);

  // Org blocks db urls
  saveScopedPolicy("org", orgId, {
    rules: { block_db_urls: true },
  } as any);

  // Team tries to "unblock" (should have no effect — OR semantics)
  saveScopedPolicy("team", teamId, {
    rules: { block_db_urls: false },
  } as any);

  const policy = resolveEffectivePolicy(orgId, null, teamId);
  assert.strictEqual(
    policy.rules.block_db_urls,
    true,
    "Team cannot relax org-level block (OR semantics: true || false = true)",
  );
}
