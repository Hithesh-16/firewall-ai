/**
 * RBAC Tests — Roles, Capabilities, Permission Resolution
 */

import assert from "node:assert";
import db from "../db/database";
import {
  checkPermission,
  listRolesForOrg,
  createCustomRole,
  updateRoleCapabilities,
  deleteCustomRole,
  getRoleCapabilities,
  listAllCapabilities,
  assignOrgRole,
  assignTeamRole,
  addCapabilityOverride,
  removeCapabilityOverride,
} from "../auth/rbacService";

// ── Helpers ───────────────────────────────────────────────────────────

let seqCounter = 0;
function uniq() { return `${Date.now()}-${++seqCounter}-${Math.random().toString(36).slice(2, 8)}`; }

function setupTestOrg(): { orgId: number; userId: number; adminRoleId: number; devRoleId: number } {
  const u = uniq();
  const orgResult = db.prepare(
    "INSERT INTO organizations (name, slug, created_at) VALUES (?, ?, ?)"
  ).run("Test Org", `test-org-${u}`, Date.now());
  const orgId = Number(orgResult.lastInsertRowid);

  const userResult = db.prepare(
    "INSERT INTO users (email, name, password_hash, role, org_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(`test-${u}@test.com`, "Test User", "hash", "developer", orgId, Date.now(), Date.now());
  const userId = Number(userResult.lastInsertRowid);

  const adminRole = db.prepare("SELECT id FROM roles WHERE name = 'admin' AND org_id IS NULL").get() as { id: number };
  const devRole = db.prepare("SELECT id FROM roles WHERE name = 'developer' AND org_id IS NULL").get() as { id: number };

  return { orgId, userId, adminRoleId: adminRole.id, devRoleId: devRole.id };
}

// ── Tests ─────────────────────────────────────────────────────────────

export function testSystemRolesSeeded() {
  const roles = db.prepare("SELECT name FROM roles WHERE is_system = 1 AND org_id IS NULL").all() as Array<{ name: string }>;
  const names = roles.map((r) => r.name);
  assert.ok(names.includes("admin"), "Admin role should be seeded");
  assert.ok(names.includes("security_lead"), "Security Lead role should be seeded");
  assert.ok(names.includes("developer"), "Developer role should be seeded");
  assert.ok(names.includes("auditor"), "Auditor role should be seeded");
}

export function testCapabilitiesSeeded() {
  const caps = listAllCapabilities();
  assert.ok(caps.length >= 30, `Expected at least 30 capabilities, got ${caps.length}`);
  const names = caps.map((c) => c.name);
  assert.ok(names.includes("policy:write"), "policy:write should exist");
  assert.ok(names.includes("agent:use"), "agent:use should exist");
  assert.ok(names.includes("file_restrictions:manage"), "file_restrictions:manage should exist");
}

export function testAdminHasAllCapabilities() {
  const { orgId, userId, adminRoleId } = setupTestOrg();
  assignOrgRole(userId, orgId, adminRoleId);

  const policyCheck = checkPermission(userId, orgId, "policy:write");
  assert.ok(policyCheck.allowed, "Admin should have policy:write");

  const agentCheck = checkPermission(userId, orgId, "agent:use");
  assert.ok(agentCheck.allowed, "Admin should have agent:use");

  const orgCheck = checkPermission(userId, orgId, "org:write");
  assert.ok(orgCheck.allowed, "Admin should have org:write");
}

export function testDeveloperLacksAdminCapabilities() {
  const { orgId, userId, devRoleId } = setupTestOrg();
  assignOrgRole(userId, orgId, devRoleId);

  const agentCheck = checkPermission(userId, orgId, "agent:use");
  assert.ok(agentCheck.allowed, "Developer should have agent:use");

  const policyCheck = checkPermission(userId, orgId, "policy:write");
  assert.ok(!policyCheck.allowed, "Developer should NOT have policy:write");

  const orgCheck = checkPermission(userId, orgId, "org:write");
  assert.ok(!orgCheck.allowed, "Developer should NOT have org:write");
}

export function testNoRoleDeniesEverything() {
  // Create a user with NO legacy role string — tests the "truly no role" path
  const u = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const orgResult = db.prepare(
    "INSERT INTO organizations (name, slug, created_at) VALUES (?, ?, ?)"
  ).run("No Role Org", `no-role-org-${u}`, Date.now());
  const orgId = Number(orgResult.lastInsertRowid);

  const userResult = db.prepare(
    "INSERT INTO users (email, name, password_hash, role, org_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(`norole-${u}@test.com`, "No Role User", "hash", "", orgId, Date.now(), Date.now());
  const userId = Number(userResult.lastInsertRowid);

  const check = checkPermission(userId, orgId, "agent:use");
  assert.ok(!check.allowed, "User without role should be denied");
  assert.strictEqual(check.source, "no_role", "Source should be no_role");
}

export function testCapabilityOverrideGrants() {
  const { orgId, userId, devRoleId, adminRoleId } = setupTestOrg();
  assignOrgRole(userId, orgId, devRoleId);

  // Developer shouldn't have policy:write
  const before = checkPermission(userId, orgId, "policy:write");
  assert.ok(!before.allowed, "Dev should not have policy:write by default");

  // Grant override
  const adminUser = db.prepare(
    "INSERT INTO users (email, name, password_hash, role, org_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(`admin-${uniq()}@test.com`, "Admin", "hash", "admin", orgId, Date.now(), Date.now());
  addCapabilityOverride(userId, orgId, "policy:write", true, "Temporary access for policy review", Number(adminUser.lastInsertRowid));

  const after = checkPermission(userId, orgId, "policy:write");
  assert.ok(after.allowed, "Override should grant policy:write");
  assert.strictEqual(after.source, "override", "Source should be override");
}

export function testCapabilityOverrideDenies() {
  const { orgId, userId, adminRoleId } = setupTestOrg();
  assignOrgRole(userId, orgId, adminRoleId);

  // Admin has agent:use
  const before = checkPermission(userId, orgId, "agent:use");
  assert.ok(before.allowed, "Admin should have agent:use");

  // Deny override
  addCapabilityOverride(userId, orgId, "agent:use", false, "Suspended from agent access", userId);

  const after = checkPermission(userId, orgId, "agent:use");
  assert.ok(!after.allowed, "Deny override should revoke agent:use");
  assert.strictEqual(after.source, "explicit_deny", "Source should be explicit_deny");
}

export function testCustomRoleCrud() {
  const { orgId } = setupTestOrg();

  const role = createCustomRole(orgId, "team-lead", "Team Lead", "Can manage team", [
    "team:read",
    "team:write",
    "user:read",
    "agent:use",
  ]);
  assert.ok(role.id > 0, "Role should have an ID");
  assert.strictEqual(role.isCustom, 1, "Should be custom");

  const caps = getRoleCapabilities(role.id);
  assert.strictEqual(caps.length, 4, "Should have 4 capabilities");

  // Update capabilities
  updateRoleCapabilities(role.id, ["team:read", "agent:use"]);
  const updatedCaps = getRoleCapabilities(role.id);
  assert.strictEqual(updatedCaps.length, 2, "Should now have 2 capabilities");

  // Delete
  const deleted = deleteCustomRole(role.id);
  assert.ok(deleted, "Should delete successfully");
}

export function testCannotDeleteSystemRole() {
  const adminRole = db.prepare("SELECT id FROM roles WHERE name = 'admin' AND org_id IS NULL").get() as { id: number };
  assert.throws(
    () => deleteCustomRole(adminRole.id),
    /Cannot delete built-in/,
    "Should throw when deleting system role"
  );
}

export function testListRolesIncludesSystemAndCustom() {
  const { orgId } = setupTestOrg();
  createCustomRole(orgId, `custom-${Date.now()}`, "Custom Role", "Test", ["agent:use"]);

  const roles = listRolesForOrg(orgId);
  const systemCount = roles.filter((r) => r.isSystem === 1).length;
  const customCount = roles.filter((r) => r.isCustom === 1).length;

  assert.ok(systemCount >= 4, "Should have at least 4 system roles");
  assert.ok(customCount >= 1, "Should have at least 1 custom role");
}

export function testRemoveOverrideRestoresRoleBehavior() {
  const { orgId, userId, devRoleId } = setupTestOrg();
  assignOrgRole(userId, orgId, devRoleId);

  // Grant override
  addCapabilityOverride(userId, orgId, "policy:write", true, "Temp", userId);
  const withOverride = checkPermission(userId, orgId, "policy:write");
  assert.ok(withOverride.allowed, "Should be allowed with override");

  // Remove override
  removeCapabilityOverride(userId, orgId, "policy:write");
  const withoutOverride = checkPermission(userId, orgId, "policy:write");
  assert.ok(!withoutOverride.allowed, "Should be denied after override removed");
}
