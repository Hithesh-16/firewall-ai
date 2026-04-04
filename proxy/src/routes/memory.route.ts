/**
 * Memory Routes
 *
 * REST API for persistent memory (MEMORY.md index + typed .md files).
 * All endpoints require authentication.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth/authMiddleware";
import {
  getMemoryIndex,
  updateMemoryIndex,
  listMemories,
  getMemory,
  saveMemory,
  removeMemory,
  extractMemories,
  getMemoryDirPath,
} from "../services/memoryService";

// ── Zod schemas ────────────────────────────────────────────────

const saveMemorySchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().min(1).max(500),
  type: z.enum(["user", "feedback", "project", "reference"]),
  body: z.string().min(1).max(50_000),
  fileName: z.string().max(100).optional(),
});

const updateIndexSchema = z.object({
  content: z.string().max(25_000),
});

const extractSchema = z.object({
  conversationText: z.string().min(10).max(500_000),
});

// ── Helpers ────────────────────────────────────────────────────

function getProjectPath(request: FastifyRequest): string {
  const query = request.query as Record<string, string>;
  return query.projectPath ?? process.cwd();
}

// ── Route registration ─────────────────────────────────────────

export async function registerMemoryRoutes(
  app: FastifyInstance,
): Promise<void> {
  // Get memory index (MEMORY.md)
  app.get(
    "/api/memory/index",
    { preHandler: [requireAuth] },
    async (request: FastifyRequest) => {
      const projectPath = getProjectPath(request);
      const index = getMemoryIndex(projectPath);
      return { index };
    },
  );

  // Update memory index content
  app.put(
    "/api/memory/index",
    { preHandler: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const projectPath = getProjectPath(request);

      const parsed = updateIndexSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "Invalid payload",
          details: parsed.error.flatten(),
        });
      }

      updateMemoryIndex(projectPath, parsed.data.content);
      return { updated: true };
    },
  );

  // List all memories (optional type filter)
  app.get(
    "/api/memory",
    { preHandler: [requireAuth] },
    async (request: FastifyRequest) => {
      const projectPath = getProjectPath(request);
      const query = request.query as Record<string, string>;
      const typeFilter = query.type as
        | "user"
        | "feedback"
        | "project"
        | "reference"
        | undefined;

      const memories = listMemories(projectPath, typeFilter);
      return { memories, total: memories.length };
    },
  );

  // Get a single memory file
  app.get(
    "/api/memory/:fileName",
    { preHandler: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { fileName } = request.params as Record<string, string>;
      if (!fileName)
        return reply.status(400).send({ error: "fileName required" });

      const projectPath = getProjectPath(request);
      const memory = getMemory(projectPath, fileName);

      if (!memory) {
        return reply.status(404).send({ error: "Memory not found" });
      }

      return { memory };
    },
  );

  // Create or update a memory
  app.post(
    "/api/memory",
    { preHandler: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const projectPath = getProjectPath(request);

      const parsed = saveMemorySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "Invalid payload",
          details: parsed.error.flatten(),
        });
      }

      const memory = saveMemory(projectPath, parsed.data);
      return reply.status(201).send({ memory });
    },
  );

  // Delete a memory
  app.delete(
    "/api/memory/:fileName",
    { preHandler: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { fileName } = request.params as Record<string, string>;
      if (!fileName)
        return reply.status(400).send({ error: "fileName required" });

      const projectPath = getProjectPath(request);
      const deleted = removeMemory(projectPath, fileName);

      if (!deleted) {
        return reply
          .status(404)
          .send({ error: "Memory not found or cannot be deleted" });
      }

      return { deleted: true, fileName };
    },
  );

  // Extract memories from conversation text
  app.post(
    "/api/memory/extract",
    { preHandler: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const projectPath = getProjectPath(request);

      const parsed = extractSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "Invalid payload",
          details: parsed.error.flatten(),
        });
      }

      const savedFiles = extractMemories(
        projectPath,
        parsed.data.conversationText,
      );
      return { extracted: savedFiles.length, files: savedFiles };
    },
  );

  // Get the memory directory path (for debug/info)
  app.get(
    "/api/memory/dir",
    { preHandler: [requireAuth] },
    async (request: FastifyRequest) => {
      const projectPath = getProjectPath(request);
      return { path: getMemoryDirPath(projectPath) };
    },
  );
}
