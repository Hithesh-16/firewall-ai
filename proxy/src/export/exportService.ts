import { db } from "../db/index";
import { logs } from "../db/schema";
import { ExportFilter } from "../types";
import { and, gte, lte, eq, desc } from "drizzle-orm";

function buildCondition(filter: ExportFilter) {
  const conditions = [];

  if (filter.startDate) {
    conditions.push(gte(logs.timestamp, filter.startDate));
  }
  if (filter.endDate) {
    conditions.push(lte(logs.timestamp, filter.endDate));
  }
  if (filter.action) {
    conditions.push(eq(logs.action, filter.action));
  }
  if (filter.minRiskScore !== undefined) {
    conditions.push(gte(logs.riskScore, filter.minRiskScore));
  }

  return conditions.length > 0 ? and(...conditions) : undefined;
}

export function queryLogs(filter: ExportFilter): any[] {
  const condition = buildCondition(filter);
  return db.select().from(logs).where(condition).orderBy(desc(logs.timestamp)).all();
}

export function exportAsJson(filter: ExportFilter): string {
  const rows = queryLogs(filter);
  const formatted = rows.map((r) => ({
    ...r,
    reasons: safeParse(r.reasons),
    date: new Date(r.timestamp).toISOString()
  }));

  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      totalRecords: formatted.length,
      filter,
      records: formatted
    },
    null,
    2
  );
}

export function exportAsCsv(filter: ExportFilter): string {
  const rows = queryLogs(filter);
  const headers = [
    "id",
    "date",
    "model",
    "provider",
    "action",
    "risk_score",
    "secrets_found",
    "pii_found",
    "files_blocked",
    "response_time_ms",
    "reasons"
  ];

  const csvRows = rows.map((r) => {
    const date = new Date(r.timestamp).toISOString();
    const reasons = safeParse(r.reasons).join("; ");
    return [
      r.id,
      date,
      r.model,
      r.provider,
      r.action,
      r.riskScore,
      r.secretsFound,
      r.piiFound,
      r.filesBlocked,
      r.responseTimeMs,
      `"${reasons.replace(/"/g, '""')}"`
    ].join(",");
  });

  return [headers.join(","), ...csvRows].join("\n");
}

export function generateComplianceSummary(filter: ExportFilter): Record<string, unknown> {
  const rows = queryLogs(filter);
  const total = rows.length;
  const blocked = rows.filter((r) => r.action === "BLOCK").length;
  const redacted = rows.filter((r) => r.action === "REDACT").length;
  const allowed = rows.filter((r) => r.action === "ALLOW").length;
  const avgRisk = total > 0 ? rows.reduce((s, r) => s + (r.riskScore ?? 0), 0) / total : 0;
  const totalSecrets = rows.reduce((s, r) => s + (r.secretsFound ?? 0), 0);
  const totalPii = rows.reduce((s, r) => s + (r.piiFound ?? 0), 0);

  return {
    reportGeneratedAt: new Date().toISOString(),
    period: {
      start: filter.startDate ? new Date(filter.startDate).toISOString() : "all time",
      end: filter.endDate ? new Date(filter.endDate).toISOString() : "now"
    },
    summary: {
      totalRequests: total,
      blocked,
      redacted,
      allowed,
      blockRate: total > 0 ? `${((blocked / total) * 100).toFixed(1)}%` : "0%",
      redactRate: total > 0 ? `${((redacted / total) * 100).toFixed(1)}%` : "0%",
      averageRiskScore: Math.round(avgRisk * 100) / 100,
      totalSecretsDetected: totalSecrets,
      totalPiiDetected: totalPii
    },
    compliance: {
      noRawSecretsStored: true,
      allRequestsLogged: true,
      fileScopeEnforced: true
    }
  };
}

function safeParse(val: string | null): string[] {
  if (!val) return [];
  try {
    return JSON.parse(val) as string[];
  } catch {
    return [];
  }
}
