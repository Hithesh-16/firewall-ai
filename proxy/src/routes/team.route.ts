/**
 * Team Management Routes
 *
 * CRUD for teams within an organization.
 * All routes verify the caller belongs to the same org as the team.
 */

import { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth, requireCapability } from "../auth/authMiddleware";
import {
  createTeam,
  getTeamById,
  getTeamsByOrg,
  getTeamWithMembers,
  addTeamMember,
  removeTeamMember,
  deleteTeam,
  updateTeam,
  getTeamsForUser,
} from "../services/teamService";

const createTeamSchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/),
});

const addMemberSchema = z.object({
  userId: z.number().int().positive(),
  role: z.enum(["lead", "member"]).default("member"),
});

export async function registerTeamRoutes(app: FastifyInstance): Promise<void> {
  // List teams in the caller's org
  app.get(
    "/api/teams",
    { preHandler: [requireAuth, requireCapability("team:read")] },
    async (request, reply) => {
      const orgId = request.authContext?.user.orgId;
      if (!orgId) {
        return reply.status(400).send({ error: "User has no organization. Complete onboarding first." });
      }
      return { teams: getTeamsByOrg(orgId) };
    }
  );

  // List teams the current user is a member of
  app.get(
    "/api/teams/mine",
    { preHandler: [requireAuth, requireCapability("team:read")] },
    async (request) => {
      const userId = request.authContext!.user.id;
      return { teams: getTeamsForUser(userId) };
    }
  );

  // Get team detail + members
  app.get(
    "/api/teams/:id",
    { preHandler: [requireAuth, requireCapability("team:read")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const team = getTeamById(Number(id));
      if (!team) return reply.status(404).send({ error: "Team not found" });

      // Verify same org
      if (team.orgId !== request.authContext?.user.orgId) {
        return reply.status(403).send({ error: "Team belongs to a different organization" });
      }

      return getTeamWithMembers(team.id);
    }
  );

  // Create team
  app.post(
    "/api/teams",
    { preHandler: [requireAuth, requireCapability("team:create")] },
    async (request, reply) => {
      const orgId = request.authContext?.user.orgId;
      if (!orgId) {
        return reply.status(400).send({ error: "User has no organization" });
      }

      const parsed = createTeamSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
      }

      try {
        const team = createTeam(orgId, parsed.data.name, parsed.data.slug);
        // Auto-add creator as team lead
        addTeamMember(team.id, request.authContext!.user.id, "lead");
        return reply.status(201).send(team);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        if (message.includes("UNIQUE")) {
          return reply.status(409).send({ error: "Team slug already exists in this org" });
        }
        return reply.status(500).send({ error: message });
      }
    }
  );

  // Update team name
  app.patch(
    "/api/teams/:id",
    { preHandler: [requireAuth, requireCapability("team:write")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const team = getTeamById(Number(id));
      if (!team) return reply.status(404).send({ error: "Team not found" });
      if (team.orgId !== request.authContext?.user.orgId) {
        return reply.status(403).send({ error: "Team belongs to a different organization" });
      }

      const body = request.body as { name?: string };
      if (body.name) {
        updateTeam(team.id, body.name);
      }
      return { ok: true };
    }
  );

  // Delete team
  app.delete(
    "/api/teams/:id",
    { preHandler: [requireAuth, requireCapability("team:delete")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const team = getTeamById(Number(id));
      if (!team) return reply.status(404).send({ error: "Team not found" });
      if (team.orgId !== request.authContext?.user.orgId) {
        return reply.status(403).send({ error: "Team belongs to a different organization" });
      }

      deleteTeam(team.id);
      return { ok: true };
    }
  );

  // Add member to team
  app.post(
    "/api/teams/:id/members",
    { preHandler: [requireAuth, requireCapability("team:write")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const team = getTeamById(Number(id));
      if (!team) return reply.status(404).send({ error: "Team not found" });
      if (team.orgId !== request.authContext?.user.orgId) {
        return reply.status(403).send({ error: "Team belongs to a different organization" });
      }

      const parsed = addMemberSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
      }

      try {
        const member = addTeamMember(team.id, parsed.data.userId, parsed.data.role);
        return reply.status(201).send(member);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        if (message.includes("UNIQUE")) {
          return reply.status(409).send({ error: "User is already a member of this team" });
        }
        return reply.status(500).send({ error: message });
      }
    }
  );

  // Remove member from team
  app.delete(
    "/api/teams/:id/members/:userId",
    { preHandler: [requireAuth, requireCapability("team:write")] },
    async (request, reply) => {
      const { id, userId } = request.params as { id: string; userId: string };
      const team = getTeamById(Number(id));
      if (!team) return reply.status(404).send({ error: "Team not found" });
      if (team.orgId !== request.authContext?.user.orgId) {
        return reply.status(403).send({ error: "Team belongs to a different organization" });
      }

      const removed = removeTeamMember(team.id, Number(userId));
      if (!removed) return reply.status(404).send({ error: "Member not found" });
      return { ok: true };
    }
  );
}
