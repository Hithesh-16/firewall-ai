/**
 * Coordinator Mode
 *
 * Multi-agent orchestration: a coordinator agent spawns worker agents
 * that execute tasks in parallel, then aggregates results.
 *
 * Flow:
 *   1. User request → coordinator receives task
 *   2. Coordinator decomposes into work items
 *   3. Each work item → spawnAgent() as worker (via agentService)
 *   4. Workers execute independently (each gets own scan context)
 *   5. Worker results arrive via WebSocket (task_event notifications)
 *   6. Coordinator aggregates and responds to user
 *
 * SECURITY:
 * - Each worker gets an INDEPENDENT scan context (no shared state)
 * - Workers respect rate limits independently
 * - Workers cannot spawn sub-workers (WORKER_DENIED_TOOLS)
 * - Coordinator respects MAX_CONCURRENT_WORKERS limit
 */

import {
  spawnAgent,
  killAgent,
  completeAgent,
  getRunningAgentCount,
  getAllRunningAgents,
  type SpawnAgentInput,
  type AgentHandle,
} from "../services/agentService";
import {
  MAX_CONCURRENT_WORKERS,
  WORKER_DENIED_TOOLS,
  AUTO_BACKGROUND_MS,
  type AgentMode,
} from "./agentTypes";
import { broadcast } from "../ws/wsManager";
import type { WsEvent } from "../types";

// ── Coordinator state ──────────────────────────────────────────

export interface CoordinatorSession {
  readonly sessionId: string;
  readonly userId: number;
  readonly coordinatorTaskId: string;
  readonly workerTaskIds: readonly string[];
  readonly startedAt: number;
  readonly status: "active" | "completed" | "failed";
}

const activeSessions = new Map<string, CoordinatorSession>();

// ── Session management ─────────────────────────────────────────

