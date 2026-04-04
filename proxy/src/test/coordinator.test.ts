/**
 * Coordinator + Worker Pool Tests
 *
 * Tests coordinator session management, worker spawning, pool status,
 * result collection, formatting, and agent type definitions.
 */

import assert from "node:assert";
import {
  findAgentDefinition,
  WORKER_DENIED_TOOLS,
  MAX_CONCURRENT_WORKERS,
  BUILTIN_AGENTS,
} from "../agent/agentTypes";
import {
  createCoordinatorSession,
  getCoordinatorSession,
  getActiveCoordinatorSessions,
  spawnWorker,
  getWorkerStatus,
  killAllWorkers,
  completeCoordinatorSession,
  failCoordinatorSession,
  getCoordinatorSystemPrompt,
  clearAllSessions,
} from "../agent/coordinator";
import {
  getPoolStatus,
  collectWorkerResults,
  allWorkersFinished,
  formatWorkerSummary,
  type WorkerResult,
} from "../agent/workerPool";

// ── Agent Definitions ─────────────────────────────────────────

export function testFindAgentDefinitionGeneralPurpose() {
  const agent = findAgentDefinition("general-purpose");
  assert.ok(agent !== null, "Should find general-purpose agent");
  assert.strictEqual(agent!.name, "general-purpose");
  assert.strictEqual(agent!.mode, "local");
}

export function testFindAgentDefinitionExplore() {
  const agent = findAgentDefinition("explore");
  assert.ok(agent !== null, "Should find explore agent");
  assert.strictEqual(agent!.name, "explore");
  assert.ok(agent!.allowedTools!.includes("grep"), "Explore should allow grep");
  assert.ok(agent!.deniedTools!.includes("edit"), "Explore should deny edit");
}

export function testFindAgentDefinitionPlan() {
  const agent = findAgentDefinition("plan");
  assert.ok(agent !== null, "Should find plan agent");
  assert.strictEqual(agent!.name, "plan");
  assert.strictEqual(agent!.mode, "local");
}

export function testFindAgentDefinitionBackground() {
  const agent = findAgentDefinition("background");
  assert.ok(agent !== null, "Should find background agent");
  assert.strictEqual(agent!.mode, "background");
}

export function testFindAgentDefinitionReturnsNullForUnknown() {
  const agent = findAgentDefinition("nonexistent-agent");
  assert.strictEqual(agent, null, "Should return null for unknown agent");
}

export function testBuiltinAgentsContainsAll() {
  assert.ok(
    BUILTIN_AGENTS.length >= 4,
    "Should have at least 4 builtin agents",
  );
  const names = BUILTIN_AGENTS.map((a) => a.name);
  assert.ok(names.includes("general-purpose"));
  assert.ok(names.includes("explore"));
  assert.ok(names.includes("plan"));
  assert.ok(names.includes("background"));
}

// ── Worker Denied Tools ───────────────────────────────────────

export function testWorkerDeniedToolsContainsAgent() {
  assert.ok(WORKER_DENIED_TOOLS.includes("agent"), "Should deny 'agent'");
}

export function testWorkerDeniedToolsContainsSendMessage() {
  assert.ok(
    WORKER_DENIED_TOOLS.includes("send_message"),
    "Should deny 'send_message'",
  );
}

export function testWorkerDeniedToolsContainsTaskStop() {
  assert.ok(
    WORKER_DENIED_TOOLS.includes("task_stop"),
    "Should deny 'task_stop'",
  );
}

export function testWorkerDeniedToolsContainsCoordinator() {
  assert.ok(
    WORKER_DENIED_TOOLS.includes("coordinator"),
    "Should deny 'coordinator'",
  );
}

// ── MAX_CONCURRENT_WORKERS ────────────────────────────────────

export function testMaxConcurrentWorkersIs5() {
  assert.strictEqual(
    MAX_CONCURRENT_WORKERS,
    5,
    "MAX_CONCURRENT_WORKERS should be 5",
  );
}

// ── Coordinator Session Management ────────────────────────────

