import { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  authenticateUser,
  createApiToken,
  createUser,
  listApiTokens,
  markOnboardingComplete,
  revokeApiToken,
  revokeAllUserTokens,
  rotateApiToken,
  updateUserProfile,
  updateUserRole,
} from "../auth/authService";
import { requireAuth, requireCapability } from "../auth/authMiddleware";
import { assignOrgRole } from "../auth/rbacService";
import { createOrg, assignUserToOrg } from "../org/orgService";
import rawDb from "../db/database";
import { db } from "../db/index";
import { users } from "../db/schema";
import { asc } from "drizzle-orm";

const VALID_SCOPES = [
  "chat:write",
  "chat:read",
  "logs:read",
  "logs:export",
  "policy:read",
  "policy:write",
  "providers:read",
  "providers:write",
  "teams:read",
  "teams:write",
  "users:read",
  "users:write",
  "approvals:read",
  "approvals:write",
  "mcp:read",
  "mcp:write",
  "*",
] as const;

const registerSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(8),
  role: z.enum(["admin", "security_lead", "developer", "auditor"]).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

const tokenCreateSchema = z.object({
  name: z.string().min(1),
  expiresInDays: z.number().positive().optional(),
  scopes: z.array(z.enum(VALID_SCOPES)).optional(),
  orgId: z.number().int().positive().optional(),
  teamId: z.number().int().positive().optional(),
});

const tokenRotateSchema = z.object({
  tokenId: z.number().int().positive(),
  expiresInDays: z.number().positive().optional(),
});