export function createCoordinatorSession(
  userId: number,
  coordinatorTaskId: string,
): CoordinatorSession {
  const sessionId = `coord_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const session: CoordinatorSession = {
    sessionId,
    userId,
    coordinatorTaskId,
    workerTaskIds: [],
    startedAt: Date.now(),
    status: "active",
  };

  activeSessions.set(sessionId, session);
  return session;
}

export function getCoordinatorSession(
  sessionId: string,
): CoordinatorSession | null {
  return activeSessions.get(sessionId) ?? null;
}

export function getActiveCoordinatorSessions(
  userId: number,
): CoordinatorSession[] {
  return Array.from(activeSessions.values()).filter(
    (s) => s.userId === userId && s.status === "active",
  );
}

// ── Worker spawning ────────────────────────────────────────────

export interface SpawnWorkerInput {
  readonly sessionId: string;
  readonly description: string;
  readonly prompt: string;
  readonly model?: string;
  readonly isolation?: "worktree" | "none";
}

export interface SpawnWorkerResult {
  readonly success: boolean;
  readonly taskId?: string;
  readonly error?: string;
}

export function spawnWorker(input: SpawnWorkerInput): SpawnWorkerResult {
  const session = activeSessions.get(input.sessionId);
  if (!session) {
    return { success: false, error: "Coordinator session not found" };
  }

  if (session.status !== "active") {
    return { success: false, error: "Coordinator session is not active" };
  }

  // Check concurrent worker limit
  const currentWorkers = session.workerTaskIds.length;
  const runningWorkers = session.workerTaskIds.filter((id) => {
    const handle = getAllRunningAgents().find((a) => a.taskId === id);
    return handle !== undefined;
  }).length;

  if (runningWorkers >= MAX_CONCURRENT_WORKERS) {
    return {
      success: false,
      error: `Maximum concurrent workers (${MAX_CONCURRENT_WORKERS}) reached`,
    };
  }

  // Spawn the worker agent
  const agentInput: SpawnAgentInput = {
    description: `[Worker] ${input.description}`,
    prompt: buildWorkerPrompt(input.prompt),
    userId: session.userId,
    model: input.model,
    parentTaskId: session.coordinatorTaskId,
    background: true, // Workers always run in background
    isolation: input.isolation,
  };

  try {
    const handle = spawnAgent(agentInput);

    // Update session with new worker
    const updated: CoordinatorSession = {
      ...session,
      workerTaskIds: [...session.workerTaskIds, handle.taskId],
    };
    activeSessions.set(input.sessionId, updated);

    // Notify coordinator
    const event: WsEvent = {
      type: "task_event" as any,
      payload: {
        eventType: "worker_spawned",
        sessionId: input.sessionId,
        taskId: handle.taskId,
        description: input.description,
      },
      timestamp: Date.now(),
    };
    broadcast(session.userId, event);

    return { success: true, taskId: handle.taskId };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    return { success: false, error: msg };
  }
}

// ── Worker management ──────────────────────────────────────────

export function killAllWorkers(sessionId: string): number {
  const session = activeSessions.get(sessionId);
  if (!session) return 0;

  let killed = 0;
  for (const taskId of session.workerTaskIds) {
    const result = killAgent(taskId);
    if (result) killed++;
  }

  return killed;
}

export function getWorkerStatus(sessionId: string): Array<{
  taskId: string;
  isRunning: boolean;
}> {
  const session = activeSessions.get(sessionId);
  if (!session) return [];

  const running = getAllRunningAgents();

  return session.workerTaskIds.map((taskId) => ({
    taskId,
    isRunning: running.some((r) => r.taskId === taskId),
  }));
}

// ── Session completion ─────────────────────────────────────────

export function completeCoordinatorSession(sessionId: string): boolean {
  const session = activeSessions.get(sessionId);
  if (!session) return false;

  // Kill any remaining workers
  killAllWorkers(sessionId);

  const updated: CoordinatorSession = {
    ...session,
    status: "completed",
  };
  activeSessions.set(sessionId, updated);

  return true;
}

export function failCoordinatorSession(sessionId: string): boolean {
  const session = activeSessions.get(sessionId);
  if (!session) return false;

  killAllWorkers(sessionId);

  const updated: CoordinatorSession = {
    ...session,
    status: "failed",
  };
  activeSessions.set(sessionId, updated);

  return true;
}

// ── Coordinator system prompt ──────────────────────────────────

export function getCoordinatorSystemPrompt(): string {
  return [
    "You are an AI Firewall coordinator. You help the user by delegating work to specialized worker agents.",
    "",
    "Rules:",
    "- Decompose complex tasks into independent work items",
    "- Spawn workers using the Agent tool for each work item",
    "- Workers run in parallel — do NOT wait for one to finish before spawning another",
    "- Worker results arrive as task notifications — summarize them for the user",
    "- If a worker fails, explain why and suggest alternatives",
    "- Do NOT fabricate results — only report what workers actually return",
    "- For simple tasks, do the work yourself instead of spawning a worker",
    `- Maximum ${MAX_CONCURRENT_WORKERS} concurrent workers`,
    "",
    "Worker limitations:",
    `- Workers cannot: ${WORKER_DENIED_TOOLS.join(", ")}`,
    "- Each worker gets its own security scan context",
    "- Workers respect rate limits independently",
  ].join("\n");
}

// ── Worker prompt wrapper ──────────────────────────────────────

function buildWorkerPrompt(userPrompt: string): string {
  return [
    "You are a worker agent executing a specific task assigned by a coordinator.",
    "Complete the task described below. Be thorough but concise.",
    "Report your findings directly — the coordinator will aggregate results.",
    "",
    "--- TASK ---",
    userPrompt,
    "--- END TASK ---",
  ].join("\n");
}

// ── Cleanup ────────────────────────────────────────────────────

export function cleanupStaleSessions(maxAgeMs = 3600_000): number {
  const cutoff = Date.now() - maxAgeMs;
  let cleaned = 0;

  for (const [id, session] of activeSessions) {
    if (session.startedAt < cutoff) {
      killAllWorkers(id);
      activeSessions.delete(id);
      cleaned++;
    }
  }

  return cleaned;
}

export function clearAllSessions(): void {
  for (const [id] of activeSessions) {
    killAllWorkers(id);
  }
  activeSessions.clear();
}
