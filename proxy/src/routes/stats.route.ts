import { FastifyInstance } from "fastify";
import { db } from "../db/index";
import { logs } from "../db/schema";
import { sql, isNotNull, ne, gt } from "drizzle-orm";
import { requireAuth } from "../auth/authMiddleware";

export async function registerStatsRoute(app: FastifyInstance): Promise<void> {
  app.get("/api/stats", { preHandler: requireAuth }, async () => {
    const totalsRow = db
      .select({
        total: sql<number>`COUNT(*)`,
        blocked: sql<number>`SUM(CASE WHEN ${logs.action} = 'BLOCK' THEN 1 ELSE 0 END)`,
        redacted: sql<number>`SUM(CASE WHEN ${logs.action} = 'REDACT' THEN 1 ELSE 0 END)`,
        allowed: sql<number>`SUM(CASE WHEN ${logs.action} = 'ALLOW' THEN 1 ELSE 0 END)`,
        avgRiskScore: sql<number>`COALESCE(AVG(${logs.riskScore}), 0)`,
        totalEntropy: sql<number>`COALESCE(SUM(${logs.entropyFound}), 0)`,
      })
      .from(logs)
      .get();

    const totals = totalsRow ?? {
      total: 0,
      blocked: 0,
      redacted: 0,
      allowed: 0,
      avgRiskScore: 0,
      totalEntropy: 0,
    };

    const dayExpr = sql<string>`DATE(${logs.timestamp} / 1000, 'unixepoch')`;
    const byDayRow = db
      .select({
        date: dayExpr,
        count: sql<number>`COUNT(*)`,
      })
      .from(logs)
      .groupBy(dayExpr)
      .orderBy(sql`${dayExpr} DESC`)
      .limit(30)
      .all();

    const byDay = byDayRow as Array<{ date: string; count: number }>;

    const reasonRows = db
      .select({ reasons: logs.reasons })
      .from(logs)
      .where(sql`${logs.reasons} IS NOT NULL AND ${logs.reasons} != '[]'`)
      .all();

    const secretCounts: Record<string, number> = {};
    for (const row of reasonRows) {
      if (!row.reasons) continue;
      try {
        const parsed = JSON.parse(row.reasons) as string[];
        for (const reason of parsed) {
          secretCounts[reason] = (secretCounts[reason] ?? 0) + 1;
        }
      } catch {
        continue;
      }
    }

    return {
      totalRequests: totals.total,
      blocked: totals.blocked,
      redacted: totals.redacted,
      allowed: totals.allowed,
      avgRiskScore: Math.round(totals.avgRiskScore * 100) / 100,
      totalEntropyFindings: totals.totalEntropy,
      secretsByType: secretCounts,
      requestsByDay: byDay,
    };
  });

  app.get("/api/risk-score", { preHandler: requireAuth }, async () => {
    const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

    const row = db
      .select({
        avg: sql<number>`COALESCE(AVG(${logs.riskScore}), 0)`,
        max: sql<number>`COALESCE(MAX(${logs.riskScore}), 0)`,
      })
      .from(logs)
      .where(gt(logs.timestamp, oneWeekAgo))
      .get();

    const avgScore = row?.avg ?? 0;
    const maxScore = row?.max ?? 0;
    const riskScore = Math.round(avgScore);

    const reasonRows = db
      .select({ reasons: logs.reasons })
      .from(logs)
      .where(sql`${logs.reasons} IS NOT NULL AND ${logs.reasons} != '[]'`)
      .all();

    const breakdown: Record<string, number> = {};
    for (const r of reasonRows) {
      if (!r.reasons) continue;
      try {
        const parsed = JSON.parse(r.reasons) as string[];
        for (const reason of parsed) {
          breakdown[reason] = (breakdown[reason] ?? 0) + 1;
        }
      } catch {
        continue;
      }
    }

    return {
      riskScore,
      breakdown,
      avgRiskScore: Math.round(avgScore * 100) / 100,
      maxRiskScore: maxScore,
      period: "7d",
    };
  });
}
