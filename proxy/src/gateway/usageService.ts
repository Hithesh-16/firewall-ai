import { db } from "../db/index";
import { usageLogs } from "../db/schema";
import { UsageRecord } from "../types";
import { eq, and, asc, desc, sql, gte, lte } from "drizzle-orm";

function toUsageRecord(row: any): UsageRecord {
  return {
    id: row.id,
    logId: row.logId,
    providerId: row.providerId,
    modelName: row.modelName,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    totalTokens: row.totalTokens,
    cost: row.cost,
    timestamp: row.timestamp
  };
}

export function recordUsage(record: UsageRecord & { userId?: number; teamId?: number }): UsageRecord {
  const result = db.insert(usageLogs).values({
    logId: record.logId,
    providerId: record.providerId,
    modelName: record.modelName,
    inputTokens: record.inputTokens,
    outputTokens: record.outputTokens,
    totalTokens: record.totalTokens,
    cost: record.cost,
    timestamp: record.timestamp,
    ...(record.userId !== undefined ? { userId: record.userId } : {}),
    ...(record.teamId !== undefined ? { teamId: record.teamId } : {}),
  }).run();

  return { ...record, id: Number(result.lastInsertRowid) };
}

export function getUsageSummary(
  providerId?: number,
  startDate?: number,
  endDate?: number
): {
  totalRequests: number;
  totalTokens: number;
  totalCost: number;
  byModel: Array<{
    modelName: string;
    requests: number;
    tokens: number;
    cost: number;
  }>;
  byDay: Array<{ date: string; requests: number; tokens: number; cost: number }>;
} {
  const conditions = [];
  if (providerId !== undefined) conditions.push(eq(usageLogs.providerId, providerId));
  if (startDate !== undefined) conditions.push(gte(usageLogs.timestamp, startDate));
  if (endDate !== undefined) conditions.push(lte(usageLogs.timestamp, endDate));

  const condition = conditions.length > 0 ? and(...conditions) : undefined;

  // Totals
  const totalsRow = db.select({
    totalRequests: sql<number>`COUNT(*)`,
    totalTokens: sql<number>`COALESCE(SUM(${usageLogs.totalTokens}), 0)`,
    totalCost: sql<number>`COALESCE(SUM(${usageLogs.cost}), 0)`
  }).from(usageLogs)
    .where(condition)
    .get();

  // By Model
  const byModelRows = db.select({
    modelName: usageLogs.modelName,
    requests: sql<number>`COUNT(*)`,
    tokens: sql<number>`SUM(${usageLogs.totalTokens})`,
    cost: sql<number>`SUM(${usageLogs.cost})`
  }).from(usageLogs)
    .where(condition)
    .groupBy(usageLogs.modelName)
    .orderBy(desc(sql`cost`))
    .all();

  // By Day
  const byDayRows = db.select({
    date: sql<string>`date(${usageLogs.timestamp} / 1000, 'unixepoch')`,
    requests: sql<number>`COUNT(*)`,
    tokens: sql<number>`SUM(${usageLogs.totalTokens})`,
    cost: sql<number>`SUM(${usageLogs.cost})`
  }).from(usageLogs)
    .where(condition)
    .groupBy(sql`date`)
    .orderBy(desc(sql`date`))
    .limit(30)
    .all();

  return {
    totalRequests: totalsRow?.totalRequests ?? 0,
    totalTokens: totalsRow?.totalTokens ?? 0,
    totalCost: totalsRow?.totalCost ?? 0,
    byModel: byModelRows.map((r) => ({
      modelName: r.modelName,
      requests: r.requests,
      tokens: r.tokens,
      cost: r.cost
    })),
    byDay: byDayRows.map((r) => ({
      date: r.date,
      requests: r.requests,
      tokens: r.tokens,
      cost: r.cost
    }))
  };
}

export function getUsageSummaryByUser(
  orgId?: number,
  startDate?: number,
  endDate?: number
): Array<{ userId: number | null; requests: number; tokens: number; cost: number }> {
  const conditions = [];
  if (startDate !== undefined) conditions.push(gte(usageLogs.timestamp, startDate));
  if (endDate !== undefined) conditions.push(lte(usageLogs.timestamp, endDate));
  const condition = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = db.select({
    userId: usageLogs.userId,
    requests: sql<number>`COUNT(*)`,
    tokens: sql<number>`COALESCE(SUM(${usageLogs.totalTokens}), 0)`,
    cost: sql<number>`COALESCE(SUM(${usageLogs.cost}), 0)`,
  }).from(usageLogs)
    .where(condition)
    .groupBy(usageLogs.userId)
    .orderBy(desc(sql`cost`))
    .all();

  return rows.map((r) => ({
    userId: r.userId ?? null,
    requests: r.requests,
    tokens: r.tokens,
    cost: r.cost,
  }));
}

export function getUsageSummaryByTeam(
  orgId?: number,
  startDate?: number,
  endDate?: number
): Array<{ teamId: number | null; requests: number; tokens: number; cost: number }> {
  const conditions = [];
  if (startDate !== undefined) conditions.push(gte(usageLogs.timestamp, startDate));
  if (endDate !== undefined) conditions.push(lte(usageLogs.timestamp, endDate));
  const condition = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = db.select({
    teamId: usageLogs.teamId,
    requests: sql<number>`COUNT(*)`,
    tokens: sql<number>`COALESCE(SUM(${usageLogs.totalTokens}), 0)`,
    cost: sql<number>`COALESCE(SUM(${usageLogs.cost}), 0)`,
  }).from(usageLogs)
    .where(condition)
    .groupBy(usageLogs.teamId)
    .orderBy(desc(sql`cost`))
    .all();

  return rows.map((r) => ({
    teamId: r.teamId ?? null,
    requests: r.requests,
    tokens: r.tokens,
    cost: r.cost,
  }));
}

export function getRecentUsage(limit: number = 50): UsageRecord[] {
  const rows = db.select()
    .from(usageLogs)
    .orderBy(desc(usageLogs.timestamp))
    .limit(limit)
    .all();
  return rows.map(toUsageRecord);
}
