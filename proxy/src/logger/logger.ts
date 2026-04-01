import crypto from "node:crypto";
import { db } from "../db/index";
import { logs } from "../db/schema";
import { LogEntry } from "../types";
import { desc, count, sql } from "drizzle-orm";
import rawDb from "../db/database";

/**
 * Compute SHA-256 hash of the previous log entry for tamper-evident chaining.
 */
function computePrevHash(): string {
  const last = rawDb.prepare(
    "SELECT id, timestamp, action, risk_score, prev_hash FROM logs ORDER BY id DESC LIMIT 1"
  ).get() as { id: number; timestamp: number; action: string; risk_score: number; prev_hash: string | null } | undefined;

  if (!last) return "GENESIS";

  const payload = `${last.id}:${last.timestamp}:${last.action}:${last.risk_score}:${last.prev_hash ?? "GENESIS"}`;
  return crypto.createHash("sha256").update(payload).digest("hex");
}

export function logRequest(entry: LogEntry): void {
  const prevHash = computePrevHash();

  db.insert(logs).values({
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
    prevHash,
  }).run();
}

export function listLogs(limit = 100, offset = 0): unknown[] {
  return db.select()
    .from(logs)
    .orderBy(desc(logs.timestamp))
    .limit(limit)
    .offset(offset)
    .all();
}

export function listLogsPaged(limit = 100, offset = 0): { logs: unknown[]; total: number } {
  const totalResult = db.select({ count: count() }).from(logs).get();
  const logsResult = db.select()
    .from(logs)
    .orderBy(desc(logs.timestamp))
    .limit(limit)
    .offset(offset)
    .all();
    
  return { logs: logsResult, total: totalResult?.count ?? 0 };
}
