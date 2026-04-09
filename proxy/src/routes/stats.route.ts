import { FastifyInstance } from "fastify";
import { db } from "../db/index";
import { logs } from "../db/schema";
import { sql, gt, eq, and, or, isNull, type SQL } from "drizzle-orm";
import { requireAuth, optionalAuth } from "../auth/authMiddleware";

/**
 * Build stats aggregation with optional user/team scope.
 */
function buildStatsQuery(filters?: { userId?: number; teamId?: number }) {
  const conditions: SQL[] = [];
  if (filters?.userId !== undefined) {
    // Include NULL userId rows (pre-migration data) alongside user-specific rows
    conditions.push(or(eq(logs.userId, filters.userId), isNull(logs.userId))!);
  }
  if (filters?.teamId !== undefined) {
    conditions.push(or(eq(logs.teamId, filters.teamId), isNull(logs.teamId))!);
  }
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const baseQuery = db
    .select({
      total: sql<number>`COUNT(*)`,
      blocked: sql<number>`SUM(CASE WHEN ${logs.action} = 'BLOCK' THEN 1 ELSE 0 END)`,
      redacted: sql<number>`SUM(CASE WHEN ${logs.action} = 'REDACT' THEN 1 ELSE 0 END)`,
      allowed: sql<number>`SUM(CASE WHEN ${logs.action} = 'ALLOW' THEN 1 ELSE 0 END)`,
      avgRiskScore: sql<number>`COALESCE(AVG(${logs.riskScore}), 0)`,
      totalEntropy: sql<number>`COALESCE(SUM(${logs.entropyFound}), 0)`,
      totalSecrets: sql<number>`COALESCE(SUM(${logs.secretsFound}), 0)`,
      totalPii: sql<number>`COALESCE(SUM(${logs.piiFound}), 0)`,
    })
    .from(logs);

  const totalsRow = whereClause
    ? baseQuery.where(whereClause).get()
    : baseQuery.get();

  const totals = totalsRow ?? {
    total: 0,
    blocked: 0,
    redacted: 0,
    allowed: 0,
    avgRiskScore: 0,
    totalEntropy: 0,
    totalSecrets: 0,
    totalPii: 0,
  };

  // By-day breakdown (last 30 days)
  const dayExpr = sql<string>`DATE(${logs.timestamp} / 1000, 'unixepoch')`;
  const byDayQuery = db
    .select({
      date: dayExpr,
      count: sql<number>`COUNT(*)`,
      blocked: sql<number>`SUM(CASE WHEN ${logs.action} = 'BLOCK' THEN 1 ELSE 0 END)`,
      redacted: sql<number>`SUM(CASE WHEN ${logs.action} = 'REDACT' THEN 1 ELSE 0 END)`,
    })
    .from(logs);

  const byDay = (
    whereClause
      ? byDayQuery
          .where(whereClause)
          .groupBy(dayExpr)
          .orderBy(sql`${dayExpr} DESC`)
          .limit(30)
          .all()
      : byDayQuery
          .groupBy(dayExpr)
          .orderBy(sql`${dayExpr} DESC`)
          .limit(30)
          .all()
  ) as Array<{
    date: string;
    count: number;
    blocked: number;
    redacted: number;
  }>;

  // Secrets breakdown by type from reasons JSON
  const reasonQuery = db
    .select({ reasons: logs.reasons })
    .from(logs)
    .where(
      whereClause
        ? and(
            whereClause,
            sql`${logs.reasons} IS NOT NULL AND ${logs.reasons} != '[]'`,
          )
        : sql`${logs.reasons} IS NOT NULL AND ${logs.reasons} != '[]'`,
    )
    .all();

  const secretCounts: Record<string, number> = {};
  for (const row of reasonQuery) {
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

  // Top models used
  const modelQuery = db
    .select({
      model: logs.model,
      count: sql<number>`COUNT(*)`,
    })
    .from(logs);

  const topModels = (
    whereClause
      ? modelQuery
          .where(whereClause)
          .groupBy(logs.model)
          .orderBy(sql`COUNT(*) DESC`)
          .limit(10)
          .all()
      : modelQuery
          .groupBy(logs.model)
          .orderBy(sql`COUNT(*) DESC`)
          .limit(10)
          .all()
  ) as Array<{ model: string; count: number }>;

  return {
    totalRequests: totals.total ?? 0,
    blocked: totals.blocked ?? 0,
    redacted: totals.redacted ?? 0,
    allowed: totals.allowed ?? 0,
    avgRiskScore: Math.round((totals.avgRiskScore ?? 0) * 100) / 100,
    totalEntropyFindings: totals.totalEntropy ?? 0,
    totalSecretsFound: totals.totalSecrets ?? 0,
    totalPiiFound: totals.totalPii ?? 0,
    secretsByType: secretCounts,
    requestsByDay: byDay,
    topModels,
  };
}

export async function registerStatsRoute(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/stats
   *
   * Query params:
   *   userId  — scope stats to a specific user (admin only)
   *   teamId  — scope stats to a specific team
   *
   * Role-based:
   *   admin / security_lead → sees all or filtered by query params
   *   developer / auditor   → sees only own stats
   */
  app.get("/api/stats", { preHandler: optionalAuth }, async (request) => {
    const query = request.query as { userId?: string; teamId?: string };
    const userRole = request.authContext?.user?.role;
    const callerUserId = request.authContext?.user?.id;
    const isAdmin = userRole === "admin" || userRole === "security_lead";

    const filters: { userId?: number; teamId?: number } = {};

    if (!isAdmin) {
      // Non-admins always scoped to their own data
      filters.userId = callerUserId;
    } else {
      if (query.userId) filters.userId = Number(query.userId);
      if (query.teamId) filters.teamId = Number(query.teamId);
    }

    return buildStatsQuery(filters);
  });

  /**
   * GET /api/stats/per-user
   *
   * Returns per-user breakdown of scan stats (blocked, redacted, allowed).
   * Admin/security_lead only.
   */
  app.get(
    "/api/stats/per-user",
    { preHandler: requireAuth },
    async (request) => {
      const userRole = request.authContext?.user?.role;
      if (userRole !== "admin" && userRole !== "security_lead") {
        return { users: [] };
      }

      const rows = db
        .select({
          userId: logs.userId,
          total: sql<number>`COUNT(*)`,
          blocked: sql<number>`SUM(CASE WHEN ${logs.action} = 'BLOCK' THEN 1 ELSE 0 END)`,
          redacted: sql<number>`SUM(CASE WHEN ${logs.action} = 'REDACT' THEN 1 ELSE 0 END)`,
          allowed: sql<number>`SUM(CASE WHEN ${logs.action} = 'ALLOW' THEN 1 ELSE 0 END)`,
          avgRiskScore: sql<number>`COALESCE(AVG(${logs.riskScore}), 0)`,
          totalSecrets: sql<number>`COALESCE(SUM(${logs.secretsFound}), 0)`,
          totalPii: sql<number>`COALESCE(SUM(${logs.piiFound}), 0)`,
        })
        .from(logs)
        .where(sql`${logs.userId} IS NOT NULL`)
        .groupBy(logs.userId)
        .orderBy(sql`COUNT(*) DESC`)
        .all();

      return { users: rows };
    },
  );

  /**
   * GET /api/risk-score
   *
   * 7-day risk analysis. Role-scoped same as /api/stats.
   */
  app.get("/api/risk-score", { preHandler: optionalAuth }, async (request) => {
    const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const userRole = request.authContext?.user?.role;
    const callerUserId = request.authContext?.user?.id;
    const isAdmin = userRole === "admin" || userRole === "security_lead";

    const conditions: SQL[] = [gt(logs.timestamp, oneWeekAgo)];
    if (!isAdmin && callerUserId !== undefined) {
      conditions.push(or(eq(logs.userId, callerUserId), isNull(logs.userId))!);
    }

    const row = db
      .select({
        avg: sql<number>`COALESCE(AVG(${logs.riskScore}), 0)`,
        max: sql<number>`COALESCE(MAX(${logs.riskScore}), 0)`,
      })
      .from(logs)
      .where(and(...conditions))
      .get();

    const avgScore = row?.avg ?? 0;
    const maxScore = row?.max ?? 0;
    const riskScore = Math.round(avgScore);

    const reasonRows = db
      .select({ reasons: logs.reasons })
      .from(logs)
      .where(
        and(
          ...conditions,
          sql`${logs.reasons} IS NOT NULL AND ${logs.reasons} != '[]'`,
        ),
      )
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
