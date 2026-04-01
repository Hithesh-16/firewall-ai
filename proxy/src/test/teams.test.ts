/**
 * Team + File Restriction Tests
 */

import assert from "node:assert";
import db from "../db/database";
import {
  createTeam,
  getTeamById,
  getTeamsByOrg,
  addTeamMember,
  removeTeamMember,
  getTeamMembers,
  getTeamsForUser,
  deleteTeam,
} from "../services/teamService";
import {
  getEffectiveFilePolicy,
  setFileRestriction,
  deleteFileRestriction,
  listFileRestrictions,
} from "../policy/fileRestrictionService";

// ── Helpers ───────────────────────────────────────────────────────────

let seqCounter = 0;
function uniq() { return `${Date.now()}-${++seqCounter}-${Math.random().toString(36).slice(2, 8)}`; }

function setupOrg(): { orgId: number; userId: number; userId2: number } {
  const u = uniq();
  const orgResult = db.prepare(
    "INSERT INTO organizations (name, slug, created_at) VALUES (?, ?, ?)"
  ).run("Team Test Org", `team-org-${u}`, Date.now());
  const orgId = Number(orgResult.lastInsertRowid);

  const u1 = db.prepare(
    "INSERT INTO users (email, name, password_hash, role, org_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(`u1-${u}@test.com`, "User 1", "hash", "developer", orgId, Date.now(), Date.now());

  const u2 = db.prepare(
    "INSERT INTO users (email, name, password_hash, role, org_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(`u2-${u}@test.com`, "User 2", "hash", "developer", orgId, Date.now(), Date.now());

  return { orgId, userId: Number(u1.lastInsertRowid), userId2: Number(u2.lastInsertRowid) };
}

// ── Team Tests ────────────────────────────────────────────────────────

export function testCreateTeam() {
  const { orgId } = setupOrg();
  const team = createTeam(orgId, "Frontend", `frontend-${Date.now()}`);
  assert.ok(team.id > 0, "Team should have an ID");
  assert.strictEqual(team.orgId, orgId, "Team should belong to org");
  assert.strictEqual(team.name, "Frontend", "Name should match");
}

export function testGetTeamsByOrg() {
  const { orgId } = setupOrg();
  const ts = Date.now();
  createTeam(orgId, "Team A", `a-${ts}`);
  createTeam(orgId, "Team B", `b-${ts}`);

  const teams = getTeamsByOrg(orgId);
  assert.ok(teams.length >= 2, "Should have at least 2 teams");
}

export function testTeamMembership() {
  const { orgId, userId, userId2 } = setupOrg();
  const team = createTeam(orgId, "Backend", `backend-${Date.now()}`);

  addTeamMember(team.id, userId, "lead");
  addTeamMember(team.id, userId2, "member");

  const members = getTeamMembers(team.id);
  assert.strictEqual(members.length, 2, "Should have 2 members");

  const userTeams = getTeamsForUser(userId);
  assert.ok(userTeams.some((t) => t.id === team.id), "User should be in team");

  removeTeamMember(team.id, userId2);
  const after = getTeamMembers(team.id);
  assert.strictEqual(after.length, 1, "Should have 1 member after removal");
}

export function testDeleteTeamCascades() {
  const { orgId, userId } = setupOrg();
  const team = createTeam(orgId, "Temp", `temp-${Date.now()}`);
  addTeamMember(team.id, userId, "member");

  deleteTeam(team.id);
  assert.strictEqual(getTeamById(team.id), null, "Team should be deleted");
  assert.strictEqual(getTeamMembers(team.id).length, 0, "Members should be cascaded");
}

// ── File Restriction Tests ────────────────────────────────────────────

export function testOrgLevelBlocklist() {
  const { orgId } = setupOrg();

  setFileRestriction(orgId, null, null, "blocklist", ["*.env", "*.key", "secrets/**"]);

  const policy = getEffectiveFilePolicy(orgId);
  assert.ok(policy.blocklist.includes("*.env"), "Blocklist should include *.env");
  assert.ok(policy.blocklist.includes("*.key"), "Blocklist should include *.key");
  assert.ok(policy.blocklist.includes("secrets/**"), "Blocklist should include secrets/**");
}

export function testTeamLevelExtendsOrg() {
  const { orgId } = setupOrg();
  const team = createTeam(orgId, "Security", `sec-${Date.now()}`);

  setFileRestriction(orgId, null, null, "blocklist", ["*.env"]);
  setFileRestriction(orgId, team.id, null, "blocklist", ["*.key", "*.pem"]);

  const policy = getEffectiveFilePolicy(orgId, team.id);
  assert.ok(policy.blocklist.includes("*.env"), "Should inherit org *.env");
  assert.ok(policy.blocklist.includes("*.key"), "Should have team *.key");
  assert.ok(policy.blocklist.includes("*.pem"), "Should have team *.pem");
}

export function testUserLevelExtendsTeam() {
  const { orgId, userId } = setupOrg();
  const team = createTeam(orgId, "Dev", `dev-${Date.now()}`);

  setFileRestriction(orgId, null, null, "blocklist", ["*.env"]);
  setFileRestriction(orgId, team.id, null, "blocklist", ["*.key"]);
  setFileRestriction(orgId, null, userId, "blocklist", ["config/production.*"]);

  const policy = getEffectiveFilePolicy(orgId, team.id, userId);
  assert.ok(policy.blocklist.includes("*.env"), "Should inherit org *.env");
  assert.ok(policy.blocklist.includes("*.key"), "Should inherit team *.key");
  assert.ok(policy.blocklist.includes("config/production.*"), "Should have user restriction");
}

export function testDeleteRestriction() {
  const { orgId } = setupOrg();

  const restriction = setFileRestriction(orgId, null, null, "blocklist", ["*.env"]);
  assert.ok(restriction.id > 0, "Should have an ID");

  const deleted = deleteFileRestriction(restriction.id);
  assert.ok(deleted, "Should delete successfully");

  const policy = getEffectiveFilePolicy(orgId);
  // *.env from this restriction should be gone (global policy may still have it)
  const restrictions = listFileRestrictions(orgId);
  assert.strictEqual(restrictions.length, 0, "No org restrictions should remain");
}

export function testBlocklistUnion() {
  const { orgId, userId } = setupOrg();

  setFileRestriction(orgId, null, null, "blocklist", ["*.env"]);
  setFileRestriction(orgId, null, userId, "blocklist", ["*.key"]);

  const policy = getEffectiveFilePolicy(orgId, null, userId);
  // Both should be present — union semantics
  assert.ok(policy.blocklist.includes("*.env"), "Union should include org *.env");
  assert.ok(policy.blocklist.includes("*.key"), "Union should include user *.key");
}
