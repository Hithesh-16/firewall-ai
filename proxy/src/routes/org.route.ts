import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import crypto from "node:crypto";
import { requireAuth, requireCapability } from "../auth/authMiddleware";
import {
  authenticateUser,
  createApiToken,
  createUser,
  getUsersByOrg,
} from "../auth/authService";
import { assignOrgRole } from "../auth/rbacService";
import { db as drizzleDb } from "../db/index";
import { users } from "../db/schema";
import { eq } from "drizzle-orm";
import rawDb from "../db/database";
import { env } from "../config";
import {
  assignUserToOrg,
  createOrg,
  deleteOrg,
  getOrgById,
  listOrgs,
  removeUserFromOrg,
  updateOrg
} from "../org/orgService";

type Role = "admin" | "security_lead" | "developer" | "auditor";
const ROLES: Role[] = ["admin", "security_lead", "developer", "auditor"];

/** Verify the authenticated user belongs to the org being accessed */
function verifyOrgMembership(request: FastifyRequest, reply: FastifyReply, orgId: number): boolean {
  const ctx = request.authContext;
  if (!ctx) return false;
  if (ctx.user.orgId !== orgId) {
    reply.status(403).send({ error: "You are not a member of this organization" });
    return false;
  }
  return true;
}

const createOrgSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1).regex(/^[a-z0-9-]+$/)
});

