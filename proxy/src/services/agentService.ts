/**
 * Agent Service
 *
 * Manages sub-agent lifecycle: spawn, kill, status, worktree isolation.
 * Agents are tracked as tasks (type "local_agent" or "background_agent")
 * in the tasks table. This service adds agent-specific concerns:
 *
 *   - Worktree creation/cleanup (git worktree for isolated execution)
 *   - Agent registry (in-memory map of running agents + abort controllers)
 *   - Parent/child tracking (coordinator spawns workers)
 *   - Background mode (auto-background after timeout)
 *   - WebSocket notifications for progress/completion
 *
 * SECURITY: Every agent prompt MUST go through the proxy's preflight scan.
 * This service does NOT bypass any firewall layer. Callers are responsible
 * for scanning agent prompts via /api/scan before invoking spawnAgent().
 */

import { execSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import {
  createTask,
  getTaskById,
  startTask,
  completeTask,
  failTask,
  killTask,
  updateTaskProgress,
  getActiveTasks,
  type CreateTaskInput,
} from "../tasks/taskFramework";
import { broadcast } from "../ws/wsManager";
import type { TaskStateBase, TaskProgress } from "../tasks/taskTypes";
import type { WsEvent } from "../types";

// ── Types ──────────────────────────────────────────────────────

export interface SpawnAgentInput {
  readonly description: string;
  readonly prompt: string;
  readonly userId: number | null;
  readonly model?: string;
  readonly parentTaskId?: string;
  readonly background?: boolean;
  readonly isolation?: "worktree" | "none";
  readonly worktreeSlug?: string;
  readonly cwd?: string;
}

export interface AgentHandle {
  readonly taskId: string;
  readonly agentId: string;
  readonly worktreePath: string | null;
  readonly worktreeBranch: string | null;
  readonly background: boolean;
  readonly abortController: AbortController;
}

export interface AgentResult {
  readonly taskId: string;
  readonly status: "completed" | "failed" | "killed";
  readonly resultSummary: string | null;
  readonly error: string | null;
  readonly worktreePath: string | null;
  readonly worktreeBranch: string | null;
}

// ── In-memory agent registry ───────────────────────────────────

const runningAgents = new Map<string, AgentHandle>();

export function getRunningAgent(taskId: string): AgentHandle | null {
  return runningAgents.get(taskId) ?? null;
}

export function getRunningAgentCount(): number {
  return runningAgents.size;
}

export function getAllRunningAgents(): AgentHandle[] {
  return Array.from(runningAgents.values());
}

// ── Spawn ──────────────────────────────────────────────────────

export function spawnAgent(input: SpawnAgentInput): AgentHandle {
  const agentId = crypto.randomUUID();
  const isBackground = input.background ?? false;
  const taskType = isBackground
    ? ("background_agent" as const)
    : ("local_agent" as const);

  // Create worktree if isolation requested
  let worktreePath: string | null = null;
  let worktreeBranch: string | null = null;

  if (input.isolation === "worktree") {
    const result = createWorktree(
      input.cwd ?? process.cwd(),
      input.worktreeSlug,
    );
    worktreePath = result.worktreePath;
    worktreeBranch = result.branch;
  }

  // Create task in DB
  const taskInput: CreateTaskInput = {
    type: taskType,
    description: input.description,
    userId: input.userId,
    parentTaskId: input.parentTaskId ?? null,
    model: input.model ?? null,
    prompt: input.prompt,
    worktreePath,
  };

  const task = createTask(taskInput);

  // Start the task immediately
  startTask(task.id, agentId);

  // Register in memory
  const handle: AgentHandle = {
    taskId: task.id,
    agentId,
    worktreePath,
    worktreeBranch,
    background: isBackground,
    abortController: new AbortController(),
  };

  runningAgents.set(task.id, handle);

  return handle;
}

// ── Complete / Fail / Kill ─────────────────────────────────────

export function completeAgent(
  taskId: string,
  resultSummary?: string,
): AgentResult | null {
  const handle = runningAgents.get(taskId);
  if (!handle) return null;

  completeTask(taskId, resultSummary);
  runningAgents.delete(taskId);

  return {
    taskId,
    status: "completed",
    resultSummary: resultSummary ?? null,
    error: null,
    worktreePath: handle.worktreePath,
    worktreeBranch: handle.worktreeBranch,
  };
}

export function failAgent(taskId: string, error: string): AgentResult | null {
  const handle = runningAgents.get(taskId);
  if (!handle) return null;

  handle.abortController.abort();
  failTask(taskId, error);
  runningAgents.delete(taskId);

  return {
    taskId,
    status: "failed",
    resultSummary: null,
    error,
    worktreePath: handle.worktreePath,
    worktreeBranch: handle.worktreeBranch,
  };
}

export function killAgent(taskId: string): AgentResult | null {
  const handle = runningAgents.get(taskId);
  if (!handle) {
    // Try killing via task framework directly (agent may not be in memory)
    const killed = killTask(taskId);
    if (!killed) return null;
    const task = getTaskById(taskId);
    return {
      taskId,
      status: "killed",
      resultSummary: null,
      error: null,
      worktreePath: task?.worktreePath ?? null,
      worktreeBranch: null,
    };
  }

  handle.abortController.abort();
  killTask(taskId);
  runningAgents.delete(taskId);

  // Clean up worktree if it was created
  if (handle.worktreePath) {
    cleanupWorktree(handle.worktreePath);
  }

  return {
    taskId,
    status: "killed",
    resultSummary: null,
    error: null,
    worktreePath: handle.worktreePath,
    worktreeBranch: handle.worktreeBranch,
  };
}

export function killAllAgents(userId: number): number {
  const active = getActiveTasks(userId);
  let killed = 0;

  for (const task of active) {
    if (task.type === "local_agent" || task.type === "background_agent") {
      if (killAgent(task.id)) killed++;
    }
  }

  return killed;
}

// ── Progress ───────────────────────────────────────────────────

export function reportAgentProgress(
  taskId: string,
  progress: TaskProgress,
): boolean {
  const handle = runningAgents.get(taskId);
  if (!handle) return false;

  return updateTaskProgress(taskId, progress);
}

// ── Send message to running agent ──────────────────────────────

export function sendMessageToAgent(taskId: string, message: string): boolean {
  const handle = runningAgents.get(taskId);
  if (!handle) return false;

  // Broadcast the message as an event — the agent's execution loop
  // should be listening for these via WebSocket or in-process queue
  if (handle.background) {
    const task = getTaskById(taskId);
    const event: WsEvent = {
      type: "task_event" as any,
      payload: {
        eventType: "agent_message",
        taskId,
        message,
      },
      timestamp: Date.now(),
    };
    broadcast(task?.userId ?? 0, event);
  }

  return true;
}

// ── Worktree management ────────────────────────────────────────

const WORKTREE_BASE = ".ai-firewall/worktrees";

interface WorktreeResult {
  readonly worktreePath: string;
  readonly branch: string;
}

function createWorktree(repoRoot: string, slug?: string): WorktreeResult {
  const safeName = (slug ?? crypto.randomBytes(4).toString("hex"))
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .slice(0, 64);

  const sessionId = crypto.randomBytes(4).toString("hex");
  const worktreeDir = path.join(repoRoot, WORKTREE_BASE, sessionId, safeName);
  const branch = `agent/${sessionId}/${safeName}`;

  fs.mkdirSync(path.dirname(worktreeDir), { recursive: true });

  try {
    // Create a new branch from HEAD and set up worktree
    execSync(`git worktree add -b "${branch}" "${worktreeDir}" HEAD`, {
      cwd: repoRoot,
      stdio: "pipe",
      timeout: 30_000,
    });
  } catch (error: unknown) {
    // If branch already exists, try without -b
    try {
      execSync(`git worktree add "${worktreeDir}" HEAD`, {
        cwd: repoRoot,
        stdio: "pipe",
        timeout: 30_000,
      });
    } catch (innerError: unknown) {
      const msg =
        innerError instanceof Error ? innerError.message : String(innerError);
      throw new Error(`Failed to create worktree: ${msg}`);
    }
  }

  return { worktreePath: worktreeDir, branch };
}

function cleanupWorktree(worktreePath: string): void {
  try {
    // Check if worktree has uncommitted changes
    const status = execSync("git status --porcelain", {
      cwd: worktreePath,
      stdio: "pipe",
      timeout: 10_000,
    })
      .toString()
      .trim();

    if (status.length === 0) {
      // No changes — safe to remove
      execSync(`git worktree remove "${worktreePath}" --force`, {
        stdio: "pipe",
        timeout: 30_000,
      });
    }
    // If there are changes, leave the worktree for the user to review
  } catch {
    // Worktree may already be removed or path invalid — ignore
  }
}

// ── Get agent status ───────────────────────────────────────────

export function getAgentStatus(taskId: string): {
  task: TaskStateBase | null;
  isRunning: boolean;
  hasWorktree: boolean;
} {
  const task = getTaskById(taskId);
  const handle = runningAgents.get(taskId);

  return {
    task,
    isRunning: handle !== null && handle !== undefined,
    hasWorktree: (handle?.worktreePath ?? task?.worktreePath) !== null,
  };
}
