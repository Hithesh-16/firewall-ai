/**
 * SCIM 2.0 Provisioning Routes
 *
 * Standard SCIM endpoints for automated user/group sync from IdPs
 * (Okta, Azure AD, OneLogin, etc.)
 *
 * Auth: separate SCIM bearer token (SCIM_TOKEN env var).
 * Users map to the users table, Groups map to teams table.
 */

import { FastifyInstance } from "fastify";
import db from "../db/database";
import { createUser, deleteUser, getUserById } from "../auth/authService";
import { createTeam, getTeamById, addTeamMember, removeTeamMember, deleteTeam } from "../services/teamService";
import { assignOrgRole } from "../auth/rbacService";
import { env } from "../config";

// SCIM bearer token auth
function requireScimAuth(request: any, reply: any) {
  const scimToken = env.SCIM_TOKEN;
  if (!scimToken) {
    return reply.status(501).send({ detail: "SCIM not configured. Set SCIM_TOKEN env var." });
  }
  const header = request.headers.authorization;
  if (!header || header !== `Bearer ${scimToken}`) {
    return reply.status(401).send({ detail: "Invalid SCIM bearer token" });
  }
}

// SCIM response format helpers
function userToScimResource(user: any) {
  return {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
    id: String(user.id),
    userName: user.email,
    name: { formatted: user.name, givenName: user.name.split(" ")[0], familyName: user.name.split(" ").slice(1).join(" ") || "" },
    emails: [{ value: user.email, primary: true }],
    active: true,
    meta: { resourceType: "User", created: new Date(user.createdAt).toISOString() },
  };
}

function teamToScimGroup(team: any, members: Array<{ userId: number }>) {
  return {
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:Group"],
    id: String(team.id),
    displayName: team.name,
    members: members.map((m) => ({ value: String(m.userId), display: "" })),
    meta: { resourceType: "Group", created: new Date(team.createdAt).toISOString() },
  };
}

