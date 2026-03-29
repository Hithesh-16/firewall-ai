/**
 * Approval Routes
 *
 * HTTP endpoints for the human-in-the-loop approval workflow.
 * Clients (PWA, extension) call these to list/resolve approvals.
 *
 * SOLID:
 * - SRP: Route handling only — delegates to approvalService.
 * - DIP: Depends on ApprovalRequest/ApprovalDecision interfaces.
 */

import { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  getPendingApprovals,
  getApprovalHistory,
  resolveApproval,
  getUserRules,
  deleteRule,
} from "../services/approvalService";

const resolveSchema = z.object({
  decision: z.enum(["allow_once", "allow_always", "deny", "deny_always"]),
  deviceId: z.string().optional(),
});

export async function registerApprovalRoutes(app: FastifyInstance): Promise<void> {
  /** GET /api/approvals/pending — list pending approvals for current user */
  app.get("/api/approvals/pending", async (request) => {
    // In production, extract userId from auth context
    const userId = (request.query as Record<string, string>).userId
      ? Number((request.query as Record<string, string>).userId)
      : 1;

    return { approvals: getPendingApprovals(userId) };
  });

  /** POST /api/approvals/:id/resolve — respond to an approval */
  app.post("/api/approvals/:id/resolve", async (request, reply) => {
    const id = Number((request.params as Record<string, string>).id);
    if (isNaN(id)) {
      return reply.status(400).send({ error: "Invalid approval ID" });
    }

    const parsed = resolveSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
    }

    const success = resolveApproval(id, parsed.data.decision, parsed.data.deviceId);
    if (!success) {
      return reply.status(404).send({ error: "Approval not found or already resolved" });
    }

    return { resolved: true, requestId: id, decision: parsed.data.decision };
  });

  /** GET /api/approvals/history — past decisions for audit */
  app.get("/api/approvals/history", async (request) => {
    const query = request.query as Record<string, string>;
    const userId = query.userId ? Number(query.userId) : 1;
    const limit = query.limit ? Number(query.limit) : 50;

    return { history: getApprovalHistory(userId, limit) };
  });

  /** GET /api/approvals/rules — remembered "Allow Always" / "Deny Always" rules */
  app.get("/api/approvals/rules", async (request) => {
    const userId = (request.query as Record<string, string>).userId
      ? Number((request.query as Record<string, string>).userId)
      : 1;

    return { rules: getUserRules(userId) };
  });

  /** DELETE /api/approvals/rules/:id — revoke a remembered rule */
  app.delete("/api/approvals/rules/:id", async (request, reply) => {
    const id = Number((request.params as Record<string, string>).id);
    if (isNaN(id)) {
      return reply.status(400).send({ error: "Invalid rule ID" });
    }

    const deleted = deleteRule(id);
    if (!deleted) {
      return reply.status(404).send({ error: "Rule not found" });
    }

    return { deleted: true, ruleId: id };
  });
}
