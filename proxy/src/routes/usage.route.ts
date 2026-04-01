import { FastifyInstance } from "fastify";
import { requireAuth, requireCapability } from "../auth/authMiddleware";
import {
  getRecentUsage,
  getUsageSummary,
  getUsageSummaryByUser,
  getUsageSummaryByTeam,
} from "../gateway/usageService";

export async function registerUsageRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/api/usage/summary",
    { preHandler: [requireAuth, requireCapability("stats:read")] },
    async (request) => {
      const { providerId, startDate, endDate } = request.query as {
        providerId?: string;
        startDate?: string;
        endDate?: string;
      };

      return getUsageSummary(
        providerId ? Number(providerId) : undefined,
        startDate ? Number(startDate) : undefined,
        endDate ? Number(endDate) : undefined
      );
    }
  );

  /** GET /api/usage/by-user — Cost & token breakdown per user */
  app.get(
    "/api/usage/by-user",
    { preHandler: [requireAuth, requireCapability("stats:read")] },
    async (request) => {
      const { startDate, endDate } = request.query as {
        startDate?: string;
        endDate?: string;
      };
      const orgId = request.authContext?.user.orgId ?? undefined;

      return {
        byUser: getUsageSummaryByUser(
          orgId,
          startDate ? Number(startDate) : undefined,
          endDate ? Number(endDate) : undefined
        ),
      };
    }
  );

  /** GET /api/usage/by-team — Cost & token breakdown per team */
  app.get(
    "/api/usage/by-team",
    { preHandler: [requireAuth, requireCapability("stats:read")] },
    async (request) => {
      const { startDate, endDate } = request.query as {
        startDate?: string;
        endDate?: string;
      };
      const orgId = request.authContext?.user.orgId ?? undefined;

      return {
        byTeam: getUsageSummaryByTeam(
          orgId,
          startDate ? Number(startDate) : undefined,
          endDate ? Number(endDate) : undefined
        ),
      };
    }
  );

  app.get(
    "/api/usage/recent",
    { preHandler: [requireAuth, requireCapability("stats:read")] },
    async (request) => {
      const { limit } = request.query as { limit?: string };
      return getRecentUsage(limit ? Number(limit) : 50);
    }
  );
}
