/**
 * Local Agent Task Lifecycle
 *
 * Convenience wrappers for creating and managing "local_agent" tasks
 * through the task framework state machine.
 */

import type { TaskStateBase } from "./taskTypes";
import {
  createTask,
  startTask,
  completeTask,
  failTask,
  type CreateTaskInput,
} from "./taskFramework";

/**
 * Create a new local_agent task in "pending" state.
 */
export function createLocalAgentTask(
  description: string,
  userId: number | null,
  parentTaskId?: string,
): TaskStateBase {
  const input: CreateTaskInput = {
    type: "local_agent",
    description,
    userId,
    parentTaskId: parentTaskId ?? null,
  };
  return createTask(input);
}

/**
 * Transition a local_agent task from "pending" to "running".
 */
export function startLocalAgentTask(taskId: string, agentId: string): boolean {
  return startTask(taskId, agentId);
}

/**
 * Transition a local_agent task to "completed" with an optional summary.
 */
export function completeLocalAgentTask(
  taskId: string,
  summary?: string,
): boolean {
  return completeTask(taskId, summary);
}

/**
 * Transition a local_agent task to "failed" with an error message.
 */
export function failLocalAgentTask(taskId: string, error: string): boolean {
  return failTask(taskId, error);
}
