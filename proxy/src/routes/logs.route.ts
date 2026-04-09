import { FastifyInstance } from "fastify";
import {
  requireAuth,
  requireCapability,
  optionalAuth,
} from "../auth/authMiddleware";
import { listLogsPaged, type LogFilters } from "../logger/logger";

interface RawLogRow {
  id: number;
  timestamp: number;
  model: string;
  provider: string;
  original_hash?: string;
  originalHash?: string;
  sanitized_text?: string;
  sanitizedText?: string;
  secrets_found?: number;
  secretsFound?: number;
  pii_found?: number;
  piiFound?: number;
  entropy_found?: number;
  entropyFound?: number;
  files_blocked?: number;
  filesBlocked?: number;
  risk_score?: number;
  riskScore?: number;
  action: string;
  reasons?: string | null;
  response_time_ms?: number;
  responseTimeMs?: number;
  user_id?: number | null;
  userId?: number | null;
  team_id?: number | null;
  teamId?: number | null;
}

/** Normalize a DB row to camelCase for the frontend. */
function normalizeLogRow(row: RawLogRow) {
  return {
    id: row.id,
    action: row.action as "ALLOW" | "BLOCK" | "REDACT",
    riskScore: row.riskScore ?? row.risk_score ?? 0,
    secretsFound: row.secretsFound ?? row.secrets_found ?? 0,
    piiFound: row.piiFound ?? row.pii_found ?? 0,
    entropyFound: row.entropyFound ?? row.entropy_found ?? 0,
    filesBlocked: row.filesBlocked ?? row.files_blocked ?? 0,
    model: row.model,
    provider: row.provider,
    timestamp: row.timestamp,
    responseTimeMs: row.responseTimeMs ?? row.response_time_ms ?? 0,
    reasons: row.reasons ?? null,
    userId: row.userId ?? row.user_id ?? null,
    teamId: row.teamId ?? row.team_id ?? null,
  };
}

export async function registerLogsRoute(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/logs
   *
   * Query params:
   *   limit, offset, page  — pagination
   *   action               — filter by ALLOW/BLOCK/REDACT
   *   model                — filter by model name
   *   userId               — filter by specific user (admin only)
   *
   * Role-based access:
   *   admin / security_lead  → sees all logs (org-wide)
   *   developer / auditor    → sees only own logs (scoped to userId)
   */
  app.get("/api/logs", { preHandler: [optionalAuth] }, async (request) => {
    const query = request.query as {
      limit?: string;
      offset?: string;
      page?: string;
      action?: string;
      model?: string;
      userId?: string;
    };
    const limit = Math.min(Number(query.limit ?? 100), 500);
    const page = Math.max(Number(query.page ?? 1), 1);
    const offset = Number(query.offset ?? (page - 1) * limit);

    const userRole = request.authContext?.user?.role;
    const callerUserId = request.authContext?.user?.id;
    const isAdmin = userRole === "admin" || userRole === "security_lead";

    const filters: LogFilters = {};

    // Action filter
    if (query.action && ["ALLOW", "BLOCK", "REDACT"].includes(query.action)) {
      filters.action = query.action;
    }

    // Model filter
    if (query.model) {
      filters.model = query.model;
    }

    // User scoping: non-admins can only see their own logs
    if (!isAdmin) {
      filters.userId = callerUserId;
    } else if (query.userId) {
      // Admins can filter by specific userId
      filters.userId = Number(query.userId);
    }

    const { logs, total } = listLogsPaged(
      Number.isNaN(limit) ? 100 : limit,
      Number.isNaN(offset) ? 0 : offset,
      filters,
    );

    return {
      logs: (logs as RawLogRow[]).map(normalizeLogRow),
      total,
      page,
      limit: Number(limit),
    };
  });
}
