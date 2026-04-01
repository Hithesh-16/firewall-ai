/**
 * Auth Endpoint Tests
 *
 * Tests all auth-related functionality end-to-end:
 *   - User registration (createUser + createApiToken)
 *   - User login (authenticateUser + createApiToken)
 *   - Token validation (validateApiToken)
 *   - Token scoping (tokenHasScope)
 *   - Token CRUD (create, list, revoke)
 *   - Token rotation (rotateApiToken)
 *   - Role management (updateUserRole, getUserById)
 *   - Duplicate email rejection
 *   - Expired token rejection
 *   - Edge cases (wrong password, missing user, etc.)
 */

import assert from "node:assert";
import db from "../db/database";
import {
  createUser,
  authenticateUser,
  getUserById,
  getUsersByOrg,
  updateUserRole,
  deleteUser,
  createApiToken,
  validateApiToken,
  tokenHasScope,
  listApiTokens,
  revokeApiToken,
  rotateApiToken,
} from "../auth/authService";
import { ApiToken, TokenScope } from "../types";

// ── Helpers ───────────────────────────────────────────────────────────

let seqCounter = 0;
function uniq() {
  return `${Date.now()}-${++seqCounter}-${Math.random().toString(36).slice(2, 8)}`;
}

function makeEmail() {
  return `auth-test-${uniq()}@test.com`;
}

// ── Registration / createUser tests ──────────────────────────────────

export function testCreateUserReturnsUser() {
  const email = makeEmail();
  const user = createUser(email, "Test User", "password123");

  assert.ok(user.id > 0, "User should have a positive ID");
  assert.strictEqual(user.email, email, "Email should match");
  assert.strictEqual(user.name, "Test User", "Name should match");
  assert.strictEqual(user.role, "developer", "Default role should be developer");
  assert.strictEqual(user.orgId, null, "Default orgId should be null");
  assert.ok(user.createdAt > 0, "createdAt should be set");
  assert.ok(user.updatedAt > 0, "updatedAt should be set");
}

export function testCreateUserWithCustomRole() {
  const email = makeEmail();
  const user = createUser(email, "Admin User", "password123", "admin");

  assert.strictEqual(user.role, "admin", "Role should be admin");
}

export function testCreateUserWithOrg() {
  const orgResult = db.prepare(
    "INSERT INTO organizations (name, slug, created_at) VALUES (?, ?, ?)"
  ).run("Auth Test Org", `auth-org-${uniq()}`, Date.now());
  const orgId = Number(orgResult.lastInsertRowid);

  const email = makeEmail();
  const user = createUser(email, "Org User", "password123", "developer", orgId);

  assert.strictEqual(user.orgId, orgId, "orgId should match");
}

export function testCreateUserDuplicateEmailThrows() {
  const email = makeEmail();
  createUser(email, "First User", "password123");

  assert.throws(
    () => createUser(email, "Second User", "password456"),
    (err: Error) => err.message.includes("UNIQUE constraint"),
    "Duplicate email should throw UNIQUE constraint error"
  );
}

// ── Authentication / login tests ─────────────────────────────────────

export function testAuthenticateUserSuccess() {
  const email = makeEmail();
  createUser(email, "Login User", "correctpass");

  const user = authenticateUser(email, "correctpass");
  assert.ok(user !== null, "Should return a user");
  assert.strictEqual(user!.email, email, "Email should match");
}

export function testAuthenticateUserWrongPassword() {
  const email = makeEmail();
  createUser(email, "Login User", "correctpass");

  const result = authenticateUser(email, "wrongpass");
  assert.strictEqual(result, null, "Wrong password should return null");
}

export function testAuthenticateUserNonExistent() {
  const result = authenticateUser(`nonexistent-${uniq()}@test.com`, "anypass");
  assert.strictEqual(result, null, "Non-existent user should return null");
}

// ── getUserById / getUsersByOrg ──────────────────────────────────────

export function testGetUserById() {
  const email = makeEmail();
  const created = createUser(email, "Lookup User", "password123");

  const found = getUserById(created.id);
  assert.ok(found !== null, "Should find user by ID");
  assert.strictEqual(found!.email, email, "Email should match");
  assert.strictEqual(found!.name, "Lookup User", "Name should match");
}

export function testGetUserByIdNotFound() {
  const result = getUserById(999999);
  assert.strictEqual(result, null, "Non-existent ID should return null");
}

export function testGetUsersByOrg() {
  const orgResult = db.prepare(
    "INSERT INTO organizations (name, slug, created_at) VALUES (?, ?, ?)"
  ).run("Users Org", `users-org-${uniq()}`, Date.now());
  const orgId = Number(orgResult.lastInsertRowid);

  createUser(makeEmail(), "Org User 1", "pass123", "developer", orgId);
  createUser(makeEmail(), "Org User 2", "pass123", "developer", orgId);

  const users = getUsersByOrg(orgId);
  assert.ok(users.length >= 2, "Should find at least 2 users in org");
}

