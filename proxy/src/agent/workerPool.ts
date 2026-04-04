/**
 * Worker Pool
 *
 * Manages a pool of worker agents for coordinator mode.
 * Handles concurrency limits, auto-backgrounding, and result collection.
 */

import { getRunningAgent, type AgentHandle } from "../services/agentService";
import { getTaskById } from "../tasks/taskFramework";
import type { TaskStateBase } from "../tasks/taskTypes";
import { AUTO_BACKGROUND_MS, MAX_CONCURRENT_WORKERS } from "./agentTypes";

// ── Types ──────────────────────────────────────────────────────

export interface WorkerResult {
  readonly taskId: string;
  readonly description: string;
  readonly status: "completed" | "failed" | "killed" | "running" | "pending";
  readonly resultSummary: string | null;
  readonly error: string | null;
  readonly durationMs: number;
}

export interface PoolStatus {
  readonly total: number;
  readonly running: number;
  readonly completed: number;
  readonly failed: number;
  readonly killed: number;
  readonly canSpawnMore: boolean;
}

// ── Pool operations ────────────────────────────────────────────

/**
 * Get the status of all workers in a task ID list.
 */
export function getPoolStatus(workerTaskIds: readonly string[]): PoolStatus {
  let running = 0;
  let completed = 0;
  let failed = 0;
  let killed = 0;

  for (const taskId of workerTaskIds) {
    const task = getTaskById(taskId);
    if (!task) continue;

    switch (task.status) {
      case "pending":
      case "running":
        running++;
        break;
      case "completed":
        completed++;
        break;
      case "failed":
        failed++;
        break;
      case "killed":
      case "expired":
        killed++;
        break;
    }
  }

  return {
    total: workerTaskIds.length,
    running,
    completed,
    failed,
    killed,
    canSpawnMore: running < MAX_CONCURRENT_WORKERS,
  };
}

/**
 * Collect results from all workers (completed or failed).
 */
export function collectWorkerResults(
  workerTaskIds: readonly string[],
): WorkerResult[] {
  const results: WorkerResult[] = [];

  for (const taskId of workerTaskIds) {
    const task = getTaskById(taskId);
    if (!task) continue;

    results.push({
      taskId,
      description: task.description,
      status: task.status as WorkerResult["status"],
      resultSummary: task.resultSummary,
      error: task.error,
      durationMs: task.completedAt
        ? task.completedAt - task.startedAt
        : Date.now() - task.startedAt,
    });
  }

  return results;
}

/**
 * Check if all workers have finished (completed, failed, or killed).
 */
export function allWorkersFinished(workerTaskIds: readonly string[]): boolean {
  for (const taskId of workerTaskIds) {
    const task = getTaskById(taskId);
    if (!task) continue;
    if (task.status === "pending" || task.status === "running") return false;
  }
  return true;
}

/**
 * Wait for all workers to finish, polling at the given interval.
 * Returns results once all workers are done or timeout is reached.
 */
export async function waitForWorkers(
  workerTaskIds: readonly string[],
  timeoutMs = 300_000,
  pollIntervalMs = 1_000,
): Promise<WorkerResult[]> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (allWorkersFinished(workerTaskIds)) {
      return collectWorkerResults(workerTaskIds);
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  // Timeout — return whatever we have
  return collectWorkerResults(workerTaskIds);
}

/**
 * Format worker results into a human-readable summary.
 */
export function formatWorkerSummary(results: readonly WorkerResult[]): string {
  if (results.length === 0) return "No worker results.";

  const lines: string[] = [];

  for (const r of results) {
    const status = r.status.toUpperCase();
    const duration = `${Math.round(r.durationMs / 1000)}s`;

    if (r.status === "completed" && r.resultSummary) {
      lines.push(
        `[${status}] ${r.description} (${duration})\n  ${r.resultSummary}`,
      );
    } else if (r.status === "failed" && r.error) {
      lines.push(
        `[${status}] ${r.description} (${duration})\n  Error: ${r.error}`,
      );
    } else {
      lines.push(`[${status}] ${r.description} (${duration})`);
    }
  }

  const completed = results.filter((r) => r.status === "completed").length;
  const failed = results.filter((r) => r.status === "failed").length;
  const summary = `\n--- ${completed}/${results.length} completed, ${failed} failed ---`;

  return lines.join("\n\n") + summary;
}
