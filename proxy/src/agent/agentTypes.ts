/**
 * Agent Type Definitions
 *
 * Defines the different agent execution modes:
 *   - LocalAgent:  runs in-process, synchronous result
 *   - BackgroundAgent: runs in-process, async notification on completion
 *   - DreamAgent:  idle-time memory consolidation (future)
 *   - CoordinatorWorker: spawned by coordinator, limited tool set
 */

export type AgentMode =
  | "local" // Synchronous, blocks until result
  | "background" // Async, notifies via WebSocket on completion
  | "coordinator" // Orchestrator that spawns workers
  | "worker" // Worker spawned by coordinator
  | "dream"; // Memory consolidation (idle time)

export interface AgentDefinition {
  readonly name: string;
  readonly description: string;
  readonly mode: AgentMode;
  readonly model?: string;
  readonly systemPrompt?: string;
  /** Tools this agent is allowed to use (null = all) */
  readonly allowedTools?: readonly string[];
  /** Tools this agent is forbidden from using */
  readonly deniedTools?: readonly string[];
  /** Max execution time in ms (default: 300_000 = 5 min) */
  readonly timeoutMs?: number;
}

// ── Built-in agent definitions ─────────────────────────────────

export const GENERAL_PURPOSE_AGENT: AgentDefinition = {
  name: "general-purpose",
  description: "General-purpose agent for complex multi-step tasks",
  mode: "local",
  timeoutMs: 300_000,
};

export const EXPLORE_AGENT: AgentDefinition = {
  name: "explore",
  description:
    "Fast agent for codebase exploration — find files, search code, answer questions",
  mode: "local",
  allowedTools: ["glob", "grep", "read", "web_search", "web_fetch"],
  deniedTools: ["edit", "write", "bash", "notebook_edit"],
  timeoutMs: 120_000,
};

export const PLAN_AGENT: AgentDefinition = {
  name: "plan",
  description:
    "Planning agent — designs implementation strategy, returns step-by-step plan",
  mode: "local",
  allowedTools: ["glob", "grep", "read", "web_search"],
  deniedTools: ["edit", "write", "bash", "notebook_edit"],
  timeoutMs: 180_000,
};

export const BACKGROUND_AGENT: AgentDefinition = {
  name: "background",
  description:
    "Background agent — runs tasks asynchronously, notifies on completion",
  mode: "background",
  timeoutMs: 600_000,
};

export const BUILTIN_AGENTS: readonly AgentDefinition[] = [
  GENERAL_PURPOSE_AGENT,
  EXPLORE_AGENT,
  PLAN_AGENT,
  BACKGROUND_AGENT,
];

export function findAgentDefinition(name: string): AgentDefinition | null {
  return BUILTIN_AGENTS.find((a) => a.name === name) ?? null;
}

// ── Worker configuration for coordinator mode ──────────────────

/**
 * Tools that workers spawned by a coordinator are NOT allowed to use.
 * This prevents recursive spawning and meta-operations.
 */
export const WORKER_DENIED_TOOLS: readonly string[] = [
  "agent", // Cannot spawn sub-sub-agents
  "send_message", // Only coordinator sends messages
  "task_stop", // Only coordinator stops tasks
  "coordinator", // Cannot enter coordinator mode
];

/**
 * Maximum number of concurrent workers per coordinator session.
 */
export const MAX_CONCURRENT_WORKERS = 5;

/**
 * Auto-background threshold: if a worker hasn't completed
 * within this time, it auto-backgrounds.
 */
export const AUTO_BACKGROUND_MS = 120_000; // 2 minutes
