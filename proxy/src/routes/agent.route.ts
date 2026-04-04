/**
 * Agent Routes
 *
 * REST API for agent lifecycle: spawn, status, kill, send message.
 * All endpoints require authentication.
 *
 * SECURITY: Agent prompts are NOT scanned here — callers must use
 * /api/scan (preflight) before spawning. This route manages lifecycle only.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth/authMiddleware";
import {
  spawnAgent,
  completeAgent,
  failAgent,
  killAgent,
  killAllAgents,
  reportAgentProgress,
  sendMessageToAgent,
  getAgentStatus,
  getAllRunningAgents,
  getRunningAgentCount,
} from "../services/agentService";
import { getTasksByUser, getActiveTasks } from "../tasks/taskFramework";

// ── Zod schemas ────────────────────────────────────────────────

const spawnAgentSchema = z.object({
  description: z.string().min(1).max(500),
  prompt: z.string().min(1).max(200_000),
  model: z.string().max(200).optional(),
  parentTaskId: z.string().max(20).optional(),
  background: z.boolean().optional(),
  isolation: z.enum(["worktree", "none"]).optional(),
  worktreeSlug: z
    .string()
    .max(64)
    .regex(/^[a-zA-Z0-9._-]+$/)
    .optional(),
  cwd: z.string().max(500).optional(),
});

const completeAgentSchema = z.object({
  resultSummary: z.string().max(50_000).optional(),
});

const failAgentSchema = z.object({
  error: z.string().min(1).max(10_000),
});

const progressSchema = z.object({
  toolUseCount: z.number().int().min(0),
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  recentActivities: z
    .array(
      z.object({
        toolName: z.string(),
        input: z.record(z.string(), z.unknown()),
        timestamp: z.number(),
        isReadOnly: z.boolean(),
      }),
    )
    .max(20),
});

const sendMessageSchema = z.object({
  message: z.string().min(1).max(100_000),
});

// ── Route registration ─────────────────────────────────────────

export async function registerAgentRoutes(app: FastifyInstance): Promise<void> {
  // Spawn a new agent
  app.post(
    "/api/agents/spawn",
    { preHandler: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ctx = request.authContext;
      if (!ctx) return reply.status(401).send({ error: "Not authenticated" });

      const parsed = spawnAgentSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "Invalid payload",
          details: parsed.error.flatten(),
        });
      }

      try {
        const handle = spawnAgent({
          ...parsed.data,
          userId: ctx.user.id,
        });

        return reply.status(201).send({
          taskId: handle.taskId,
          agentId: handle.agentId,
          worktreePath: handle.worktreePath,
          worktreeBranch: handle.worktreeBranch,
          background: handle.background,
        });
      } catch (error: unknown) {
        const msg =
          error instanceof Error ? error.message : "Agent spawn failed";
        return reply.status(500).send({ error: msg });
      }
    },
  );

  // List running agents
  app.get(
    "/api/agents",
    { preHandler: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ctx = request.authContext;
      if (!ctx) return reply.status(401).send({ error: "Not authenticated" });

      const query = request.query as Record<string, string>;
      const activeOnly = query.active !== "false";

      const tasks = activeOnly
        ? getActiveTasks(ctx.user.id).filter(
            (t) => t.type === "local_agent" || t.type === "background_agent",
          )
        : getTasksByUser(ctx.user.id, 50).filter(
            (t) => t.type === "local_agent" || t.type === "background_agent",
          );

      return {
        agents: tasks,
        runningCount: getRunningAgentCount(),
        total: tasks.length,
      };
    },
  );

  // Get agent status
  app.get(
    "/api/agents/:taskId",
    { preHandler: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { taskId } = request.params as Record<string, string>;
      if (!taskId) return reply.status(400).send({ error: "Task ID required" });

      const status = getAgentStatus(taskId);
      if (!status.task) {
        return reply.status(404).send({ error: "Agent not found" });
      }

      return status;
    },
  );

  // Complete an agent
  app.post(
    "/api/agents/:taskId/complete",
    { preHandler: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { taskId } = request.params as Record<string, string>;
      if (!taskId) return reply.status(400).send({ error: "Task ID required" });

      const parsed = completeAgentSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "Invalid payload", details: parsed.error.flatten() });
      }

      const result = completeAgent(taskId, parsed.data.resultSummary);
      if (!result) {
        return reply
          .status(409)
          .send({ error: "Agent not running or not found" });
      }

      return { agent: result };
    },
  );

  // Fail an agent
  app.post(
    "/api/agents/:taskId/fail",
    { preHandler: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { taskId } = request.params as Record<string, string>;
      if (!taskId) return reply.status(400).send({ error: "Task ID required" });

      const parsed = failAgentSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "Invalid payload", details: parsed.error.flatten() });
      }

      const result = failAgent(taskId, parsed.data.error);
      if (!result) {
        return reply
          .status(409)
          .send({ error: "Agent not running or not found" });
      }

      return { agent: result };
    },
  );

  // Kill an agent
  app.delete(
    "/api/agents/:taskId",
    { preHandler: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { taskId } = request.params as Record<string, string>;
      if (!taskId) return reply.status(400).send({ error: "Task ID required" });

      const result = killAgent(taskId);
      if (!result) {
        return reply
          .status(409)
          .send({ error: "Agent not running or already terminated" });
      }

      return { agent: result };
    },
  );

  // Kill all agents for the user
  app.post(
    "/api/agents/kill-all",
    { preHandler: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ctx = request.authContext;
      if (!ctx) return reply.status(401).send({ error: "Not authenticated" });

      const killed = killAllAgents(ctx.user.id);
      return { killed };
    },
  );

  // Report progress on a running agent
  app.post(
    "/api/agents/:taskId/progress",
    { preHandler: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { taskId } = request.params as Record<string, string>;
      if (!taskId) return reply.status(400).send({ error: "Task ID required" });

      const parsed = progressSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "Invalid payload", details: parsed.error.flatten() });
      }

      const success = reportAgentProgress(taskId, parsed.data);
      if (!success) {
        return reply
          .status(409)
          .send({ error: "Agent not running or not found" });
      }

      return { updated: true };
    },
  );

  // Send message to a running agent
  app.post(
    "/api/agents/:taskId/message",
    { preHandler: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { taskId } = request.params as Record<string, string>;
      if (!taskId) return reply.status(400).send({ error: "Task ID required" });

      const parsed = sendMessageSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "Invalid payload", details: parsed.error.flatten() });
      }

      const success = sendMessageToAgent(taskId, parsed.data.message);
      if (!success) {
        return reply
          .status(409)
          .send({ error: "Agent not running or not found" });
      }

      return { sent: true };
    },
  );
}
