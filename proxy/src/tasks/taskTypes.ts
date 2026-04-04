/**
 * Task Type System
 *
 * Defines the task state machine used for tracking agent work, background jobs,
 * and multi-step operations. Modeled after claude-code's Task.ts pattern but
 * adapted for our proxy-centric architecture where tasks are DB-backed and
 * pushed to clients via WebSocket.
 */

// ── Task taxonomy ──────────────────────────────────────────────

export type TaskType =
  | "local_agent" // In-process sub-agent (most common)
  | "background_agent" // Long-running agent, notifies on completion
  | "bash" // Shell command execution
  | "scan" // File/batch scan job
  | "dream" // Idle-time memory consolidation
  | "cron" // Scheduled trigger execution
  | "workflow"; // Multi-step workflow

export type TaskStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "killed"
  | "expired";

// ── ID generation ──────────────────────────────────────────────

const TYPE_PREFIX: Record<TaskType, string> = {
  local_agent: "a",
  background_agent: "b",
  bash: "s",
  scan: "f",
  dream: "d",
  cron: "c",
  workflow: "w",
};

/** Generate a prefixed task ID (e.g. "a_k7x9m2p1") */
export function generateTaskId(type: TaskType): string {
  const prefix = TYPE_PREFIX[type];
  const random = Array.from(
    { length: 8 },
    () =>
      "0123456789abcdefghijklmnopqrstuvwxyz"[Math.floor(Math.random() * 36)],
  ).join("");
  return `${prefix}_${random}`;
}

// ── Progress tracking ──────────────────────────────────────────

export interface ToolActivity {
  readonly toolName: string;
  readonly input: Record<string, unknown>;
  readonly timestamp: number;
  readonly isReadOnly: boolean;
}

export interface TaskProgress {
  readonly toolUseCount: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly recentActivities: readonly ToolActivity[];
}

// ── Core state ─────────────────────────────────────────────────

export interface TaskStateBase {
  readonly id: string;
  readonly type: TaskType;
  readonly status: TaskStatus;
  readonly description: string;
  readonly userId: number | null;
  readonly agentId: string | null;
  readonly parentTaskId: string | null;
  readonly model: string | null;
  readonly prompt: string | null;
  readonly worktreePath: string | null;
  readonly progress: TaskProgress | null;
  readonly error: string | null;
  readonly resultSummary: string | null;
  readonly startedAt: number;
  readonly completedAt: number | null;
  readonly notified: boolean;
}

// ── DB row shape (snake_case for SQLite) ───────────────────────

export interface TaskRow {
  id: string;
  type: string;
  status: string;
  description: string;
  user_id: number | null;
  agent_id: string | null;
  parent_task_id: string | null;
  model: string | null;
  prompt: string | null;
  worktree_path: string | null;
  progress_json: string | null;
  error: string | null;
  result_summary: string | null;
  started_at: number;
  completed_at: number | null;
  notified: integer | null;
}

type integer = number;

// ── Mapper ─────────────────────────────────────────────────────

export function mapTaskRow(row: TaskRow): TaskStateBase {
  return {
    id: row.id,
    type: row.type as TaskType,
    status: row.status as TaskStatus,
    description: row.description,
    userId: row.user_id,
    agentId: row.agent_id,
    parentTaskId: row.parent_task_id,
    model: row.model,
    prompt: row.prompt,
    worktreePath: row.worktree_path,
    progress: row.progress_json
      ? (JSON.parse(row.progress_json) as TaskProgress)
      : null,
    error: row.error,
    resultSummary: row.result_summary,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    notified: row.notified === 1,
  };
}

// ── Valid transitions ──────────────────────────────────────────

const VALID_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  pending: ["running", "killed", "expired"],
  running: ["completed", "failed", "killed"],
  completed: [],
  failed: [],
  killed: [],
  expired: [],
};

export function isValidTransition(from: TaskStatus, to: TaskStatus): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

export function isTerminal(status: TaskStatus): boolean {
  return VALID_TRANSITIONS[status].length === 0;
}

// ── Event types pushed via WebSocket ───────────────────────────

export type TaskEventType =
  | "task_created"
  | "task_started"
  | "task_progress"
  | "task_completed"
  | "task_failed"
  | "task_killed";