export async function registerScimRoutes(app: FastifyInstance): Promise<void> {

  // ── Users ───────────────────────────────────────────────────────────

  /** GET /scim/v2/Users — List users (paginated) */
  app.get("/scim/v2/Users", { preHandler: requireScimAuth }, async (request) => {
    const query = request.query as { startIndex?: string; count?: string; filter?: string };
    const startIndex = parseInt(query.startIndex ?? "1", 10);
    const count = Math.min(parseInt(query.count ?? "100", 10), 200);

    let rows: any[];
    if (query.filter?.startsWith('userName eq "')) {
      const email = query.filter.match(/userName eq "(.+?)"/)?.[1];
      rows = email
        ? [db.prepare("SELECT * FROM users WHERE email = ?").get(email)].filter(Boolean)
        : [];
    } else {
      rows = db.prepare("SELECT * FROM users ORDER BY id LIMIT ? OFFSET ?").all(count, startIndex - 1);
    }

    const total = (db.prepare("SELECT COUNT(*) as cnt FROM users").get() as any).cnt;

    return {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
      totalResults: total,
      startIndex,
      itemsPerPage: count,
      Resources: rows.map(userToScimResource),
    };
  });

  /** GET /scim/v2/Users/:id */
  app.get("/scim/v2/Users/:id", { preHandler: requireScimAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = getUserById(Number(id));
    if (!user) return reply.status(404).send({ detail: "User not found" });
    return userToScimResource(user);
  });

  /** POST /scim/v2/Users — Provision user */
  app.post("/scim/v2/Users", { preHandler: requireScimAuth }, async (request, reply) => {
    const body = request.body as any;
    const email = body.userName ?? body.emails?.[0]?.value;
    const name = body.name?.formatted ?? body.displayName ?? email;

    if (!email) {
      return reply.status(400).send({ detail: "userName or emails[0].value is required" });
    }

    try {
      // Generate random password for SCIM-provisioned users (they use SSO to login)
      const password = require("node:crypto").randomBytes(32).toString("hex");
      const user = createUser(email, name, password, "developer");

      // Assign to org if specified in enterprise extension
      const orgId = body["urn:ietf:params:scim:schemas:extension:enterprise:2.0:User"]?.organization;
      if (orgId) {
        db.prepare("UPDATE users SET org_id = ?, updated_at = ? WHERE id = ?").run(Number(orgId), Date.now(), user.id);
        // Assign default developer role
        const devRole = db.prepare("SELECT id FROM roles WHERE name = 'developer' AND org_id IS NULL").get() as any;
        if (devRole) assignOrgRole(user.id, Number(orgId), devRole.id);
      }

      return reply.status(201).send(userToScimResource(user));
    } catch (err: any) {
      if (err.message?.includes("UNIQUE")) {
        return reply.status(409).send({ detail: "User already exists", status: "409" });
      }
      return reply.status(500).send({ detail: err.message });
    }
  });

  /** PATCH /scim/v2/Users/:id — Update user */
  app.patch("/scim/v2/Users/:id", { preHandler: requireScimAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as any;
    const ops = body.Operations ?? [];
    const now = Date.now();

    for (const op of ops) {
      if (op.op === "replace" && op.path === "active" && op.value === false) {
        // Deactivation = soft delete (set role to 'auditor' with no access)
        db.prepare("UPDATE users SET role = 'auditor', updated_at = ? WHERE id = ?").run(now, Number(id));
      }
      if (op.op === "replace" && op.path === "name.formatted") {
        db.prepare("UPDATE users SET name = ?, updated_at = ? WHERE id = ?").run(op.value, now, Number(id));
      }
    }

    const user = getUserById(Number(id));
    if (!user) return reply.status(404).send({ detail: "User not found" });
    return userToScimResource(user);
  });

  /** DELETE /scim/v2/Users/:id — Deprovision user */
  app.delete("/scim/v2/Users/:id", { preHandler: requireScimAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = getUserById(Number(id));
    if (!user) return reply.status(404).send({ detail: "User not found" });
    deleteUser(Number(id));
    return reply.status(204).send();
  });

  // ── Groups (mapped to teams) ────────────────────────────────────────

  /** GET /scim/v2/Groups */
  app.get("/scim/v2/Groups", { preHandler: requireScimAuth }, async () => {
    const rows = db.prepare("SELECT * FROM teams ORDER BY id").all() as any[];
    return {
      schemas: ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
      totalResults: rows.length,
      Resources: rows.map((team) => {
        const members = db.prepare("SELECT user_id as userId FROM team_members WHERE team_id = ?").all(team.id) as any[];
        return teamToScimGroup(team, members);
      }),
    };
  });

  /** POST /scim/v2/Groups — Create group (team) */
  app.post("/scim/v2/Groups", { preHandler: requireScimAuth }, async (request, reply) => {
    const body = request.body as any;
    const displayName = body.displayName;
    if (!displayName) return reply.status(400).send({ detail: "displayName is required" });

    // Need an org context — use the first org or require it
    const org = db.prepare("SELECT id FROM organizations LIMIT 1").get() as any;
    if (!org) return reply.status(400).send({ detail: "No organization exists. Create one first." });

    const slug = displayName.toLowerCase().replace(/[^a-z0-9]/g, "-").slice(0, 50);

    try {
      const team = createTeam(org.id, displayName, slug);

      // Add members if provided
      const members = body.members ?? [];
      for (const m of members) {
        addTeamMember(team.id, Number(m.value), "member");
      }

      return reply.status(201).send(teamToScimGroup(team, members));
    } catch (err: any) {
      if (err.message?.includes("UNIQUE")) {
        return reply.status(409).send({ detail: "Group already exists" });
      }
      return reply.status(500).send({ detail: err.message });
    }
  });

  /** PATCH /scim/v2/Groups/:id — Update group membership */
  app.patch("/scim/v2/Groups/:id", { preHandler: requireScimAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as any;
    const ops = body.Operations ?? [];

    for (const op of ops) {
      if (op.op === "add" && op.path === "members") {
        for (const m of (op.value ?? [])) {
          try { addTeamMember(Number(id), Number(m.value), "member"); } catch { /* already member */ }
        }
      }
      if (op.op === "remove" && op.path?.startsWith("members[value eq")) {
        const userId = op.path.match(/eq "(\d+)"/)?.[1];
        if (userId) removeTeamMember(Number(id), Number(userId));
      }
    }

    const team = getTeamById(Number(id));
    if (!team) return reply.status(404).send({ detail: "Group not found" });
    const members = db.prepare("SELECT user_id as userId FROM team_members WHERE team_id = ?").all(Number(id)) as any[];
    return teamToScimGroup(team, members);
  });

  /** DELETE /scim/v2/Groups/:id */
  app.delete("/scim/v2/Groups/:id", { preHandler: requireScimAuth }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const deleted = deleteTeam(Number(id));
    if (!deleted) return reply.status(404).send({ detail: "Group not found" });
    return reply.status(204).send();
  });
}