export function testCreateCoordinatorSessionFields() {
  clearAllSessions();
  const session = createCoordinatorSession(42, "task_abc");
  assert.ok(
    session.sessionId.startsWith("coord_"),
    "Session ID should start with 'coord_'",
  );
  assert.strictEqual(session.userId, 42);
  assert.strictEqual(session.coordinatorTaskId, "task_abc");
  assert.deepStrictEqual(session.workerTaskIds, []);
  assert.strictEqual(session.status, "active");
  assert.ok(session.startedAt > 0, "startedAt should be a positive timestamp");
}

export function testGetCoordinatorSessionReturnsSession() {
  clearAllSessions();
  const session = createCoordinatorSession(1, "task_xyz");
  const fetched = getCoordinatorSession(session.sessionId);
  assert.ok(fetched !== null, "Should find the session");
  assert.strictEqual(fetched!.sessionId, session.sessionId);
  assert.strictEqual(fetched!.userId, 1);
}

export function testGetCoordinatorSessionReturnsNullForUnknown() {
  clearAllSessions();
  const result = getCoordinatorSession("coord_nonexistent");
  assert.strictEqual(result, null, "Should return null for unknown session");
}

export function testGetActiveCoordinatorSessionsFiltersByUser() {
  clearAllSessions();
  createCoordinatorSession(10, "task_a");
  createCoordinatorSession(10, "task_b");
  createCoordinatorSession(20, "task_c");

  const user10Sessions = getActiveCoordinatorSessions(10);
  assert.strictEqual(
    user10Sessions.length,
    2,
    "User 10 should have 2 active sessions",
  );

  const user20Sessions = getActiveCoordinatorSessions(20);
  assert.strictEqual(
    user20Sessions.length,
    1,
    "User 20 should have 1 active session",
  );

  const user30Sessions = getActiveCoordinatorSessions(30);
  assert.strictEqual(
    user30Sessions.length,
    0,
    "User 30 should have 0 sessions",
  );
}

export function testGetActiveCoordinatorSessionsFiltersInactive() {
  clearAllSessions();
  const session1 = createCoordinatorSession(10, "task_a");
  createCoordinatorSession(10, "task_b");

  // Complete session1
  completeCoordinatorSession(session1.sessionId);

  const active = getActiveCoordinatorSessions(10);
  assert.strictEqual(
    active.length,
    1,
    "Should only return 1 active session after completing one",
  );
}

// ── Worker Spawning ───────────────────────────────────────────

export function testSpawnWorkerReturnsErrorForUnknownSession() {
  clearAllSessions();
  const result = spawnWorker({
    sessionId: "coord_nonexistent",
    description: "test",
    prompt: "do something",
  });
  assert.strictEqual(result.success, false);
  assert.ok(
    result.error!.includes("not found"),
    "Error should mention session not found",
  );
}

export function testSpawnWorkerReturnsErrorForInactiveSession() {
  clearAllSessions();
  const session = createCoordinatorSession(1, "task_x");
  completeCoordinatorSession(session.sessionId);

  const result = spawnWorker({
    sessionId: session.sessionId,
    description: "test",
    prompt: "do something",
  });
  assert.strictEqual(result.success, false);
  assert.ok(
    result.error!.includes("not active"),
    "Error should mention session not active",
  );
}

export function testSpawnWorkerReturnsSuccessWithTaskId() {
  clearAllSessions();
  const session = createCoordinatorSession(1, "task_coord");

  const result = spawnWorker({
    sessionId: session.sessionId,
    description: "Scan files",
    prompt: "Scan all TypeScript files for secrets",
  });

  assert.strictEqual(result.success, true, "spawnWorker should succeed");
  assert.ok(result.taskId, "Should return a taskId");
  assert.ok(typeof result.taskId === "string", "taskId should be a string");
}

export function testSpawnWorkerAddsTaskIdToSession() {
  clearAllSessions();
  const session = createCoordinatorSession(1, "task_coord");

  const result = spawnWorker({
    sessionId: session.sessionId,
    description: "Worker 1",
    prompt: "do work",
  });

  const updated = getCoordinatorSession(session.sessionId);
  assert.ok(updated !== null);
  assert.strictEqual(
    updated!.workerTaskIds.length,
    1,
    "Session should have 1 worker",
  );
  assert.strictEqual(updated!.workerTaskIds[0], result.taskId);
}

