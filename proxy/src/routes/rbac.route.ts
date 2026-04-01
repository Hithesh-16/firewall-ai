/**
 * RBAC Management Routes
 *
 * Role CRUD, capability listing, user role assignment, and capability overrides.
 * Configurable RBAC: users can create custom roles and modify permissions.
 */

import { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth, requireCapability } from "../auth/authMiddleware";
import {
  listRolesForOrg,
  createCustomRole,
  updateRoleCapabilities,
  deleteCustomRole,
  getRoleCapabilities,
  listAllCapabilities,
  assignOrgRole,
  assignTeamRole,
  addCapabilityOverride,
  removeCapabilityOverride,
  listOverridesForUser,
  checkPermission,
} from "../auth/rbacService";

const createRoleSchema = z.object({
  name: z.string().min(1).max(50),
  displayName: z.string().min(1).max(100),
  description: z.string().max(500).default(""),
  capabilities: z.array(z.string()),
});

const updateRoleSchema = z.object({
  capabilities: z.array(z.string()),
});

const assignRoleSchema = z.object({
  roleId: z.number().int().positive(),
});

const overrideSchema = z.object({
  capabilityName: z.string().min(1),
  granted: z.boolean(),
  reason: z.string().min(1).max(500),
  expiresAt: z.number().int().positive().optional(),
});

export async function registerRbacRoutes(app: FastifyInstance): Promise<void> {

  // ── Capabilities ────────────────────────────────────────────────────

  /** List all available capabilities (for role editor UI) */
  app.get(
    "/api/capabilities",
    { preHandler: requireAuth },
    async () => ({ capabilities: listAllCapabilities() })
  );

  // ── Roles ───────────────────────────────────────────────────────────

  /** List roles for the caller's org (built-in + custom) */
  app.get(
    "/api/roles",
    { preHandler: requireAuth },
    async (request, reply) => {
      const orgId = request.authContext?.user.orgId;
      if (!orgId) return reply.status(400).send({ error: "User has no organization" });

      const roles = listRolesForOrg(orgId);

      // Enrich each role with its capabilities
      const enriched = roles.map((role) => ({
        ...role,
        capabilities: getRoleCapabilities(role.id),
      }));

      return { roles: enriched };
    }
  );

  /** Create a custom role with selected capabilities */
  app.post(
    "/api/roles",
    { preHandler: [requireAuth, requireCapability("role:manage")] },
    async (request, reply) => {
      const orgId = request.authContext?.user.orgId;
      if (!orgId) return reply.status(400).send({ error: "User has no organization" });

      const parsed = createRoleSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
      }

      try {
        const role = createCustomRole(
          orgId,
          parsed.data.name,
          parsed.data.displayName,
          parsed.data.description,
          parsed.data.capabilities,
        );
        return reply.status(201).send(role);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        if (message.includes("UNIQUE")) {
          return reply.status(409).send({ error: "Role name already exists in this org" });
        }
        return reply.status(500).send({ error: message });
      }
    }
  );

  /** Update a custom role's capabilities */
  app.put(
    "/api/roles/:id",
    { preHandler: [requireAuth, requireCapability("role:manage")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = updateRoleSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
      }

      try {
        updateRoleCapabilities(Number(id), parsed.data.capabilities);
        return { ok: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        return reply.status(400).send({ error: message });
      }
    }
  );

  /** Delete a custom role (cannot delete built-in) */
  app.delete(
    "/api/roles/:id",
    { preHandler: [requireAuth, requireCapability("role:manage")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      try {
        const deleted = deleteCustomRole(Number(id));
        if (!deleted) return reply.status(404).send({ error: "Role not found" });
        return { ok: true };
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        return reply.status(400).send({ error: message });
      }
    }
  );

  // ── User Role Assignment ────────────────────────────────────────────

  /** Assign org-level role to a user */
  app.post(
    "/api/users/:userId/role",
    { preHandler: [requireAuth, requireCapability("role:assign")] },
    async (request, reply) => {
      const { userId } = request.params as { userId: string };
      const parsed = assignRoleSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
      }

      const orgId = request.authContext?.user.orgId;
      if (!orgId) return reply.status(400).send({ error: "User has no organization" });

      assignOrgRole(Number(userId), orgId, parsed.data.roleId, request.authContext?.user.id);
      return { ok: true };
    }
  );

  /** Assign team-level role to a user */
  app.post(
    "/api/users/:userId/team-role/:teamId",
    { preHandler: [requireAuth, requireCapability("role:assign")] },
    async (request, reply) => {
      const { userId, teamId } = request.params as { userId: string; teamId: string };
      const parsed = assignRoleSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
      }

      assignTeamRole(Number(userId), Number(teamId), parsed.data.roleId, request.authContext?.user.id);
      return { ok: true };
    }
  );

  // ── Capability Overrides ────────────────────────────────────────────

  /** Add a per-user capability override */
  app.post(
    "/api/users/:userId/overrides",
    { preHandler: [requireAuth, requireCapability("role:manage")] },
    async (request, reply) => {
      const { userId } = request.params as { userId: string };
      const orgId = request.authContext?.user.orgId;
      if (!orgId) return reply.status(400).send({ error: "User has no organization" });

      const parsed = overrideSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
      }

      addCapabilityOverride(
        Number(userId),
        orgId,
        parsed.data.capabilityName,
        parsed.data.granted,
        parsed.data.reason,
        request.authContext!.user.id,
        parsed.data.expiresAt,
      );
      return { ok: true };
    }
  );

  /** List overrides for a user */
  app.get(
    "/api/users/:userId/overrides",
    { preHandler: [requireAuth, requireCapability("user:read")] },
    async (request) => {
      const { userId } = request.params as { userId: string };
      const orgId = request.authContext?.user.orgId;
      if (!orgId) return { overrides: [] };

      return { overrides: listOverridesForUser(Number(userId), orgId) };
    }
  );

  /** Remove a capability override */
  app.delete(
    "/api/users/:userId/overrides/:capName",
    { preHandler: [requireAuth, requireCapability("role:manage")] },
    async (request, reply) => {
      const { userId, capName } = request.params as { userId: string; capName: string };
      const orgId = request.authContext?.user.orgId;
      if (!orgId) return reply.status(400).send({ error: "User has no organization" });

      const removed = removeCapabilityOverride(Number(userId), orgId, capName);
      if (!removed) return reply.status(404).send({ error: "Override not found" });
      return { ok: true };
    }
  );

  // ── Permission Check (for UI to test access) ───────────────────────

  /** Check if a user has a specific capability (for UI display) */
  app.get(
    "/api/permissions/check",
    { preHandler: requireAuth },
    async (request) => {
      const query = request.query as { capability?: string };
      if (!query.capability) return { error: "capability query param required" };

      const ctx = request.authContext!;
      const orgId = ctx.user.orgId;
      if (!orgId) return { allowed: false, reason: "No organization" };

      return checkPermission(ctx.user.id, orgId, query.capability);
    }
  );
}
