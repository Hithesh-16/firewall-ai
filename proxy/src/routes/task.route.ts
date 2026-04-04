/**
 * Task Routes
 *
 * REST API for task management (create, list, get, update, stop).
 * All endpoints require authentication.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { requireAuth, requireCapability } from "../auth/authMiddleware";
import {
  createUserTask,
  getUserTasks,
  getUserActiveTasks,
  getTask,
  getChildTasks,
  beginTask,
  finishTask,
  errorTask,
  terminateTask,
  reportProgress,
  acknowledgeTask,
  killAllActiveTasks,
} from "../services/taskService";

// ── Zod schemas ────────────────────────────────────────────────

const createTaskSchema = z.object({
  type: z.enum([
    "local_agent",
    "background_agent",
    "bash",
    "scan",
    "dream",
    "cron",
    "workflow",
  ]),
  description: z.string().min(1).max(1000),
  model: z.string().max(200).optional(),
  prompt: z.string().max(100_000).optional(),
  parentTaskId: z.string().max(20).optional(),
});

const updateTaskSchema = z.object({
  status: z.enum(["running", "completed", "failed", "killed"]),
  agentId: z.string().max(100).optional(),
  resultSummary: z.string().max(10_000).optional(),
  error: z.string().max(10_000).optional(),
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

// ── Route registration ─────────────────────────────────────────

export async function registerTaskRoutes(app: FastifyInstance): Promise<void> {
  // List tasks for the authenticated user
  app.get(
    "/api/tasks",
    { preHandler: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ctx = request.authContext;
      if (!ctx) return reply.status(401).send({ error: "Not authenticated" });

      const query = request.query as Record<string, string>;
      const limit = query.limit ? Number(query.limit) : 50;
      const activeOnly = query.active === "true";

      const taskList = activeOnly
        ? getUserActiveTasks(ctx.user.id)
        : getUserTasks(ctx.user.id, limit);

      return { tasks: taskList, total: taskList.length };
    },
  );

  // Get a single task by ID
  app.get(
    "/api/tasks/:id",
    { preHandler: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as Record<string, string>;
      if (!id) return reply.status(400).send({ error: "Task ID required" });

      const task = getTask(id);
      if (!task) return reply.status(404).send({ error: "Task not found" });

      return { task };
    },
  );

  // Get child tasks (sub-agents spawned by a parent task)
  app.get(
    "/api/tasks/:id/children",
    { preHandler: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as Record<string, string>;
      if (!id) return reply.status(400).send({ error: "Task ID required" });

      const children = getChildTasks(id);
      return { tasks: children, total: children.length };
    },
  );

  // Create a new task
  app.post(
    "/api/tasks",
    { preHandler: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ctx = request.authContext;
      if (!ctx) return reply.status(401).send({ error: "Not authenticated" });

      const parsed = createTaskSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "Invalid payload",
          details: parsed.error.flatten(),
        });
      }

      const task = createUserTask(ctx.user.id, parsed.data);
      return reply.status(201).send({ task });
    },
  );

  // Update task status (start, complete, fail)
  app.patch(
    "/api/tasks/:id",
    { preHandler: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as Record<string, string>;
      if (!id) return reply.status(400).send({ error: "Task ID required" });

      const parsed = updateTaskSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "Invalid payload",
          details: parsed.error.flatten(),
        });
      }

      const { status, agentId, resultSummary, error } = parsed.data;
      let success = false;

      switch (status) {
        case "running":
          success = beginTask(id, agentId);
          break;
        case "completed":
          success = finishTask(id, resultSummary);
          break;
        case "failed":
          success = errorTask(id, error ?? "Unknown error");
          break;
        case "killed":
          success = terminateTask(id);
          break;
      }

      if (!success) {
        return reply.status(409).send({
          error: "Invalid state transition or task not found",
        });
      }

      const updated = getTask(id);
      return { task: updated };
    },
  );

  // Report progress on a running task
  app.post(
    "/api/tasks/:id/progress",
    { preHandler: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as Record<string, string>;
      if (!id) return reply.status(400).send({ error: "Task ID required" });

      const parsed = progressSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "Invalid payload",
          details: parsed.error.flatten(),
        });
      }

      const success = reportProgress(id, parsed.data);
      if (!success) {
        return reply.status(409).send({
          error: "Task not running or not found",
        });
      }

      return { updated: true };
    },
  );

  // Kill a task (stop running agent/process)
  app.delete(
    "/api/tasks/:id",
    { preHandler: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as Record<string, string>;
      if (!id) return reply.status(400).send({ error: "Task ID required" });

      const success = terminateTask(id);
      if (!success) {
        return reply.status(409).send({
          error: "Task already completed or not found",
        });
      }

      return { killed: true, taskId: id };
    },
  );

  // Kill all active tasks for the user
  app.post(
    "/api/tasks/kill-all",
    { preHandler: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ctx = request.authContext;
      if (!ctx) return reply.status(401).send({ error: "Not authenticated" });

      const killed = killAllActiveTasks(ctx.user.id);
      return { killed };
    },
  );

  // Mark task as notified (client acknowledged completion)
  app.post(
    "/api/tasks/:id/ack",
    { preHandler: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as Record<string, string>;
      if (!id) return reply.status(400).send({ error: "Task ID required" });

      const success = acknowledgeTask(id);
      if (!success) {
        return reply.status(404).send({ error: "Task not found" });
      }

      return { acknowledged: true };
    },
  );
}