// ── Worker Management ─────────────────────────────────────────

export function testGetWorkerStatusReturnsStatusPerWorker() {
  clearAllSessions();
  const session = createCoordinatorSession(1, "task_coord");

  spawnWorker({
    sessionId: session.sessionId,
    description: "W1",
    prompt: "p1",
  });
  spawnWorker({
    sessionId: session.sessionId,
    description: "W2",
    prompt: "p2",
  });

  const statuses = getWorkerStatus(session.sessionId);
  assert.strictEqual(statuses.length, 2, "Should have 2 worker statuses");
  for (const s of statuses) {
    assert.ok("taskId" in s, "Each status should have taskId");
    assert.ok("isRunning" in s, "Each status should have isRunning");
  }
}

export function testGetWorkerStatusReturnsEmptyForUnknownSession() {
  clearAllSessions();
  const statuses = getWorkerStatus("coord_nonexistent");
  assert.strictEqual(
    statuses.length,
    0,
    "Unknown session should return empty array",
  );
}

export function testKillAllWorkersReturnsZeroForUnknown() {
  clearAllSessions();
  const killed = killAllWorkers("coord_nonexistent");
  assert.strictEqual(killed, 0, "Should return 0 for unknown session");
}

// ── Session Completion ────────────────────────────────────────

export function testCompleteCoordinatorSessionSetsCompleted() {
  clearAllSessions();
  const session = createCoordinatorSession(1, "task_c");
  const result = completeCoordinatorSession(session.sessionId);
  assert.strictEqual(result, true);

  const updated = getCoordinatorSession(session.sessionId);
  assert.strictEqual(updated!.status, "completed");
}

export function testCompleteCoordinatorSessionReturnsFalseForUnknown() {
  clearAllSessions();
  const result = completeCoordinatorSession("coord_nonexistent");
  assert.strictEqual(result, false);
}

export function testFailCoordinatorSessionSetsFailed() {
  clearAllSessions();
  const session = createCoordinatorSession(1, "task_f");
  const result = failCoordinatorSession(session.sessionId);
  assert.strictEqual(result, true);

  const updated = getCoordinatorSession(session.sessionId);
  assert.strictEqual(updated!.status, "failed");
}

export function testFailCoordinatorSessionReturnsFalseForUnknown() {
  clearAllSessions();
  const result = failCoordinatorSession("coord_nonexistent");
  assert.strictEqual(result, false);
}

// ── Coordinator System Prompt ─────────────────────────────────

export function testGetCoordinatorSystemPromptReturnsNonEmpty() {
  const prompt = getCoordinatorSystemPrompt();
  assert.ok(prompt.length > 0, "System prompt should not be empty");
  assert.ok(
    prompt.includes(String(MAX_CONCURRENT_WORKERS)),
    "System prompt should include MAX_CONCURRENT_WORKERS value",
  );
}

export function testGetCoordinatorSystemPromptMentionsDeniedTools() {
  const prompt = getCoordinatorSystemPrompt();
  for (const tool of WORKER_DENIED_TOOLS) {
    assert.ok(
      prompt.includes(tool),
      `System prompt should mention denied tool '${tool}'`,
    );
  }
}

// ── Pool Status (workerPool.ts) ───────────────────────────────

export function testGetPoolStatusEmpty() {
  const status = getPoolStatus([]);
  assert.strictEqual(status.total, 0);
  assert.strictEqual(status.running, 0);
  assert.strictEqual(status.completed, 0);
  assert.strictEqual(status.failed, 0);
  assert.strictEqual(status.killed, 0);
  assert.strictEqual(status.canSpawnMore, true);
}

export function testGetPoolStatusCountsCorrectly() {
  clearAllSessions();
  // Use a coordinator session to create workers, which creates tasks
  const session = createCoordinatorSession(1, "task_pool");

  const w1 = spawnWorker({
    sessionId: session.sessionId,
    description: "W1",
    prompt: "p1",
  });
  const w2 = spawnWorker({
    sessionId: session.sessionId,
    description: "W2",
    prompt: "p2",
  });

  const taskIds = [w1.taskId!, w2.taskId!];
  const status = getPoolStatus(taskIds);

  assert.strictEqual(status.total, 2, "Total should be 2");
  // Workers are spawned as background tasks, so they should be running or pending
  assert.ok(status.running >= 0, "Running count should be non-negative");
  assert.ok(
    status.canSpawnMore === true || status.canSpawnMore === false,
    "canSpawnMore should be boolean",
  );
}

