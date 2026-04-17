/**
 * Async Subagent Task Service — Phase I.I3
 * (SECURITY_HARDENING_PLAN.md).
 *
 * Persists background subagent state in the `async_tasks` SQLite
 * table so it survives conversation compaction AND proxy restarts
 * (decision Q8). The parent agent interacts via 5 tools:
 *
 *   start_async_task   — create + queue a background task
 *   check_async_task   — read status + progress + result
 *   update_async_task  — set progress / intermediate results
 *   cancel_async_task  — mark as cancelled
 *   list_async_tasks   — list all tasks for the current session
 *
 * The table lives OUTSIDE the message log: `compactService` can
 * freely summarise/drop old messages without losing task state.
 *
 * SOLID:
 *   - SRP: CRUD on async_tasks only. No spawn logic (agentService),
 *     no streaming (streamEvents), no UI.
 *   - DIP: depends on Drizzle `db` + schema — no IDE/proxy coupling.
 */

import * as crypto from "node:crypto";
import { and, eq, desc } from "drizzle-orm";
import { db } from "../db";
import { asyncTasks } from "../db/schema";

// ── Types ───────────────────────────────────────────────────────

export type AsyncTaskStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface AsyncTask {
  id: string;
  parentSession: string;
  name: string | null;
  prompt: string;
  model: string | null;
  status: AsyncTaskStatus;
  progress: number;
  resultJson: string | null;
  error: string | null;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  lastCheckedAt: number | null;
}

// ── CRUD ────────────────────────────────────────────────────────

export function startAsyncTask(args: {
  parentSession: string;
  name?: string;
  prompt: string;
  model?: string;
}): AsyncTask {
  const id = `async_${crypto.randomUUID().slice(0, 8)}`;
  const now = Date.now();
  db.insert(asyncTasks)
    .values({
      id,
      parentSession: args.parentSession,
      name: args.name ?? null,
      prompt: args.prompt,
      model: args.model ?? null,
      status: "pending",
      progress: 0,
      createdAt: now,
    })
    .run();
  return getAsyncTask(id)!;
}

export function getAsyncTask(id: string): AsyncTask | null {
  const row = db.select().from(asyncTasks).where(eq(asyncTasks.id, id)).get();
  if (!row) return null;
  return rowToTask(row);
}

export function checkAsyncTask(id: string): AsyncTask | null {
  const task = getAsyncTask(id);
  if (!task) return null;
  // Update last_checked_at so we know the parent is still watching.
  db.update(asyncTasks)
    .set({ lastCheckedAt: Date.now() })
    .where(eq(asyncTasks.id, id))
    .run();
  return { ...task, lastCheckedAt: Date.now() };
}

export function updateAsyncTask(
  id: string,
  update: {
    status?: AsyncTaskStatus;
    progress?: number;
    resultJson?: string;
    error?: string;
  },
): AsyncTask | null {
  const existing = getAsyncTask(id);
  if (!existing) return null;
  const now = Date.now();
  const setFields: Record<string, unknown> = {};
  if (update.status !== undefined) setFields.status = update.status;
  if (update.progress !== undefined) setFields.progress = update.progress;
  if (update.resultJson !== undefined) setFields.resultJson = update.resultJson;
  if (update.error !== undefined) setFields.error = update.error;
  if (
    update.status === "completed" ||
    update.status === "failed" ||
    update.status === "cancelled"
  ) {
    setFields.completedAt = now;
  }
  if (update.status === "running" && !existing.startedAt) {
    setFields.startedAt = now;
  }
  if (Object.keys(setFields).length === 0) return existing;
  db.update(asyncTasks).set(setFields).where(eq(asyncTasks.id, id)).run();
  return getAsyncTask(id);
}

export function cancelAsyncTask(id: string): boolean {
  const existing = getAsyncTask(id);
  if (!existing) return false;
  if (existing.status === "completed" || existing.status === "cancelled") {
    return false;
  }
  db.update(asyncTasks)
    .set({ status: "cancelled", completedAt: Date.now() })
    .where(eq(asyncTasks.id, id))
    .run();
  return true;
}

export function listAsyncTasks(parentSession: string): AsyncTask[] {
  const rows = db
    .select()
    .from(asyncTasks)
    .where(eq(asyncTasks.parentSession, parentSession))
    .orderBy(desc(asyncTasks.createdAt))
    .all();
  return rows.map(rowToTask);
}

// ── Helpers ─────────────────────────────────────────────────────

function rowToTask(row: typeof asyncTasks.$inferSelect): AsyncTask {
  return {
    id: row.id,
    parentSession: row.parentSession,
    name: row.name ?? null,
    prompt: row.prompt,
    model: row.model ?? null,
    status: row.status as AsyncTaskStatus,
    progress: row.progress ?? 0,
    resultJson: row.resultJson ?? null,
    error: row.error ?? null,
    createdAt: row.createdAt,
    startedAt: row.startedAt ?? null,
    completedAt: row.completedAt ?? null,
    lastCheckedAt: row.lastCheckedAt ?? null,
  };
}
