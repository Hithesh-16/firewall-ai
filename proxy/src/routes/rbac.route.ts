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
  listEffectiveCapabilities,
  assignOrgRole,
  assignTeamRole,
  addCapabilityOverride,
  removeCapabilityOverride,
  listOverridesForUser,
  checkPermission,
  countUsersWithRole,
} from "../auth/rbacService";
import { getUsersByOrg } from "../auth/authService";
import rawDb from "../db/database";

/**
 * Map an RBAC service error (code on `err.code`) to a JSON response.
 * Keeps the individual route handlers short and consistent.
 */
function rbacError(
  reply: import("fastify").FastifyReply,
  err: unknown,
): import("fastify").FastifyReply {
  const message = err instanceof Error ? err.message : "Unknown error";
  const code =
    err instanceof Error && "code" in err
      ? (err as Error & { code?: string }).code
      : undefined;
  switch (code) {
    case "RBAC_DEPENDENCY_VIOLATION":
      return reply.status(422).send({ error: message, code });
    case "RBAC_SYSTEM_ROLE_LOCKED":
      return reply.status(403).send({ error: message, code });
    case "RBAC_ROLE_IN_USE":
      return reply.status(409).send({
        error: message,
        code,
        count: (err as Error & { count?: number }).count ?? 0,
      });
    case "RBAC_EMPTY_ROLE":
      return reply.status(422).send({ error: message, code });
    case "RBAC_ROLE_NOT_FOUND":
      return reply.status(404).send({ error: message, code });
  }
  if (message.includes("UNIQUE")) {
    return reply
      .status(409)
      .send({ error: "Role name already exists in this org" });
  }
  return reply.status(400).send({ error: message });
}

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
  app.get("/api/capabilities", { preHandler: requireAuth }, async () => ({
    capabilities: listAllCapabilities(),
  }));

  /**
   * GET /api/me/permissions
   *
   * Returns the current user's flat effective permission atoms, e.g.
   *   { "permissions": ["users:view", "chat:create", ...] }
   *
   * Consumed by the web/ Redux permissions slice on login + app
   * startup. Hot-path for frontend permission checks — components
   * never hit the DB, they read the cached Set from Redux.
   */
  app.get(
    "/api/me/permissions",
    { preHandler: requireAuth },
    async (request, reply) => {
      const user = request.authContext?.user;
      if (!user) return reply.status(401).send({ error: "Not authenticated" });
      if (!user.orgId) {
        return { permissions: [] };
      }
      return { permissions: listEffectiveCapabilities(user.id, user.orgId) };
    },
  );

  // ── Roles ───────────────────────────────────────────────────────────

  /** List roles for the caller's org (built-in + custom).
   *
   *  P11-SERVER: accepts `?page`, `?pageSize` (default 20, max 100),
   *  and `?search` (matches name / displayName / description). Returns
   *  the uniform `{items, total, page, pageSize}` contract alongside
   *  the legacy `{roles}` key for backward compatibility. Filtering
   *  happens in JS because the listRolesForOrg / getRoleCapabilities
   *  helpers don't push into SQL — given role counts stay ≤20 in
   *  practice, in-memory filter is fine and keeps the helper surface
   *  unchanged. */
  app.get("/api/roles", { preHandler: requireAuth }, async (request, reply) => {
    const orgId = request.authContext?.user.orgId;
    if (!orgId)
      return reply.status(400).send({ error: "User has no organization" });

    const q = request.query as {
      page?: string | number;
      pageSize?: string | number;
      search?: string;
    };
    const page = Math.max(1, Number(q.page ?? 1) || 1);
    const requestedSize = Number(q.pageSize ?? 20) || 20;
    const pageSize = Math.max(1, Math.min(100, requestedSize));
    const search = (q.search ?? "").toString().trim().toLowerCase();

    const all = listRolesForOrg(orgId);
    const filtered =
      search.length === 0
        ? all
        : all.filter((r) => {
            return (
              (r.name ?? "").toLowerCase().includes(search) ||
              (r.displayName ?? "").toLowerCase().includes(search) ||
              (r.description ?? "").toLowerCase().includes(search)
            );
          });

    const total = filtered.length;
    const paged = filtered.slice((page - 1) * pageSize, page * pageSize);
    const enriched = paged.map((role) => ({
      ...role,
      capabilities: getRoleCapabilities(role.id),
    }));

    return {
      items: enriched,
      roles: enriched, // legacy key — remove once callers migrate
      total,
      page,
      pageSize,
      hasMore: page * pageSize < total,
    };
  });

  /** Create a custom role with selected capabilities */
  app.post(
    "/api/roles",
    { preHandler: [requireAuth, requireCapability("role:manage")] },
    async (request, reply) => {
      const orgId = request.authContext?.user.orgId;
      if (!orgId)
        return reply.status(400).send({ error: "User has no organization" });

      const parsed = createRoleSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "Invalid payload", details: parsed.error.flatten() });
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
        return rbacError(reply, err);
      }
    },
  );

  /** Update a custom role's capabilities */
  app.put(
    "/api/roles/:id",
    { preHandler: [requireAuth, requireCapability("role:manage")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = updateRoleSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "Invalid payload", details: parsed.error.flatten() });
      }

      try {
        updateRoleCapabilities(Number(id), parsed.data.capabilities);
        return { ok: true };
      } catch (err) {
        return rbacError(reply, err);
      }
    },
  );

  /** Delete a custom role (cannot delete built-in, cannot delete if users are assigned) */
  app.delete(
    "/api/roles/:id",
    { preHandler: [requireAuth, requireCapability("role:manage")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      try {
        const deleted = deleteCustomRole(Number(id));
        if (!deleted)
          return reply.status(404).send({ error: "Role not found" });
        return { ok: true };
      } catch (err) {
        return rbacError(reply, err);
      }
    },
  );

  /**
   * GET /api/roles/:id/users-count
   *
   * Used by the matrix UI before confirming a delete — lets the
   * frontend show "N users have this role" without a full user list.
   */
  app.get(
    "/api/roles/:id/users-count",
    { preHandler: [requireAuth, requireCapability("role:manage")] },
    async (request) => {
      const { id } = request.params as { id: string };
      return { count: countUsersWithRole(Number(id)) };
    },
  );

  // ── Users list (for the role-assignment page) ──────────────────────

  /**
   * GET /api/users
   *
   * Returns every member of the caller's org with their current
   * org-level role ID + display name. Single query feeding the
   * matrix UI's Users tab and the standalone Users page.
   */
  app.get(
    "/api/users",
    { preHandler: [requireAuth, requireCapability("user:read")] },
    async (request, reply) => {
      const orgId = request.authContext?.user.orgId;
      if (!orgId) {
        return reply.status(400).send({ error: "User has no organization" });
      }
      const users = getUsersByOrg(orgId);
      if (users.length === 0) return { users: [] };

      // One query to pull every user's current org role in one hit.
      const ids = users.map((u) => u.id);
      const placeholders = ids.map(() => "?").join(",");
      const rows = rawDb
        .prepare(
          `SELECT uor.user_id AS userId, uor.role_id AS roleId, r.name AS roleName, r.display_name AS roleDisplayName, r.is_system AS isSystem
             FROM user_org_roles uor
             LEFT JOIN roles r ON r.id = uor.role_id
            WHERE uor.org_id = ? AND uor.user_id IN (${placeholders})`,
        )
        .all(orgId, ...ids) as Array<{
        userId: number;
        roleId: number | null;
        roleName: string | null;
        roleDisplayName: string | null;
        isSystem: number | null;
      }>;
      const byUser = new Map(rows.map((r) => [r.userId, r]));

      return {
        users: users.map((u) => {
          const r = byUser.get(u.id);
          return {
            id: u.id,
            email: u.email,
            name: u.name,
            role: {
              id: r?.roleId ?? null,
              name: r?.roleName ?? u.role,
              displayName: r?.roleDisplayName ?? u.role,
              isSystem: r?.isSystem === 1,
            },
            createdAt: u.createdAt,
          };
        }),
      };
    },
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
        return reply
          .status(400)
          .send({ error: "Invalid payload", details: parsed.error.flatten() });
      }

      const orgId = request.authContext?.user.orgId;
      if (!orgId)
        return reply.status(400).send({ error: "User has no organization" });

      assignOrgRole(
        Number(userId),
        orgId,
        parsed.data.roleId,
        request.authContext?.user.id,
      );
      return { ok: true };
    },
  );

  /** Assign team-level role to a user */
  app.post(
    "/api/users/:userId/team-role/:teamId",
    { preHandler: [requireAuth, requireCapability("role:assign")] },
    async (request, reply) => {
      const { userId, teamId } = request.params as {
        userId: string;
        teamId: string;
      };
      const parsed = assignRoleSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "Invalid payload", details: parsed.error.flatten() });
      }

      assignTeamRole(
        Number(userId),
        Number(teamId),
        parsed.data.roleId,
        request.authContext?.user.id,
      );
      return { ok: true };
    },
  );

  // ── Capability Overrides ────────────────────────────────────────────

  /** Add a per-user capability override */
  app.post(
    "/api/users/:userId/overrides",
    { preHandler: [requireAuth, requireCapability("role:manage")] },
    async (request, reply) => {
      const { userId } = request.params as { userId: string };
      const orgId = request.authContext?.user.orgId;
      if (!orgId)
        return reply.status(400).send({ error: "User has no organization" });

      const parsed = overrideSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "Invalid payload", details: parsed.error.flatten() });
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
    },
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
    },
  );

  /** Remove a capability override */
  app.delete(
    "/api/users/:userId/overrides/:capName",
    { preHandler: [requireAuth, requireCapability("role:manage")] },
    async (request, reply) => {
      const { userId, capName } = request.params as {
        userId: string;
        capName: string;
      };
      const orgId = request.authContext?.user.orgId;
      if (!orgId)
        return reply.status(400).send({ error: "User has no organization" });

      const removed = removeCapabilityOverride(Number(userId), orgId, capName);
      if (!removed)
        return reply.status(404).send({ error: "Override not found" });
      return { ok: true };
    },
  );

  // ── Permission Check (for UI to test access) ───────────────────────

  /** Check if a user has a specific capability (for UI display) */
  app.get(
    "/api/permissions/check",
    { preHandler: requireAuth },
    async (request) => {
      const query = request.query as { capability?: string };
      if (!query.capability)
        return { error: "capability query param required" };

      const ctx = request.authContext!;
      const orgId = ctx.user.orgId;
      if (!orgId) return { allowed: false, reason: "No organization" };

      return checkPermission(ctx.user.id, orgId, query.capability);
    },
  );
}
