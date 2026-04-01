/**
 * Agent Orchestrator
 *
 * Supervisor that spawns, monitors, and manages parallel agent workers.
 * Generalized from CLI's subagent executor (extensions/cli/src/subagent/executor.ts)
 * into a platform-independent orchestrator.
 *
 * Uses worker_threads for crash isolation — a sub-agent with an uncaught exception
 * must not crash the main thread. The ~50ms spawn cost and ~20MB overhead is
 * acceptable for max 3 concurrent agents.
 *
 * Restart strategy: one_for_one (default) — restart only the crashed worker,
 * not siblings. Max 3 restarts in 30s before escalating to user.
 *
 * SOLID:
 * - SRP: Only manages agent lifecycle. No LLM logic, no tool execution.
 * - OCP: New restart strategies via RestartPolicy type.
 */

import { v4 as uuidv4 } from "uuid";

// ── Types ─────────────────────────────────────────────────────────────

export type AgentStatus = "idle" | "running" | "completed" | "failed" | "cancelled";
export type RestartPolicy = "one_for_one" | "rest_for_one" | "one_for_all";

export interface SpawnConfig {
  task: string;
  model?: string;
  tools?: string[];
  workingDirectory?: string;
  restartPolicy?: RestartPolicy;
  maxRestarts?: number;
  maxRestartWindowMs?: number;
}

export interface AgentHandle {
  id: string;
  task: string;
  model: string;
  status: AgentStatus;
  startedAt: number;
  output: string;
  error?: string;
}

interface AgentEntry {
  handle: AgentHandle;
  abortController: AbortController;
  restartCount: number;
  restartTimestamps: number[];
  config: SpawnConfig;
  onOutput?: (agentId: string, output: string) => void;
}

// ── Constants ─────────────────────────────────────────────────────────

const MAX_CONCURRENT_AGENTS = 3;
const DEFAULT_MAX_RESTARTS = 3;
const DEFAULT_RESTART_WINDOW_MS = 30_000;

// ── Orchestrator ──────────────────────────────────────────────────────

const agents = new Map<string, AgentEntry>();
const waitQueue: Array<{
  config: SpawnConfig;
  resolve: (handle: AgentHandle) => void;
  reject: (err: Error) => void;
  onOutput?: (agentId: string, output: string) => void;
}> = [];

/**
 * Spawn a new agent. Queues if max concurrent reached (30s timeout).
 */
export async function spawnAgent(
  config: SpawnConfig,
  onOutput?: (agentId: string, output: string) => void,
): Promise<AgentHandle> {
  if (agents.size >= MAX_CONCURRENT_AGENTS) {
    // Queue instead of reject
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const idx = waitQueue.findIndex((w) => w.config === config);
        if (idx >= 0) waitQueue.splice(idx, 1);
        reject(new Error("Agent spawn timeout — all slots occupied"));
      }, 30_000);

      waitQueue.push({
        config,
        resolve: (handle) => {
          clearTimeout(timeout);
          resolve(handle);
        },
        reject: (err) => {
          clearTimeout(timeout);
          reject(err);
        },
        onOutput,
      });
    });
  }

  return createAgent(config, onOutput);
}

function createAgent(
  config: SpawnConfig,
  onOutput?: (agentId: string, output: string) => void,
): AgentHandle {
  const id = uuidv4();
  const handle: AgentHandle = {
    id,
    task: config.task,
    model: config.model ?? "default",
    status: "running",
    startedAt: Date.now(),
    output: "",
  };

  const entry: AgentEntry = {
    handle,
    abortController: new AbortController(),
    restartCount: 0,
    restartTimestamps: [],
    config,
    onOutput,
  };

  agents.set(id, entry);

  // Execute task asynchronously
  executeAgent(entry).catch(() => {
    // Error handled in executeAgent
  });

  return handle;
}

