/**
 * Skill Routes
 *
 * REST API for skill listing and invocation.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth/authMiddleware";
import { listSkills, findSkill } from "../skills/skillLoader";
import { expandSkillPrompt } from "../skills/skillTypes";

// ── Zod schemas ────────────────────────────────────────────────

const invokeSchema = z.object({
  name: z.string().min(1).max(100),
  args: z.string().max(50_000).optional(),
  file: z.string().max(500).optional(),
  selection: z.string().max(50_000).optional(),
  projectPath: z.string().max(500).optional(),
});

// ── Route registration ─────────────────────────────────────────

export async function registerSkillRoutes(app: FastifyInstance): Promise<void> {
  // List all available skills
  app.get(
    "/api/skills",
    { preHandler: [requireAuth] },
    async (request: FastifyRequest) => {
      const query = (request.query as Record<string, string>).projectPath;
      const skills = listSkills(query);
      return { skills, total: skills.length };
    },
  );

  // Invoke a skill (returns expanded prompt)
  app.post(
    "/api/skills/invoke",
    { preHandler: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = invokeSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "Invalid payload",
          details: parsed.error.flatten(),
        });
      }

      const { name, args, file, selection, projectPath } = parsed.data;
      const skill = findSkill(name, projectPath);

      if (!skill) {
        return reply.status(404).send({ error: `Skill "${name}" not found` });
      }

      const prompt = expandSkillPrompt(skill.promptTemplate, args ?? "", {
        file,
        selection,
        cwd: projectPath,
      });

      return {
        skill: {
          name: skill.name,
          description: skill.description,
          context: skill.context,
          model: skill.model,
        },
        prompt,
      };
    },
  );
}
