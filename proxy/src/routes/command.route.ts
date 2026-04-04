/**
 * Command Routes
 *
 * REST API for slash command listing and execution.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth/authMiddleware";
import {
  listCommands,
  searchCommands,
  executeCommand,
} from "../commands/commandLoader";
import type { CommandContext } from "../commands/commandTypes";

// ── Zod schemas ────────────────────────────────────────────────

const executeSchema = z.object({
  input: z.string().min(1).max(10_000),
  model: z.string().max(200).optional(),
  projectPath: z.string().max(500).optional(),
  sessionId: z.string().max(100).optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
});

// ── Route registration ─────────────────────────────────────────

export async function registerCommandRoutes(
  app: FastifyInstance,
): Promise<void> {
  // List all available commands
  app.get(
    "/api/commands",
    { preHandler: [requireAuth] },
    async (request: FastifyRequest) => {
      const query = (request.query as Record<string, string>).q;

      const commands = query ? searchCommands(query) : listCommands();

      return { commands, total: commands.length };
    },
  );

  // Execute a slash command
  app.post(
    "/api/commands/execute",
    { preHandler: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const ctx = request.authContext;
      if (!ctx) return reply.status(401).send({ error: "Not authenticated" });

      const parsed = executeSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "Invalid payload",
          details: parsed.error.flatten(),
        });
      }

      const { input, model, projectPath, sessionId, extra } = parsed.data;

      const commandContext: CommandContext = {
        userId: ctx.user.id,
        projectPath: projectPath ?? process.cwd(),
        model: model ?? "gpt-4",
        sessionId,
        extra,
      };

      const outcome = await executeCommand(input, commandContext);

      if (!outcome.found) {
        return reply.status(404).send({
          error: "Command not found",
          input,
        });
      }

      if (outcome.prompt) {
        // Prompt commands return the expanded prompt for the client to send to LLM
        return {
          type: "prompt",
          commandName: outcome.command?.name,
          prompt: outcome.prompt,
          progressMessage: (outcome.command as any)?.progressMessage,
        };
      }

      return {
        type: outcome.command?.type,
        commandName: outcome.command?.name,
        result: outcome.result,
      };
    },
  );
}
