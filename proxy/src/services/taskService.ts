/**
 * Task Service
 *
 * High-level API consumed by routes and other services.
 * Delegates to taskFramework for state management and DB ops.
 */

import {
  createTask,
  getTaskById,
  getTasksByUser,
  getActiveTasks,
  getTasksByParent,
  startTask,
  completeTask,
  failTask,
  killTask,
  updateTaskProgress,
  markNotified,
  expireStale,
  purgeOldTasks,
  type CreateTaskInput,
} from "../tasks/taskFramework";
import type {
  TaskStateBase,
  TaskProgress,
  TaskStatus,
  TaskType,
} from "../tasks/taskTypes";
import { isTerminal } from "../tasks/taskTypes";

// ── Public API ─────────────────────────────────────────────────

export interface CreateTaskRequest {
  readonly type: TaskType;
  readonly description: string;
  readonly model?: string;
  readonly prompt?: string;
  readonly parentTaskId?: string;
}

export function createUserTask(
  userId: number,
  request: CreateTaskRequest,
): TaskStateBase {
  const input: CreateTaskInput = {
    type: request.type,
    description: request.description,
    userId,
    parentTaskId: request.parentTaskId ?? null,
    model: request.model ?? null,
    prompt: request.prompt ?? null,
  };
  return createTask(input);
}

export function getUserTasks(userId: number, limit?: number): TaskStateBase[] {
  return getTasksByUser(userId, limit);
}

export function getUserActiveTasks(userId: number): TaskStateBase[] {
  return getActiveTasks(userId);
}

export function getTask(taskId: string): TaskStateBase | null {
  return getTaskById(taskId);
}

export function getChildTasks(parentTaskId: string): TaskStateBase[] {
  return getTasksByParent(parentTaskId);
}

export function beginTask(taskId: string, agentId?: string): boolean {
  return startTask(taskId, agentId);
}

export function finishTask(taskId: string, summary?: string): boolean {
  return completeTask(taskId, summary);
}

export function errorTask(taskId: string, error: string): boolean {
  return failTask(taskId, error);
}

export function terminateTask(taskId: string): boolean {
  return killTask(taskId);
}

export function reportProgress(
  taskId: string,
  progress: TaskProgress,
): boolean {
  return updateTaskProgress(taskId, progress);
}

export function acknowledgeTask(taskId: string): boolean {
  return markNotified(taskId);
}

// ── Bulk operations ────────────────────────────────────────────

export function killAllActiveTasks(userId: number): number {
  const active = getActiveTasks(userId);
  let killed = 0;
  for (const task of active) {
    if (killTask(task.id)) killed++;
  }
  return killed;
}

// ── Maintenance (call from cron or startup) ────────────────────

export function runMaintenance(): { expired: number; purged: number } {
  const expired = expireStale();
  const purged = purgeOldTasks();
  return { expired, purged };
}