export async function registerAuthRoutes(app: FastifyInstance): Promise<void> {
  app.post("/api/auth/register", async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "Invalid payload", details: parsed.error.flatten() });
    }

    try {
      // Any self-signup (no invitation) gets admin role
      const role = parsed.data.role ?? "admin";

      const user = createUser(
        parsed.data.email,
        parsed.data.name,
        parsed.data.password,
        role,
      );

      // Auto-create a personal org for the user if they don't have one
      const slug = parsed.data.email
        .split("@")[0]
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, "-");
      const org = createOrg(
        `${parsed.data.name}'s Organization`,
        `${slug}-${user.id}`,
      );
      assignUserToOrg(user.id, org.id);
      user.orgId = org.id;

      // Assign org role in user_org_roles (required for capability-based RBAC)
      const roleName = user.role ?? "developer";
      const systemRole = rawDb
        .prepare("SELECT id FROM roles WHERE name = ? AND is_system = 1")
        .get(roleName) as { id: number } | undefined;
      if (systemRole) {
        assignOrgRole(user.id, org.id, systemRole.id);
      }

      const { token } = createApiToken(user.id, "default");

      return reply.status(201).send({
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          orgId: user.orgId ?? null,
          onboardingComplete: user.onboardingComplete,
        },
        token,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      if (message.includes("UNIQUE constraint")) {
        return reply.status(409).send({ error: "Email already registered" });
      }
      return reply.status(500).send({ error: message });
    }
  });

  app.post("/api/auth/login", async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "Invalid payload", details: parsed.error.flatten() });
    }

    const user = authenticateUser(parsed.data.email, parsed.data.password);
    if (!user) {
      return reply.status(401).send({ error: "Invalid email or password" });
    }

    const { token } = createApiToken(user.id, "session");

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        orgId: user.orgId ?? null,
        onboardingComplete: user.onboardingComplete,
      },
      token,
    };
  });

  app.get("/api/auth/me", { preHandler: requireAuth }, async (request) => {
    const ctx = request.authContext!;
    return {
      user: {
        id: ctx.user.id,
        email: ctx.user.email,
        name: ctx.user.name,
        role: ctx.user.role,
        orgId: ctx.user.orgId,
        onboardingComplete: ctx.user.onboardingComplete,
        timezone: ctx.user.timezone,
      },
    };
  });

  /**
   * PUT /api/users/me
   *
   * Update display fields on the currently authenticated user. Accepts
   * `name` and `timezone`; email / role / orgId are managed via
   * dedicated admin routes. Fields omitted from the body are left
   * untouched. Returns the refreshed user record.
   */
  const updateMeSchema = z
    .object({
      name: z.string().min(1).max(100).optional(),
      timezone: z.string().max(64).nullable().optional(),
    })
    .refine((obj) => Object.keys(obj).length > 0, {
      message: "Provide at least one field to update",
    });

  app.put(
    "/api/users/me",
    { preHandler: requireAuth },
    async (request, reply) => {
      const ctx = request.authContext!;
      const parsed = updateMeSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "Invalid payload", details: parsed.error.flatten() });
      }
      const updated = updateUserProfile(ctx.user.id, parsed.data);
      if (!updated) {
        return reply.status(404).send({ error: "User not found" });
      }
      return {
        user: {
          id: updated.id,
          email: updated.email,
          name: updated.name,
          role: updated.role,
          orgId: updated.orgId,
          onboardingComplete: updated.onboardingComplete,
          timezone: updated.timezone,
        },
      };
    },
  );

  /**
   * POST /api/users/me/onboarding/complete
   *
   * Flips users.onboarding_complete to 1. The web dashboard's onboarding
   * wizard hits this on the final "Finish" step. Once flipped, the gate
   * in AppShell stops redirecting to /onboarding.
   *
   * Idempotent — safe to call repeatedly.
   */
  app.post(
    "/api/users/me/onboarding/complete",
    { preHandler: requireAuth },
    async (request) => {
      const ctx = request.authContext!;
      markOnboardingComplete(ctx.user.id);
      return {
        ok: true,
        user: {
          id: ctx.user.id,
          email: ctx.user.email,
          name: ctx.user.name,
          role: ctx.user.role,
          orgId: ctx.user.orgId,
          onboardingComplete: true,
        },
      };
    },
  );

  app.post(
    "/api/auth/tokens",
    { preHandler: requireAuth },
    async (request, reply) => {
      const parsed = tokenCreateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "Invalid payload", details: parsed.error.flatten() });
      }

      const ctx = request.authContext!;
      const { token, record } = createApiToken(ctx.user.id, parsed.data.name, {
        expiresInDays: parsed.data.expiresInDays,
        scopes: parsed.data.scopes,
        orgId: parsed.data.orgId,
        teamId: parsed.data.teamId,
      });

      return reply.status(201).send({
        token,
        id: record.id,
        name: record.name,
        scopes: record.scopes,
        orgId: record.orgId,
        teamId: record.teamId,
        expiresAt: record.expiresAt,
      });
    },
  );

  app.get("/api/auth/tokens", { preHandler: requireAuth }, async (request) => {
    const ctx = request.authContext!;
    return { tokens: listApiTokens(ctx.user.id) };
  });

  app.delete(
    "/api/auth/tokens/:id",
    { preHandler: requireAuth },
    async (request, reply) => {
      const ctx = request.authContext!;
      const { id } = request.params as { id: string };
      const revoked = revokeApiToken(Number(id), ctx.user.id);

      if (!revoked) {
        return reply.status(404).send({ error: "Token not found" });
      }
      return { ok: true };
    },
  );

  /** POST /api/auth/tokens/rotate — Atomically revoke old + create new with same scopes */
  app.post(
    "/api/auth/tokens/rotate",
    { preHandler: requireAuth },
    async (request, reply) => {
      const parsed = tokenRotateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "Invalid payload", details: parsed.error.flatten() });
      }

      const ctx = request.authContext!;
      const result = rotateApiToken(
        parsed.data.tokenId,
        ctx.user.id,
        parsed.data.expiresInDays,
      );

      if (!result) {
        return reply
          .status(404)
          .send({ error: "Token not found or does not belong to you" });
      }

      return reply.status(201).send({
        token: result.token,
        id: result.record.id,
        name: result.record.name,
        scopes: result.record.scopes,
        orgId: result.record.orgId,
        teamId: result.record.teamId,
        expiresAt: result.record.expiresAt,
        rotatedFromId: result.record.rotatedFromId,
      });
    },
  );

  /** POST /api/auth/logout — Revoke the current session token */
  app.post("/api/auth/logout", { preHandler: requireAuth }, async (request) => {
    const ctx = request.authContext!;
    revokeApiToken(ctx.token.id, ctx.user.id);
    return { ok: true, message: "Logged out successfully" };
  });

  /** POST /api/auth/logout/all — Revoke all tokens for the current user */
  app.post(
    "/api/auth/logout/all",
    { preHandler: requireAuth },
    async (request) => {
      const ctx = request.authContext!;
      const count = revokeAllUserTokens(ctx.user.id);
      return { ok: true, message: `Revoked ${count} token(s)` };
    },
  );

  app.get(
    "/api/admin/users",
    { preHandler: [requireAuth, requireCapability("user:read")] },
    async () => {
      const rows = db
        .select({
          id: users.id,
          email: users.email,
          name: users.name,
          role: users.role,
          org_id: users.orgId,
          created_at: users.createdAt,
        })
        .from(users)
        .orderBy(asc(users.createdAt))
        .all();

      return { users: rows };
    },
  );

  app.put(
    "/api/admin/users/:id/role",
    { preHandler: [requireAuth, requireCapability("role:assign")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const body = request.body as { role?: string };
      const validRoles = ["admin", "security_lead", "developer", "auditor"];

      if (!body.role || !validRoles.includes(body.role)) {
        return reply.status(400).send({ error: "Invalid role", validRoles });
      }

      updateUserRole(
        Number(id),
        body.role as "admin" | "security_lead" | "developer" | "auditor",
      );
      return { ok: true };
    },
  );
}