// ── updateUserRole / deleteUser ──────────────────────────────────────

export function testUpdateUserRole() {
  const email = makeEmail();
  const user = createUser(email, "Role User", "password123", "developer");
  assert.strictEqual(user.role, "developer");

  updateUserRole(user.id, "security_lead");
  const updated = getUserById(user.id);
  assert.strictEqual(updated!.role, "security_lead", "Role should be updated");
}

export function testDeleteUser() {
  const email = makeEmail();
  const user = createUser(email, "Deletable", "password123");

  deleteUser(user.id);
  const found = getUserById(user.id);
  assert.strictEqual(found, null, "Deleted user should not be found");
}

// ── API Token: create + validate ─────────────────────────────────────

export function testCreateApiTokenReturnsTokenAndRecord() {
  const user = createUser(makeEmail(), "Token User", "password123");
  const { token, record } = createApiToken(user.id, "test-token");

  assert.ok(token.startsWith("afw_"), "Token should start with afw_ prefix");
  assert.ok(record.id > 0, "Record should have an ID");
  assert.strictEqual(record.userId, user.id, "userId should match");
  assert.strictEqual(record.name, "test-token", "Name should match");
  assert.strictEqual(record.scopes, null, "Default scopes should be null");
  assert.strictEqual(record.orgId, null, "Default orgId should be null");
  assert.strictEqual(record.teamId, null, "Default teamId should be null");
  assert.strictEqual(record.expiresAt, null, "Default expiresAt should be null");
  assert.strictEqual(record.rotatedFromId, null, "Default rotatedFromId should be null");
}

export function testCreateApiTokenWithScopes() {
  const user = createUser(makeEmail(), "Scoped User", "password123");
  const { record } = createApiToken(user.id, "scoped-token", {
    scopes: ["chat:read", "chat:write"],
  });

  assert.deepStrictEqual(record.scopes, ["chat:read", "chat:write"], "Scopes should match");
}

export function testCreateApiTokenWithExpiry() {
  const user = createUser(makeEmail(), "Expiry User", "password123");
  const { record } = createApiToken(user.id, "expiry-token", {
    expiresInDays: 30,
  });

  assert.ok(record.expiresAt !== null, "expiresAt should be set");
  const expectedMin = Date.now() + 29 * 86_400_000;
  const expectedMax = Date.now() + 31 * 86_400_000;
  assert.ok(
    record.expiresAt! > expectedMin && record.expiresAt! < expectedMax,
    "expiresAt should be ~30 days from now"
  );
}

export function testCreateApiTokenWithOrgAndTeam() {
  const orgResult = db.prepare(
    "INSERT INTO organizations (name, slug, created_at) VALUES (?, ?, ?)"
  ).run("Token Org", `token-org-${uniq()}`, Date.now());
  const orgId = Number(orgResult.lastInsertRowid);

  const user = createUser(makeEmail(), "OrgToken User", "password123", "developer", orgId);
  const { record } = createApiToken(user.id, "org-token", {
    orgId,
    teamId: 42,
  });

  assert.strictEqual(record.orgId, orgId, "orgId should match");
  assert.strictEqual(record.teamId, 42, "teamId should match");
}

export function testValidateApiTokenSuccess() {
  const user = createUser(makeEmail(), "Validate User", "password123");
  const { token } = createApiToken(user.id, "valid-token");

  const result = validateApiToken(token);
  assert.ok(result !== null, "Valid token should return result");
  assert.strictEqual(result!.user.id, user.id, "User ID should match");
  assert.strictEqual(result!.token.name, "valid-token", "Token name should match");
}

export function testValidateApiTokenUpdatesLastUsed() {
  const user = createUser(makeEmail(), "LastUsed User", "password123");
  const { token, record } = createApiToken(user.id, "lastused-token");

  assert.strictEqual(record.lastUsedAt, null, "lastUsedAt should initially be null");

  validateApiToken(token);

  const tokens = listApiTokens(user.id);
  const updated = tokens.find((t) => t.id === record.id);
  assert.ok(updated!.lastUsedAt !== null, "lastUsedAt should be set after validation");
}

export function testValidateApiTokenInvalid() {
  const result = validateApiToken("afw_invalidtoken");
  assert.strictEqual(result, null, "Invalid token should return null");
}

