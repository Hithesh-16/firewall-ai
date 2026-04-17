/**
 * Tests for Phase I.I3 — async subagent state channel.
 */

import assert from "node:assert";
import {
  cancelAsyncTask,
  checkAsyncTask,
  listAsyncTasks,
  startAsyncTask,
  updateAsyncTask,
} from "../services/asyncTaskService";

let counter = 0;
function uniqueSession(): string {
  counter += 1;
  return `test-session-${Date.now()}-${counter}`;
}

// ── Start ───────────────────────────────────────────────────────

export function testStartCreatesTask() {
  const session = uniqueSession();
  const task = startAsyncTask({
    parentSession: session,
    name: "researcher",
    prompt: "find all uses of scanSecrets",
  });
  assert.ok(task.id.startsWith("async_"));
  assert.strictEqual(task.parentSession, session);
  assert.strictEqual(task.name, "researcher");
  assert.strictEqual(task.status, "pending");
  assert.strictEqual(task.progress, 0);
  assert.ok(task.createdAt > 0);
}

// ── Check ───────────────────────────────────────────────────────

export function testCheckUpdatesLastCheckedAt() {
  const session = uniqueSession();
  const task = startAsyncTask({
    parentSession: session,
    prompt: "do something",
  });
  const before = Date.now();
  const checked = checkAsyncTask(task.id);
  assert.ok(checked);
  assert.ok(checked!.lastCheckedAt! >= before);
}

export function testCheckNonexistentReturnsNull() {
  assert.strictEqual(checkAsyncTask("nonexistent-id"), null);
}

// ── Update ──────────────────────────────────────────────────────

export function testUpdateProgress() {
  const session = uniqueSession();
  const task = startAsyncTask({
    parentSession: session,
    prompt: "do something",
  });
  const updated = updateAsyncTask(task.id, {
    status: "running",
    progress: 50,
  });
  assert.ok(updated);
  assert.strictEqual(updated!.status, "running");
  assert.strictEqual(updated!.progress, 50);
  assert.ok(updated!.startedAt, "startedAt should be set on first running");
}

export function testUpdateCompleted() {
  const session = uniqueSession();
  const task = startAsyncTask({
    parentSession: session,
    prompt: "do something",
  });
  updateAsyncTask(task.id, { status: "running" });
  const completed = updateAsyncTask(task.id, {
    status: "completed",
    resultJson: '{"answer": 42}',
  });
  assert.ok(completed);
  assert.strictEqual(completed!.status, "completed");
  assert.strictEqual(completed!.resultJson, '{"answer": 42}');
  assert.ok(completed!.completedAt, "completedAt should be set");
}

export function testUpdateNonexistentReturnsNull() {
  assert.strictEqual(updateAsyncTask("nonexistent", { progress: 10 }), null);
}

// ── Cancel ──────────────────────────────────────────────────────

export function testCancelPendingTask() {
  const session = uniqueSession();
  const task = startAsyncTask({
    parentSession: session,
    prompt: "do something",
  });
  assert.strictEqual(cancelAsyncTask(task.id), true);
  const after = checkAsyncTask(task.id);
  assert.ok(after);
  assert.strictEqual(after!.status, "cancelled");
}

export function testCancelCompletedTaskReturnsFalse() {
  const session = uniqueSession();
  const task = startAsyncTask({
    parentSession: session,
    prompt: "do something",
  });
  updateAsyncTask(task.id, { status: "completed" });
  assert.strictEqual(cancelAsyncTask(task.id), false);
}

export function testCancelNonexistentReturnsFalse() {
  assert.strictEqual(cancelAsyncTask("nonexistent"), false);
}

// ── List ────────────────────────────────────────────────────────

export function testListTasksForSession() {
  const session = uniqueSession();
  startAsyncTask({ parentSession: session, prompt: "task 1" });
  startAsyncTask({ parentSession: session, prompt: "task 2" });
  startAsyncTask({
    parentSession: uniqueSession(),
    prompt: "other session",
  });
  const tasks = listAsyncTasks(session);
  assert.strictEqual(tasks.length, 2);
  assert.ok(tasks.every((t) => t.parentSession === session));
}

export function testListEmptySessionReturnsEmpty() {
  assert.deepStrictEqual(listAsyncTasks(uniqueSession()), []);
}

// ── Persistence ─────────────────────────────────────────────────

export function testTaskSurvivesReRead() {
  const session = uniqueSession();
  const task = startAsyncTask({
    parentSession: session,
    name: "persistent",
    prompt: "should survive",
    model: "openai:gpt-4o",
  });
  // Re-read from DB.
  const fromDb = checkAsyncTask(task.id);
  assert.ok(fromDb);
  assert.strictEqual(fromDb!.name, "persistent");
  assert.strictEqual(fromDb!.model, "openai:gpt-4o");
  assert.strictEqual(fromDb!.prompt, "should survive");
}
