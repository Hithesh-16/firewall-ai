/**
 * Task Framework
 *
 * Core task lifecycle: register, update, progress, complete, fail, kill, cleanup.
 * All state is persisted to SQLite. Changes are broadcast via WebSocket.
 */

import { db } from "../db/index";
import { tasks } from "../db/schema";
import { broadcast } from "../ws/wsManager";
import { eq, and, desc, inArray } from "drizzle-orm";
import type { WsEvent } from "../types";
import {
  type TaskType,
  type TaskStatus,
  type TaskStateBase,
  type TaskProgress,
  type TaskEventType,
  generateTaskId,
  isValidTransition,
  isTerminal,
  mapTaskRow,
} from "./taskTypes";

// ── Create ─────────────────────────────────────────────────────

export interface CreateTaskInput {
  readonly type: TaskType;
  readonly description: string;
  readonly userId: number | null;
  readonly parentTaskId?: string | null;
  readonly model?: string | null;
  readonly prompt?: string | null;
  readonly worktreePath?: string | null;
}

export function createTask(input: CreateTaskInput): TaskStateBase {
  const id = generateTaskId(input.type);
  const now = Date.now();

  db.insert(tasks)
    .values({
      id,
      type: input.type,
      status: "pending",
      description: input.description,
      userId: input.userId,
      agentId: null,
      parentTaskId: input.parentTaskId ?? null,
      model: input.model ?? null,
      prompt: input.prompt ?? null,
      worktreePath: input.worktreePath ?? null,
      progressJson: null,
      error: null,
      resultSummary: null,
      startedAt: now,
      completedAt: null,
      notified: 0,
    })
    .run();

  const task = getTaskById(id);
  if (!task) throw new Error(`Task ${id} not found after insert`);

  emitTaskEvent(task, "task_created");
  return task;
}

// ── Read ───────────────────────────────────────────────────────

export function getTaskById(id: string): TaskStateBase | null {
  const row = db.select().from(tasks).where(eq(tasks.id, id)).get();
  return row ? mapTaskRow(row as any) : null;
}

export function getTasksByUser(userId: number, limit = 50): TaskStateBase[] {
  const rows = db
    .select()
    .from(tasks)
    .where(eq(tasks.userId, userId))
    .orderBy(desc(tasks.startedAt))
    .limit(limit)
    .all();
  return rows.map((r) => mapTaskRow(r as any));
}

export function getTasksByParent(parentTaskId: string): TaskStateBase[] {
  const rows = db
    .select()
    .from(tasks)
    .where(eq(tasks.parentTaskId, parentTaskId))
    .orderBy(desc(tasks.startedAt))
    .all();
  return rows.map((r) => mapTaskRow(r as any));
}

export function getActiveTasks(userId: number): TaskStateBase[] {
  const rows = db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, userId),
        inArray(tasks.status, ["pending", "running"]),
      ),
    )
    .orderBy(desc(tasks.startedAt))
    .all();
  return rows.map((r) => mapTaskRow(r as any));
}

// ── Update status ──────────────────────────────────────────────

export function startTask(id: string, agentId?: string): boolean {
  return transitionTask(
    id,
    "running",
    (task) => {
      const updates: Record<string, unknown> = { status: "running" };
      if (agentId) updates.agentId = agentId;
      return updates;
    },
    "task_started",
  );
}

export function completeTask(id: string, resultSummary?: string): boolean {
  return transitionTask(
    id,
    "completed",
    () => ({
      status: "completed",
      completedAt: Date.now(),
      resultSummary: resultSummary ?? null,
    }),
    "task_completed",
  );
}

export function failTask(id: string, error: string): boolean {
  return transitionTask(
    id,
    "failed",
    () => ({
      status: "failed",
      completedAt: Date.now(),
      error,
    }),
    "task_failed",
  );
}

export function killTask(id: string): boolean {
  const task = getTaskById(id);
  if (!task) return false;
  if (isTerminal(task.status)) return false;

  const result = db
    .update(tasks)
    .set({ status: "killed", completedAt: Date.now() })
    .where(and(eq(tasks.id, id), inArray(tasks.status, ["pending", "running"])))
    .run();

  if (result.changes === 0) return false;

  const updated = getTaskById(id);
  if (updated) emitTaskEvent(updated, "task_killed");
  return true;
}

// ── Progress ───────────────────────────────────────────────────

export function updateTaskProgress(
  id: string,
  progress: TaskProgress,
): boolean {
  const result = db
    .update(tasks)
    .set({ progressJson: JSON.stringify(progress) })
    .where(and(eq(tasks.id, id), eq(tasks.status, "running")))
    .run();

  if (result.changes === 0) return false;

  const task = getTaskById(id);
  if (task) emitTaskEvent(task, "task_progress");
  return true;
}

// ── Mark notified ──────────────────────────────────────────────

export function markNotified(id: string): boolean {
  const result = db
    .update(tasks)
    .set({ notified: 1 })
    .where(eq(tasks.id, id))
    .run();
  return result.changes > 0;
}

// ── Cleanup ────────────────────────────────────────────────────

/** Expire pending tasks older than maxAgeMs (default 10 minutes) */
export function expireStale(maxAgeMs = 600_000): number {
  const cutoff = Date.now() - maxAgeMs;
  const result = db
    .update(tasks)
    .set({ status: "expired", completedAt: Date.now() })
    .where(
      and(
        eq(tasks.status, "pending"),
        // startedAt < cutoff  (manual SQL since Drizzle doesn't have lt easily)
      ),
    )
    .run();
  // Fallback: use raw query for timestamp comparison
  const raw = (db as any).run?.(
    `UPDATE tasks SET status = 'expired', completed_at = ? WHERE status = 'pending' AND started_at < ?`,
    [Date.now(), cutoff],
  );
  return raw?.changes ?? result.changes;
}

/** Delete completed/failed/killed tasks older than retentionMs (default 7 days) */
export function purgeOldTasks(retentionMs = 7 * 24 * 60 * 60 * 1000): number {
  const cutoff = Date.now() - retentionMs;
  // Use the underlying better-sqlite3 connection for complex WHERE
  const sqliteDb = (db as any)._.session?.client;
  if (!sqliteDb) return 0;

  const stmt = sqliteDb.prepare(
    `DELETE FROM tasks WHERE status IN ('completed','failed','killed','expired') AND completed_at < ?`,
  );
  const result = stmt.run(cutoff);
  return result.changes;
}

// ── Internal helpers ───────────────────────────────────────────

function transitionTask(
  id: string,
  targetStatus: TaskStatus,
  buildUpdates: (task: TaskStateBase) => Record<string, unknown>,
  eventType: TaskEventType,
): boolean {
  const task = getTaskById(id);
  if (!task) return false;
  if (!isValidTransition(task.status, targetStatus)) return false;

  const updates = buildUpdates(task);
  const result = db
    .update(tasks)
    .set(updates as any)
    .where(eq(tasks.id, id))
    .run();

  if (result.changes === 0) return false;

  const updated = getTaskById(id);
  if (updated) emitTaskEvent(updated, eventType);
  return true;
}

function emitTaskEvent(task: TaskStateBase, eventType: TaskEventType): void {
  if (task.userId == null) return;

  const event: WsEvent = {
    type: "task_event" as any,
    payload: {
      eventType,
      task: {
        id: task.id,
        type: task.type,
        status: task.status,
        description: task.description,
        progress: task.progress,
        error: task.error,
        resultSummary: task.resultSummary,
        startedAt: task.startedAt,
        completedAt: task.completedAt,
      },
    },
    timestamp: Date.now(),
  };

  broadcast(task.userId, event);
}