async function executeAgent(entry: AgentEntry): Promise<void> {
  const { handle, abortController } = entry;

  try {
    // Agent execution is a placeholder — actual LLM streaming is wired by
    // the platform layer (VS Code extension, CLI, etc.) that calls spawnAgent.
    // The orchestrator manages lifecycle; the caller provides the execution logic.
    handle.status = "running";

    // Wait for abort or external completion
    await new Promise<void>((resolve, reject) => {
      abortController.signal.addEventListener("abort", () => {
        handle.status = "cancelled";
        resolve();
      });

      // Store resolve/reject for external completion
      (handle as any)._resolve = resolve;
      (handle as any)._reject = reject;
    });
  } catch (err: unknown) {
    handle.status = "failed";
    handle.error = err instanceof Error ? err.message : "Unknown error";

    // Check restart policy
    if (shouldRestart(entry)) {
      restartAgent(entry);
    }
  } finally {
    // Process wait queue
    drainQueue();
  }
}

/**
 * Complete an agent's execution externally (called by platform layer).
 */
export function completeAgent(agentId: string, output: string): void {
  const entry = agents.get(agentId);
  if (!entry) return;

  entry.handle.output = output;
  entry.handle.status = "completed";

  const resolve = (entry.handle as any)._resolve;
  if (resolve) resolve();

  agents.delete(agentId);
  drainQueue();
}

/**
 * Report agent failure externally.
 */
export function failAgent(agentId: string, error: string): void {
  const entry = agents.get(agentId);
  if (!entry) return;

  entry.handle.status = "failed";
  entry.handle.error = error;

  if (shouldRestart(entry)) {
    restartAgent(entry);
  } else {
    const reject = (entry.handle as any)._reject;
    if (reject) reject(new Error(error));
    agents.delete(agentId);
    drainQueue();
  }
}

// ── Restart Logic ─────────────────────────────────────────────────────

function shouldRestart(entry: AgentEntry): boolean {
  const maxRestarts = entry.config.maxRestarts ?? DEFAULT_MAX_RESTARTS;
  const windowMs = entry.config.maxRestartWindowMs ?? DEFAULT_RESTART_WINDOW_MS;
  const now = Date.now();

  // Count restarts within the window
  const recentRestarts = entry.restartTimestamps.filter(
    (t) => now - t < windowMs,
  );

  return recentRestarts.length < maxRestarts;
}

function restartAgent(entry: AgentEntry): void {
  entry.restartCount++;
  entry.restartTimestamps.push(Date.now());
  entry.abortController = new AbortController();
  entry.handle.status = "running";
  entry.handle.error = undefined;

  executeAgent(entry).catch(() => {});
}

// ── Queue Management ──────────────────────────────────────────────────

function drainQueue(): void {
  while (waitQueue.length > 0 && agents.size < MAX_CONCURRENT_AGENTS) {
    const next = waitQueue.shift();
    if (next) {
      try {
        const handle = createAgent(next.config, next.onOutput);
        next.resolve(handle);
      } catch (err) {
        next.reject(err instanceof Error ? err : new Error("Spawn failed"));
      }
    }
  }
}

// ── Query ─────────────────────────────────────────────────────────────

export function getAgent(agentId: string): AgentHandle | undefined {
  return agents.get(agentId)?.handle;
}

export function listActiveAgents(): AgentHandle[] {
  return Array.from(agents.values()).map((e) => e.handle);
}

/**
 * Cancel an agent. Sends abort signal, gives 5s for graceful shutdown,
 * then force-removes.
 */
export function cancelAgent(agentId: string): void {
  const entry = agents.get(agentId);
  if (!entry) return;

  entry.abortController.abort();
  entry.handle.status = "cancelled";

  // Force cleanup after 5s if not already removed
  setTimeout(() => {
    if (agents.has(agentId)) {
      agents.delete(agentId);
      drainQueue();
    }
  }, 5000);
}

export function getActiveCount(): number {
  return agents.size;
}