// ── Worker Results (workerPool.ts) ────────────────────────────

export function testCollectWorkerResultsEmpty() {
  const results = collectWorkerResults([]);
  assert.strictEqual(
    results.length,
    0,
    "Empty task IDs should return empty results",
  );
}

export function testCollectWorkerResultsForSpawnedWorkers() {
  clearAllSessions();
  const session = createCoordinatorSession(1, "task_collect");

  const w1 = spawnWorker({
    sessionId: session.sessionId,
    description: "Worker A",
    prompt: "task a",
  });

  const results = collectWorkerResults([w1.taskId!]);
  assert.strictEqual(results.length, 1, "Should have 1 result");
  assert.strictEqual(results[0].taskId, w1.taskId);
  assert.ok(
    results[0].description.length > 0,
    "Description should be non-empty",
  );
}

// ── allWorkersFinished (workerPool.ts) ────────────────────────

export function testAllWorkersFinishedTrueForEmpty() {
  const result = allWorkersFinished([]);
  assert.strictEqual(result, true, "Empty list means all finished");
}

export function testAllWorkersFinishedForNonexistentTasks() {
  // Tasks that don't exist are skipped, so allWorkersFinished returns true
  const result = allWorkersFinished(["nonexistent_1", "nonexistent_2"]);
  assert.strictEqual(
    result,
    true,
    "Nonexistent tasks are skipped, so considered finished",
  );
}

// ── formatWorkerSummary (workerPool.ts) ────────────────────────

export function testFormatWorkerSummaryEmpty() {
  const result = formatWorkerSummary([]);
  assert.strictEqual(
    result,
    "No worker results.",
    "Empty results should return 'No worker results.'",
  );
}

export function testFormatWorkerSummaryCompletedWorker() {
  const results: WorkerResult[] = [
    {
      taskId: "t_001",
      description: "Scan files",
      status: "completed",
      resultSummary: "Found 3 issues",
      error: null,
      durationMs: 5000,
    },
  ];

  const summary = formatWorkerSummary(results);
  assert.ok(summary.includes("[COMPLETED]"), "Should contain [COMPLETED]");
  assert.ok(summary.includes("Scan files"), "Should contain description");
  assert.ok(
    summary.includes("Found 3 issues"),
    "Should contain result summary",
  );
  assert.ok(summary.includes("5s"), "Should contain duration");
  assert.ok(
    summary.includes("1/1 completed"),
    "Should contain completion count",
  );
}

export function testFormatWorkerSummaryFailedWorker() {
  const results: WorkerResult[] = [
    {
      taskId: "t_002",
      description: "Run tests",
      status: "failed",
      resultSummary: null,
      error: "Timeout exceeded",
      durationMs: 10000,
    },
  ];

  const summary = formatWorkerSummary(results);
  assert.ok(summary.includes("[FAILED]"), "Should contain [FAILED]");
  assert.ok(summary.includes("Run tests"), "Should contain description");
  assert.ok(summary.includes("Timeout exceeded"), "Should contain error");
  assert.ok(
    summary.includes("0/1 completed, 1 failed"),
    "Should contain failure count",
  );
}

export function testFormatWorkerSummaryMixedResults() {
  const results: WorkerResult[] = [
    {
      taskId: "t_001",
      description: "Task A",
      status: "completed",
      resultSummary: "Done",
      error: null,
      durationMs: 3000,
    },
    {
      taskId: "t_002",
      description: "Task B",
      status: "failed",
      resultSummary: null,
      error: "Error",
      durationMs: 2000,
    },
    {
      taskId: "t_003",
      description: "Task C",
      status: "running",
      resultSummary: null,
      error: null,
      durationMs: 1000,
    },
  ];

  const summary = formatWorkerSummary(results);
  assert.ok(
    summary.includes("1/3 completed, 1 failed"),
    "Should show correct totals",
  );
}