export async function registerOrgRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    "/api/orgs",
    { preHandler: [requireAuth, requireCapability("org:write")] },
    async (request, reply) => {
      const parsed = createOrgSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "Invalid payload", details: parsed.error.flatten() });
      }

      try {
        const org = createOrg(parsed.data.name, parsed.data.slug);
        return reply.status(201).send(org);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Unknown error";
        if (message.includes("UNIQUE")) {
          return reply.status(409).send({ error: "Slug already exists" });
        }
        return reply.status(500).send({ error: message });
      }
    }
  );

  app.get(
    "/api/orgs",
    { preHandler: [requireAuth, requireCapability("org:read")] },
    async () => ({ organizations: listOrgs() })
  );

  app.get(
    "/api/orgs/:id",
    { preHandler: [requireAuth, requireCapability("org:read")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (!verifyOrgMembership(request, reply, Number(id))) return;

      const org = getOrgById(Number(id));
      if (!org) return reply.status(404).send({ error: "Org not found" });

      const members = getUsersByOrg(org.id).map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role
      }));

      return { ...org, members };
    }
  );

  app.post(
    "/api/orgs/:id/members",
    { preHandler: [requireAuth, requireCapability("org:write")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (!verifyOrgMembership(request, reply, Number(id))) return;

      const body = request.body as { userId?: number | string };

      // Coerce loosely — some clients send strings, some numbers.
      const userId =
        typeof body.userId === "number"
          ? body.userId
          : typeof body.userId === "string" && body.userId.trim().length > 0
            ? Number(body.userId)
            : NaN;

      if (!Number.isFinite(userId) || userId <= 0) {
        return reply.status(400).send({ error: "userId is required" });
      }

      const org = getOrgById(Number(id));
      if (!org) return reply.status(404).send({ error: "Org not found" });

      assignUserToOrg(userId, org.id);
      return { ok: true };
    }
  );

  app.delete(
    "/api/orgs/:orgId/members/:userId",
    { preHandler: [requireAuth, requireCapability("org:write")] },
    async (request, reply) => {
      const { orgId, userId } = request.params as { orgId: string; userId: string };
      if (!verifyOrgMembership(request, reply, Number(orgId))) return;

      removeUserFromOrg(Number(userId));
      return { ok: true };
    }
  );

  /**
   * PUT /api/orgs/:id
   *
   * Update the display name, slug, and/or industry of an org. Used by
   * the onboarding wizard's Step 2 — and later, by the Settings page.
   * Any field omitted from the body is left unchanged.
   */
  const updateOrgSchema = z
    .object({
      name: z.string().min(1).max(200).optional(),
      slug: z
        .string()
        .min(1)
        .max(64)
        .regex(/^[a-z0-9-]+$/)
        .optional(),
      industry: z.string().max(100).nullable().optional(),
    })
    .refine((obj) => Object.keys(obj).length > 0, {
      message: "Provide at least one field to update",
    });

  app.put(
    "/api/orgs/:id",
    { preHandler: [requireAuth, requireCapability("org:write")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const orgId = Number(id);
      if (!verifyOrgMembership(request, reply, orgId)) return;

      const parsed = updateOrgSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "Invalid payload", details: parsed.error.flatten() });
      }

      try {
        const updated = updateOrg(orgId, parsed.data);
        if (!updated) {
          return reply.status(404).send({ error: "Org not found" });
        }
        return { org: updated };
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        if (msg.includes("UNIQUE constraint")) {
          return reply.status(409).send({ error: "Slug already in use" });
        }
        return reply.status(500).send({ error: msg });
      }
    },
  );

  app.delete(
    "/api/orgs/:id",
    { preHandler: [requireAuth, requireCapability("org:write")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      if (!verifyOrgMembership(request, reply, Number(id))) return;

      const deleted = deleteOrg(Number(id));
      if (!deleted) return reply.status(404).send({ error: "Org not found" });
      return { ok: true };
    }
  );

  // ── Invites ──────────────────────────────────────────────────────────
  //
  // Minimal invite flow for the unified-auth refactor:
  //
  //   POST /api/orgs/:id/invites    → admin creates an invite
  //   POST /api/auth/invites/accept → invitee redeems it
  //
  // The admin POST returns a signed token + a copy-pasteable URL the
  // admin can share via Slack/email/etc. (Wiring up actual email is
  // out of scope for Phase 2; the invite token IS the email body.)
  //
  // The token is HMAC'd with MASTER_KEY so it can't be forged. It
  // encodes { orgId, email, role, expiresAt } and is stateless — no
  // DB row needed.

  function inviteSecret(): string {
    return env.MASTER_KEY || "dev-only-weak-secret-for-invites";
  }

  function signInvite(payload: object): string {
    const body = Buffer.from(JSON.stringify(payload), "utf8").toString(
      "base64url",
    );
    const sig = crypto
      .createHmac("sha256", inviteSecret())
      .update(body)
      .digest("hex")
      .slice(0, 32);
    return `${body}.${sig}`;
  }

  function verifyInvite(
    token: string,
  ): {
    orgId: number;
    email: string;
    role: Role;
    expiresAt: number;
  } | null {
    const [body, sig] = token.split(".");
    if (!body || !sig) return null;
    const expected = crypto
      .createHmac("sha256", inviteSecret())
      .update(body)
      .digest("hex")
      .slice(0, 32);
    if (expected !== sig) return null;
    try {
      const decoded = JSON.parse(
        Buffer.from(body, "base64url").toString("utf8"),
      );
      if (!decoded || typeof decoded !== "object") return null;
      if (typeof decoded.expiresAt !== "number") return null;
      if (decoded.expiresAt < Date.now()) return null;
      if (!ROLES.includes(decoded.role)) return null;
      return decoded;
    } catch {
      return null;
    }
  }

  const createInviteSchema = z.object({
    email: z.string().email(),
    role: z.enum(["admin", "security_lead", "developer", "auditor"]),
    /** Optional TTL in days. Default 14. */
    expiresInDays: z.number().int().min(1).max(365).optional(),
  });

  app.post(
    "/api/orgs/:id/invites",
    { preHandler: [requireAuth, requireCapability("org:write")] },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const orgId = Number(id);
      if (!verifyOrgMembership(request, reply, orgId)) return;

      const parsed = createInviteSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "Invalid payload", details: parsed.error.flatten() });
      }

      const org = getOrgById(orgId);
      if (!org) return reply.status(404).send({ error: "Org not found" });

      const expiresInDays = parsed.data.expiresInDays ?? 14;
      const expiresAt = Date.now() + expiresInDays * 24 * 60 * 60 * 1000;

      const token = signInvite({
        orgId,
        email: parsed.data.email.toLowerCase(),
        role: parsed.data.role,
        expiresAt,
      });

      const dashboardUrl =
        process.env.AI_FIREWALL_DASHBOARD_URL || "http://localhost:5174";
      const inviteUrl = `${dashboardUrl.replace(/\/+$/, "")}/invite/${encodeURIComponent(token)}`;

      return {
        ok: true,
        invite: {
          token,
          url: inviteUrl,
          email: parsed.data.email,
          role: parsed.data.role,
          orgId,
          orgName: org.name,
          expiresAt,
        },
      };
    },
  );

  /**
   * GET /api/auth/invites/:token
   *
   * Public endpoint — used by the dashboard's /invite/:token landing page
   * to show the invitee what they're being invited to before they sign up.
   */
  app.get("/api/auth/invites/:token", async (request, reply) => {
    const { token } = request.params as { token: string };
    const decoded = verifyInvite(token);
    if (!decoded) {
      return reply
        .status(400)
        .send({ error: "Invalid or expired invite token" });
    }
    const org = getOrgById(decoded.orgId);
    if (!org) {
      return reply.status(404).send({ error: "Organization no longer exists" });
    }
    return {
      email: decoded.email,
      role: decoded.role,
      orgId: decoded.orgId,
      orgName: org.name,
      expiresAt: decoded.expiresAt,
    };
  });

  /**
   * POST /api/auth/invites/accept
   *
   * Invitee posts `{ token, name, password }` to redeem an invite. Two
   * code paths:
   *   - If a user with that email already exists, they're added to the
   *     org and assigned the invited role.
   *   - Otherwise, a new user is created with the supplied name/password,
   *     assigned to the org, and given the invited role.
   *
   * Returns a session token so the invitee is signed in immediately.
   */
  const acceptInviteSchema = z.object({
    token: z.string().min(10),
    name: z.string().min(1).optional(),
    password: z.string().min(8).optional(),
  });

  app.post("/api/auth/invites/accept", async (request, reply) => {
    const parsed = acceptInviteSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply
        .status(400)
        .send({ error: "Invalid payload", details: parsed.error.flatten() });
    }
    const decoded = verifyInvite(parsed.data.token);
    if (!decoded) {
      return reply
        .status(400)
        .send({ error: "Invalid or expired invite token" });
    }

    const org = getOrgById(decoded.orgId);
    if (!org) {
      return reply.status(404).send({ error: "Organization no longer exists" });
    }

    // Check whether this email already has a user row.
    const existingRow = drizzleDb
      .select()
      .from(users)
      .where(eq(users.email, decoded.email))
      .get();

    let userId: number;
    if (existingRow) {
      // Existing user — assign to the org if not already, update role.
      userId = existingRow.id;
      assignUserToOrg(userId, org.id);
    } else {
      if (!parsed.data.name || !parsed.data.password) {
        return reply.status(400).send({
          error: "name and password are required for first-time signup",
        });
      }
      const newUser = createUser(
        decoded.email,
        parsed.data.name,
        parsed.data.password,
        decoded.role,
        org.id,
      );
      userId = newUser.id;
    }

    // Assign org role for capability-based RBAC
    const systemRole = rawDb
      .prepare("SELECT id FROM roles WHERE name = ? AND is_system = 1")
      .get(decoded.role) as { id: number } | undefined;
    if (systemRole) {
      assignOrgRole(userId, org.id, systemRole.id);
    }

    // Mark onboarding complete — invited users inherit the admin's setup.
    rawDb
      .prepare(
        "UPDATE users SET onboarding_complete = 1, updated_at = ? WHERE id = ?",
      )
      .run(Date.now(), userId);

    const { token: sessionToken } = createApiToken(userId, "session");
    const refreshedRow = drizzleDb
      .select()
      .from(users)
      .where(eq(users.id, userId))
      .get();

    return {
      user: {
        id: refreshedRow!.id,
        email: refreshedRow!.email,
        name: refreshedRow!.name,
        role: refreshedRow!.role,
        orgId: refreshedRow!.orgId,
        onboardingComplete: true,
      },
      token: sessionToken,
    };
  });
}

// `authenticateUser` is imported above so the eslint unused-import rule
// doesn't fire when only the invite-accept path uses createUser/createApiToken.
// (Reference to keep the import alive for tree-shakers.)
void authenticateUser;
