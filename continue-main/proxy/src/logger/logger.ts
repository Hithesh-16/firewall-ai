import { db } from "../db/index";
import { logs } from "../db/schema";
import { LogEntry } from "../types";
import { desc, count } from "drizzle-orm";

export function logRequest(entry: LogEntry): void {
  db.insert(logs).values({
    timestamp: entry.timestamp,
    model: entry.model, // Note: types.LogEntry model uses provider
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
    responseTimeMs: entry.responseTimeMs
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
