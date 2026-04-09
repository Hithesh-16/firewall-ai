import crypto from "node:crypto";
import { db } from "../db/index";
import { logs } from "../db/schema";
import { LogEntry } from "../types";
import { desc, count, sql, eq, and, or, isNull, type SQL } from "drizzle-orm";
import rawDb from "../db/database";

/**
 * Compute SHA-256 hash of the previous log entry for tamper-evident chaining.
 */
function computePrevHash(): string {
  const last = rawDb
    .prepare(
      "SELECT id, timestamp, action, risk_score, prev_hash FROM logs ORDER BY id DESC LIMIT 1",
    )
    .get() as
    | {
        id: number;
        timestamp: number;
        action: string;
        risk_score: number;
        prev_hash: string | null;
      }
    | undefined;

  if (!last) return "GENESIS";

  const payload = `${last.id}:${last.timestamp}:${last.action}:${last.risk_score}:${last.prev_hash ?? "GENESIS"}`;
  return crypto.createHash("sha256").update(payload).digest("hex");
}

export function logRequest(entry: LogEntry): void {
  const prevHash = computePrevHash();

  db.insert(logs)
    .values({
      timestamp: entry.timestamp,
      model: entry.model,
      provider: entry.provider,
      originalHash: entry.originalHash,
      sanitizedText: entry.sanitizedText,
      secretsFound: entry.secretsFound,
      piiFound: entry.piiFound,
      entropyFound: entry.entropyFound,
      filesBlocked: entry.filesBlocked,
      riskScore: entry.riskScore,
      action: entry.action,
      reasons: entry.reasons ? JSON.stringify(entry.reasons) : null,
      responseTimeMs: entry.responseTimeMs,
      userId: entry.userId ?? null,
      teamId: entry.teamId ?? null,
      prevHash,
    })
    .run();
}

export interface LogFilters {
  action?: string;
  userId?: number;
  teamId?: number;
  model?: string;
}

export function listLogs(limit = 100, offset = 0): unknown[] {
  return db
    .select()
    .from(logs)
    .orderBy(desc(logs.timestamp))
    .limit(limit)
    .offset(offset)
    .all();
}

export function listLogsPaged(
  limit = 100,
  offset = 0,
  filters?: LogFilters,
): { logs: unknown[]; total: number } {
  const conditions: SQL[] = [];

  if (filters?.action) {
    conditions.push(eq(logs.action, filters.action));
  }
  if (filters?.userId !== undefined) {
    // Include NULL userId rows (pre-migration data) alongside user-specific rows
    conditions.push(or(eq(logs.userId, filters.userId), isNull(logs.userId))!);
  }
  if (filters?.teamId !== undefined) {
    conditions.push(eq(logs.teamId, filters.teamId));
  }
  if (filters?.model) {
    conditions.push(eq(logs.model, filters.model));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const totalResult = whereClause
    ? db.select({ count: count() }).from(logs).where(whereClause).get()
    : db.select({ count: count() }).from(logs).get();

  const logsResult = whereClause
    ? db
        .select()
        .from(logs)
        .where(whereClause)
        .orderBy(desc(logs.timestamp))
        .limit(limit)
        .offset(offset)
        .all()
    : db
        .select()
        .from(logs)
        .orderBy(desc(logs.timestamp))
        .limit(limit)
        .offset(offset)
        .all();

  return { logs: logsResult, total: totalResult?.count ?? 0 };
}
