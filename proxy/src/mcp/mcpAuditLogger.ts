import { db } from "../db/index";
import { mcpAudit } from "../db/schema";
import type { McpScanResult } from "./mcpScanPipeline";
import { eq, desc, sql, and } from "drizzle-orm";

export interface McpAuditEntry {
  id: number;
  timestamp: number;
  serverName: string;
  toolName: string;
  direction: string;
  action: string;
  riskScore: number;
  secretsFound: number;
  piiFound: number;
  injectionScore: number;
  reasons: string | null;
  scanTimeMs: number;
}

export function logMcpAudit(
  serverName: string,
  toolName: string,
  scanResult: McpScanResult
): void {
  db.insert(mcpAudit).values({
    timestamp: Date.now(),
    serverName,
    toolName,
    direction: scanResult.direction,
    action: scanResult.action,
    riskScore: scanResult.riskScore,
    secretsFound: scanResult.secretsFound,
    piiFound: scanResult.piiFound,
    injectionScore: scanResult.injectionScore,
    reasons: scanResult.reasons.length > 0 ? JSON.stringify(scanResult.reasons) : null,
    scanTimeMs: scanResult.scanTimeMs
  }).run();
}

export function queryMcpAudit(options?: {
  limit?: number;
  serverName?: string;
  action?: string;
}): McpAuditEntry[] {
  const limit = options?.limit ?? 100;
  
  const conditions = [];
  if (options?.serverName) conditions.push(eq(mcpAudit.serverName, options.serverName));
  if (options?.action) conditions.push(eq(mcpAudit.action, options.action));

  const condition = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = db.select().from(mcpAudit)
    .where(condition)
    .orderBy(desc(mcpAudit.timestamp))
    .limit(limit)
    .all();

  return rows.map((row) => ({
    id: row.id,
    timestamp: row.timestamp,
    serverName: row.serverName,
    toolName: row.toolName,
    direction: row.direction,
    action: row.action,
    riskScore: row.riskScore ?? 0,
    secretsFound: row.secretsFound ?? 0,
    piiFound: row.piiFound ?? 0,
    injectionScore: row.injectionScore ?? 0,
    reasons: row.reasons,
    scanTimeMs: row.scanTimeMs ?? 0,
  }));
}

export function getMcpAuditStats(): {
  totalCalls: number;
  blocked: number;
  redacted: number;
  allowed: number;
  avgRiskScore: number;
  avgScanTimeMs: number;
} {
  const row = db.select({
    total: sql<number>`COUNT(*)`,
    blocked: sql<number>`SUM(CASE WHEN ${mcpAudit.action} = 'BLOCK' THEN 1 ELSE 0 END)`,
    redacted: sql<number>`SUM(CASE WHEN ${mcpAudit.action} = 'REDACT' THEN 1 ELSE 0 END)`,
    allowed: sql<number>`SUM(CASE WHEN ${mcpAudit.action} = 'ALLOW' THEN 1 ELSE 0 END)`,
    avgRisk: sql<number>`COALESCE(AVG(${mcpAudit.riskScore}), 0)`,
    avgScan: sql<number>`COALESCE(AVG(${mcpAudit.scanTimeMs}), 0)`
  }).from(mcpAudit).get();

  return {
    totalCalls: row?.total ?? 0,
    blocked: row?.blocked ?? 0,
    redacted: row?.redacted ?? 0,
    allowed: row?.allowed ?? 0,
    avgRiskScore: Math.round(row?.avgRisk ?? 0),
    avgScanTimeMs: Math.round(row?.avgScan ?? 0),
  };
}