export function testValidateApiTokenExpired() {
  const user = createUser(makeEmail(), "Expired User", "password123");

  // Insert a token that expired 1 day ago
  const crypto = require("node:crypto");
  const raw = `afw_${crypto.randomBytes(32).toString("hex")}`;
  const hashed = crypto.createHash("sha256").update(raw).digest("hex");
  const now = Date.now();

  db.prepare(
    "INSERT INTO api_tokens (user_id, token_hash, name, created_at, expires_at) VALUES (?, ?, ?, ?, ?)"
  ).run(user.id, hashed, "expired-token", now, now - 86_400_000);

  const result = validateApiToken(raw);
  assert.strictEqual(result, null, "Expired token should return null");
}

// ── Token scoping ────────────────────────────────────────────────────

export function testTokenHasScopeNullScopesAllowsAll() {
  const token: ApiToken = {
    id: 1, userId: 1, tokenHash: "h", name: "t", scopes: null,
    orgId: null, teamId: null, lastUsedAt: null,
    createdAt: Date.now(), expiresAt: null, rotatedFromId: null,
  };

  assert.strictEqual(tokenHasScope(token, "chat:write"), true, "Null scopes should allow all");
  assert.strictEqual(tokenHasScope(token, "policy:write"), true, "Null scopes should allow all");
}

export function testTokenHasScopeWildcard() {
  const token: ApiToken = {
    id: 1, userId: 1, tokenHash: "h", name: "t", scopes: ["*"],
    orgId: null, teamId: null, lastUsedAt: null,
    createdAt: Date.now(), expiresAt: null, rotatedFromId: null,
  };

  assert.strictEqual(tokenHasScope(token, "chat:write"), true, "Wildcard should allow all");
}

export function testTokenHasScopeSpecificMatch() {
  const token: ApiToken = {
    id: 1, userId: 1, tokenHash: "h", name: "t", scopes: ["chat:read", "logs:read"],
    orgId: null, teamId: null, lastUsedAt: null,
    createdAt: Date.now(), expiresAt: null, rotatedFromId: null,
  };

  assert.strictEqual(tokenHasScope(token, "chat:read"), true, "Should match specific scope");
  assert.strictEqual(tokenHasScope(token, "logs:read"), true, "Should match specific scope");
  assert.strictEqual(tokenHasScope(token, "policy:write"), false, "Should reject unlisted scope");
}

// ── Token list / revoke ──────────────────────────────────────────────

export function testListApiTokens() {
  const user = createUser(makeEmail(), "List User", "password123");
  createApiToken(user.id, "token-a");
  createApiToken(user.id, "token-b", { scopes: ["chat:read"] });

  const tokens = listApiTokens(user.id);
  assert.ok(tokens.length >= 2, "Should have at least 2 tokens");

  // Verify tokenHash is NOT returned in list
  for (const t of tokens) {
    assert.ok(!("tokenHash" in t), "tokenHash should not be in list response");
  }

  const tokenB = tokens.find((t) => t.name === "token-b");
  assert.ok(tokenB, "Should find token-b");
  assert.deepStrictEqual(tokenB!.scopes, ["chat:read"], "Scopes should be parsed");
}

export function testListApiTokensEmpty() {
  const user = createUser(makeEmail(), "Empty User", "password123");
  const tokens = listApiTokens(user.id);
  assert.strictEqual(tokens.length, 0, "New user should have no tokens");
}

export function testRevokeApiToken() {
  const user = createUser(makeEmail(), "Revoke User", "password123");
  const { token, record } = createApiToken(user.id, "revocable");

  // Token works before revocation
  assert.ok(validateApiToken(token) !== null, "Token should be valid before revoke");

  const revoked = revokeApiToken(record.id, user.id);
  assert.strictEqual(revoked, true, "Should return true on success");

  // Token no longer works
  assert.strictEqual(validateApiToken(token), null, "Revoked token should be invalid");
}

export function testRevokeApiTokenWrongUser() {
  const user1 = createUser(makeEmail(), "User 1", "password123");
  const user2 = createUser(makeEmail(), "User 2", "password123");
  const { record } = createApiToken(user1.id, "user1-token");

  const revoked = revokeApiToken(record.id, user2.id);
  assert.strictEqual(revoked, false, "Should not revoke another user's token");
}

export function testRevokeApiTokenNonExistent() {
  const user = createUser(makeEmail(), "Revoke User", "password123");
  const revoked = revokeApiToken(999999, user.id);
  assert.strictEqual(revoked, false, "Should return false for non-existent token");
}

// ── Token rotation ───────────────────────────────────────────────────

