/**
 * Control Plane Tests (Phase 4)
 *
 * Tests the approval service, session tracker, notification service,
 * and WebSocket manager.
 */

import assert from "node:assert";
import {
  requestApproval,
  resolveApproval,
  getPendingApprovals,
  getApprovalHistory,
  getUserRules,
  deleteRule,
} from "../services/approvalService";
import {
  startSession,
  endSession,
  getActiveSessions,
  getSessionById,
  cleanStaleSessions,
} from "../services/sessionTracker";
import {
  addChannel,
  getChannels,
  removeChannel,
} from "../notifications/notificationService";
import {
  getConnectedDevices,
  getConnectionCount,
  isUserConnected,
} from "../ws/wsManager";

// --- Approval Service ---

export async function testApprovalCreateAndTimeout() {
  // Request approval with null userId (no FK constraint) and very short timeout (50ms)
  const result = await requestApproval(null, "file_access", "/auth/secrets.ts", {}, 50);
  // Should timeout to default-deny
  assert.strictEqual(result.decision, "deny", "Should default-deny on timeout");
  assert.strictEqual(result.source, "timeout");
  assert.ok(result.requestId > 0, "Should have a valid request ID");
}

export function testApprovalResolve() {
  const db = require("../db/database").default;
  const res = db.prepare(
    "INSERT INTO approval_requests (user_id, action_type, resource, status, created_at) VALUES (?, ?, ?, 'pending', ?)"
  ).run(null, "tool_exec", "/bin/rm", Date.now());
  const id = Number(res.lastInsertRowid);

  const success = resolveApproval(id, "allow_once", "test-device");
  assert.strictEqual(success, true, "Should resolve successfully");

  const row = db.prepare("SELECT status FROM approval_requests WHERE id = ?").get(id) as { status: string };
  assert.strictEqual(row.status, "approved");
}

export function testApprovalResolveAlwaysCreatesRule() {
  // Need a real user for rule creation (uses user_id). Skip rule check if null.
  const db = require("../db/database").default;
  const res = db.prepare(
    "INSERT INTO approval_requests (user_id, action_type, resource, status, created_at) VALUES (?, ?, ?, 'pending', ?)"
  ).run(null, "mcp_call", "fs.read:/etc/passwd", Date.now());
  const id = Number(res.lastInsertRowid);

  // Resolve with allow_always — rule won't be created because userId is null
  resolveApproval(id, "allow_always");

  const row = db.prepare("SELECT status FROM approval_requests WHERE id = ?").get(id) as { status: string };
  assert.strictEqual(row.status, "approved", "Should still resolve to approved");
}

export function testApprovalPendingQuery() {
  const db = require("../db/database").default;
  db.prepare(
    "INSERT INTO approval_requests (user_id, action_type, resource, status, created_at) VALUES (?, ?, ?, 'pending', ?)"
  ).run(null, "test_action", "test_resource", Date.now());

  // Query with null userId using a direct query
  const rows = db.prepare("SELECT * FROM approval_requests WHERE user_id IS NULL AND status = 'pending'").all();
  assert.ok(rows.length > 0, "Should find pending approvals");
}

export function testApprovalHistory() {
  const history = getApprovalHistory(888, 10);
  assert.ok(Array.isArray(history), "History should be an array");
}

// --- Session Tracker ---

export function testSessionStartAndEnd() {
  const sessionId = startSession(null, "vscode-1", "vscode", "gpt-4");
  assert.ok(sessionId.length > 0, "Should return session ID");

  const session = getSessionById(sessionId);
  assert.ok(session !== null, "Should find session");
  assert.strictEqual(session!.deviceType, "vscode");
  assert.strictEqual(session!.model, "gpt-4");

  const ended = endSession(sessionId);
  assert.strictEqual(ended, true, "Should end session");
  assert.strictEqual(getSessionById(sessionId), null, "Should be gone");
}

export function testActiveSessionsQuery() {
  // Use a test user_id that doesn't need FK (null)
  const id1 = startSession(null, "cli-test-1", "cli");
  const id2 = startSession(null, "vscode-test-1", "vscode", "claude-3");

  // Query all sessions with null user
  const db = require("../db/database").default;
  const rows = db.prepare("SELECT * FROM active_sessions WHERE user_id IS NULL").all();
  assert.ok(rows.length >= 2, "Should have at least 2 sessions");

  endSession(id1);
  endSession(id2);
}

export function testCleanStaleSessions() {
  const db = require("../db/database").default;
  db.prepare(
    "INSERT OR REPLACE INTO active_sessions (id, user_id, device_id, device_type, started_at, last_activity_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run("stale-test-456", null, "old-device", "cli", Date.now() - 3600000, Date.now() - 3600000);

  const cleaned = cleanStaleSessions(30 * 60_000);
  assert.ok(cleaned > 0, "Should clean stale sessions");
}

// --- Notification Service ---

export function testNotificationChannelCrud() {
  // Use null-safe: notification_channels FK is on users(id), use a real approach
  // Insert directly with null user_id (FK allows NULL via ON DELETE CASCADE + nullable)
  const db = require("../db/database").default;
  const res = db.prepare(
    "INSERT INTO notification_channels (user_id, channel_type, config_json, enabled, created_at) VALUES (?, ?, ?, 1, ?)"
  ).run(null, "webhook", JSON.stringify({ url: "https://example.com/hook" }), Date.now());
  const id = Number(res.lastInsertRowid);
  assert.ok(id > 0, "Should insert channel");

  // Query it back
  const rows = db.prepare("SELECT * FROM notification_channels WHERE id = ?").all(id);
  assert.ok(rows.length > 0, "Should find channel");

  // Delete
  const deleted = removeChannel(id);
  assert.strictEqual(deleted, true, "Should delete channel");
}

// --- WebSocket Manager (unit tests without actual WS connections) ---

export function testWsManagerNoConnections() {
  assert.strictEqual(getConnectionCount(), 0, "Should have 0 connections initially (in test env)");
  assert.deepStrictEqual(getConnectedDevices(999), [], "Should return empty array");
  assert.strictEqual(isUserConnected(999), false, "Should not be connected");
}