export function testRotateApiToken() {
  const user = createUser(makeEmail(), "Rotate User", "password123");
  const { token: oldRaw, record: oldRecord } = createApiToken(user.id, "rotatable", {
    scopes: ["chat:read", "logs:read"],
    expiresInDays: 30,
  });

  const result = rotateApiToken(oldRecord.id, user.id);
  assert.ok(result !== null, "Rotation should succeed");
  assert.ok(result!.token.startsWith("afw_"), "New token should have afw_ prefix");
  assert.notStrictEqual(result!.token, oldRaw, "New token should differ from old");

  // New token inherits properties
  assert.strictEqual(result!.record.name, "rotatable", "Name should carry over");
  assert.deepStrictEqual(result!.record.scopes, ["chat:read", "logs:read"], "Scopes should carry over");
  assert.strictEqual(result!.record.rotatedFromId, oldRecord.id, "rotatedFromId should reference old token");
  assert.ok(result!.record.expiresAt !== null, "ExpiresAt should be set");

  // Old token revoked
  assert.strictEqual(validateApiToken(oldRaw), null, "Old token should be revoked");

  // New token works
  assert.ok(validateApiToken(result!.token) !== null, "New token should be valid");
}

export function testRotateApiTokenPreservesOrgAndTeam() {
  const orgResult = db.prepare(
    "INSERT INTO organizations (name, slug, created_at) VALUES (?, ?, ?)"
  ).run("Rotate Org", `rotate-org-${uniq()}`, Date.now());
  const orgId = Number(orgResult.lastInsertRowid);

  const user = createUser(makeEmail(), "Rotate Org User", "password123", "developer", orgId);
  const { record: oldRecord } = createApiToken(user.id, "org-rotate", {
    orgId,
    teamId: 7,
  });

  const result = rotateApiToken(oldRecord.id, user.id);
  assert.ok(result !== null);
  assert.strictEqual(result!.record.orgId, orgId, "orgId should carry over");
  assert.strictEqual(result!.record.teamId, 7, "teamId should carry over");
}

export function testRotateApiTokenWrongUser() {
  const user1 = createUser(makeEmail(), "Rotate Owner", "password123");
  const user2 = createUser(makeEmail(), "Rotate Intruder", "password123");
  const { record } = createApiToken(user1.id, "user1-rotate");

  const result = rotateApiToken(record.id, user2.id);
  assert.strictEqual(result, null, "Should not rotate another user's token");
}

export function testRotateApiTokenNonExistent() {
  const user = createUser(makeEmail(), "Rotate User", "password123");
  const result = rotateApiToken(999999, user.id);
  assert.strictEqual(result, null, "Should return null for non-existent token");
}

export function testRotateApiTokenCustomExpiry() {
  const user = createUser(makeEmail(), "Rotate Expiry", "password123");
  const { record } = createApiToken(user.id, "rotate-exp");

  const result = rotateApiToken(record.id, user.id, 7);
  assert.ok(result !== null);
  assert.ok(result!.record.expiresAt !== null, "Should have expiry from custom days");

  const expectedMin = Date.now() + 6 * 86_400_000;
  const expectedMax = Date.now() + 8 * 86_400_000;
  assert.ok(
    result!.record.expiresAt! > expectedMin && result!.record.expiresAt! < expectedMax,
    "ExpiresAt should be ~7 days from now"
  );
}

// ── Registration + Login E2E (service layer) ─────────────────────────

export function testRegisterAndLoginFlow() {
  const email = makeEmail();
  const password = "SecurePass123!";

  // Register
  const user = createUser(email, "E2E User", password);
  const { token } = createApiToken(user.id, "default");
  assert.ok(token.startsWith("afw_"), "Registration should produce a token");

  // Login
  const authed = authenticateUser(email, password);
  assert.ok(authed !== null, "Login should succeed");
  assert.strictEqual(authed!.id, user.id, "Should be the same user");

  // Token from registration works
  const validated = validateApiToken(token);
  assert.ok(validated !== null, "Registration token should validate");
  assert.strictEqual(validated!.user.id, user.id, "Validated user should match");
}

export function testDeleteUserCascadesTokens() {
  const user = createUser(makeEmail(), "Cascade User", "password123");
  const { token } = createApiToken(user.id, "cascade-token");

  // Token works
  assert.ok(validateApiToken(token) !== null);

  // Delete user
  deleteUser(user.id);

  // Token should be gone (CASCADE)
  assert.strictEqual(validateApiToken(token), null, "Token should be deleted with user");
}

// ── Password hashing edge cases ──────────────────────────────────────

export function testDifferentPasswordsProduceDifferentHashes() {
  const email1 = makeEmail();
  const email2 = makeEmail();
  createUser(email1, "User A", "password1");
  createUser(email2, "User B", "password2");

  // Cross-authentication should fail
  assert.strictEqual(authenticateUser(email1, "password2"), null);
  assert.strictEqual(authenticateUser(email2, "password1"), null);

  // Correct passwords work
  assert.ok(authenticateUser(email1, "password1") !== null);
  assert.ok(authenticateUser(email2, "password2") !== null);
}
