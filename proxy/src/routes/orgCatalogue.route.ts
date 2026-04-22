import { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth, requireCapability } from "../auth/authMiddleware";
import { CAP } from "../auth/capabilities";
import {
  deleteCatalogueItem,
  getCatalogueItem,
  getCatalogueItemById,
  installCatalogueItem,
  listCatalogue,
  listCatalogueForUser,
  setSubscriptionEnabled,
  uninstallCatalogueItem,
  upsertCatalogueItem,
  type CatalogueKind,
} from "../gateway/orgCatalogueService";

/**
 * Org catalogue routes — rules + skills.
 *
 * Two audiences, two surfaces:
 *   - Org admins curate entries via `/api/orgs/:orgId/rules` and
 *     `/api/orgs/:orgId/skills` (requires `policies:edit`).
 *   - Authenticated users browse their org's catalogue and
 *     install/uninstall via `/api/me/rules` + `/api/me/skills`.
 *
 * The proxy `/api/me/assistant` handler reads subscribed rows to
 * materialise the assistant YAML; the IDE/CLI sync writes skills
 * to `~/.ai-firewall/skills/<slug>/SKILL.md` on disk.
 *
 * Personal rules / MCP servers / prompts live as local files on
 * the user's machine — they do NOT go through these routes.
 */

const upsertSchema = z.object({
  slug: z.string().min(1).max(80).optional(),
  title: z.string().min(1).max(200),
  description: z.string().max(500).nullable().optional(),
  body: z.string().min(1).max(200_000),
});

/**
 * Every list endpoint in the dashboard takes the same three query
 * params: `page` (1-based), `pageSize` (clamped [1, 100]), and
 * `search` (free-text). The proxy does the work — no client-side
 * filtering. Keeps the wire contract identical across every table
 * surface (users, roles, rules, skills) so `useServerTable` on the
 * web can stay generic.
 */
function parsePaginate(q: unknown): {
  page: number;
  pageSize: number;
  search: string;
} {
  const obj = (q as Record<string, unknown>) || {};
  const page = Number(obj.page) || 1;
  const pageSize = Number(obj.pageSize) || 20;
  const search = typeof obj.search === "string" ? obj.search : "";
  return { page, pageSize, search };
}

function checkOrgMembership(
  request: { authContext?: { user: { orgId: number | null } } },
  paramOrgId: string,
): { ok: true; orgId: number } | { ok: false; status: number; error: string } {
  const orgId = Number(paramOrgId);
  if (!Number.isInteger(orgId)) {
    return { ok: false, status: 400, error: "INVALID_ORG_ID" };
  }
  if (request.authContext?.user?.orgId !== orgId) {
    return { ok: false, status: 403, error: "NOT_A_MEMBER_OF_ORG" };
  }
  return { ok: true, orgId };
}

function registerAdminRoutes(
  app: FastifyInstance,
  kind: CatalogueKind,
  pathSegment: "rules" | "skills",
): void {
  const base = `/api/orgs/:orgId/${pathSegment}`;
  const preHandler = [requireAuth, requireCapability(CAP.policies_edit)];

  app.get<{ Params: { orgId: string } }>(
    base,
    { preHandler },
    async (request, reply) => {
      const check = checkOrgMembership(request, request.params.orgId);
      if (!check.ok)
        return reply.status(check.status).send({ error: check.error });
      return listCatalogue(kind, check.orgId, parsePaginate(request.query));
    },
  );

  app.post<{ Params: { orgId: string } }>(
    base,
    { preHandler },
    async (request, reply) => {
      const check = checkOrgMembership(request, request.params.orgId);
      if (!check.ok)
        return reply.status(check.status).send({ error: check.error });
      const parsed = upsertSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "INVALID_BODY", message: parsed.error.message });
      }
      try {
        const item = upsertCatalogueItem(kind, {
          orgId: check.orgId,
          slug: parsed.data.slug,
          title: parsed.data.title,
          description: parsed.data.description ?? null,
          body: parsed.data.body,
          createdBy: request.authContext?.user?.id ?? null,
        });
        return reply.status(201).send({ item });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "UNKNOWN";
        return reply.status(400).send({ error: "UPSERT_FAILED", message: msg });
      }
    },
  );

  app.put<{ Params: { orgId: string; slug: string } }>(
    `${base}/:slug`,
    { preHandler },
    async (request, reply) => {
      const check = checkOrgMembership(request, request.params.orgId);
      if (!check.ok)
        return reply.status(check.status).send({ error: check.error });
      const parsed = upsertSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "INVALID_BODY", message: parsed.error.message });
      }
      const item = upsertCatalogueItem(kind, {
        orgId: check.orgId,
        slug: request.params.slug,
        title: parsed.data.title,
        description: parsed.data.description ?? null,
        body: parsed.data.body,
        createdBy: request.authContext?.user?.id ?? null,
      });
      return { item };
    },
  );

  app.delete<{ Params: { orgId: string; slug: string } }>(
    `${base}/:slug`,
    { preHandler },
    async (request, reply) => {
      const check = checkOrgMembership(request, request.params.orgId);
      if (!check.ok)
        return reply.status(check.status).send({ error: check.error });
      const removed = deleteCatalogueItem(
        kind,
        check.orgId,
        request.params.slug,
      );
      if (!removed) return reply.status(404).send({ error: "NOT_FOUND" });
      return { deleted: true };
    },
  );
}

function registerUserRoutes(
  app: FastifyInstance,
  kind: CatalogueKind,
  pathSegment: "rules" | "skills",
): void {
  const base = `/api/me/${pathSegment}`;

  // List every item in the caller's org's catalogue along with the
  // caller's subscription status — one round-trip powers the entire
  // "browse + toggle" page.
  app.get(base, { preHandler: requireAuth }, async (request, reply) => {
    const user = request.authContext?.user;
    if (!user) return reply.status(401).send({ error: "UNAUTHENTICATED" });
    if (!user.orgId) {
      return { items: [], total: 0, page: 1, pageSize: 20, hasMore: false };
    }
    return listCatalogueForUser(
      kind,
      user.id,
      user.orgId,
      parsePaginate(request.query),
    );
  });

  // Get a single item by slug (for dashboard detail views + IDE
  // "show me the full markdown").
  app.get<{ Params: { slug: string } }>(
    `${base}/:slug`,
    { preHandler: requireAuth },
    async (request, reply) => {
      const user = request.authContext?.user;
      if (!user?.orgId) {
        return reply.status(404).send({ error: "NOT_FOUND" });
      }
      const item = getCatalogueItem(kind, user.orgId, request.params.slug);
      if (!item) return reply.status(404).send({ error: "NOT_FOUND" });
      return { item };
    },
  );

  app.post<{ Params: { id: string } }>(
    `${base}/:id/install`,
    { preHandler: requireAuth },
    async (request, reply) => {
      const user = request.authContext?.user;
      if (!user) return reply.status(401).send({ error: "UNAUTHENTICATED" });
      const id = Number(request.params.id);
      if (!Number.isInteger(id)) {
        return reply.status(400).send({ error: "INVALID_ID" });
      }
      const item = getCatalogueItemById(kind, id);
      if (!item) return reply.status(404).send({ error: "NOT_FOUND" });
      if (item.orgId !== user.orgId) {
        return reply.status(403).send({ error: "CROSS_ORG_FORBIDDEN" });
      }
      installCatalogueItem(kind, user.id, id);
      return { installed: true, item };
    },
  );

  app.delete<{ Params: { id: string } }>(
    `${base}/:id/install`,
    { preHandler: requireAuth },
    async (request, reply) => {
      const user = request.authContext?.user;
      if (!user) return reply.status(401).send({ error: "UNAUTHENTICATED" });
      const id = Number(request.params.id);
      if (!Number.isInteger(id)) {
        return reply.status(400).send({ error: "INVALID_ID" });
      }
      uninstallCatalogueItem(kind, user.id, id);
      return { uninstalled: true };
    },
  );

  app.patch<{ Params: { id: string } }>(
    `${base}/:id`,
    { preHandler: requireAuth },
    async (request, reply) => {
      const user = request.authContext?.user;
      if (!user) return reply.status(401).send({ error: "UNAUTHENTICATED" });
      const id = Number(request.params.id);
      if (!Number.isInteger(id)) {
        return reply.status(400).send({ error: "INVALID_ID" });
      }
      const parsed = z.object({ enabled: z.boolean() }).safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "INVALID_BODY" });
      }
      const updated = setSubscriptionEnabled(
        kind,
        user.id,
        id,
        parsed.data.enabled,
      );
      if (!updated) return reply.status(404).send({ error: "NOT_INSTALLED" });
      return { ok: true };
    },
  );
}

export async function registerOrgCatalogueRoutes(
  app: FastifyInstance,
): Promise<void> {
  registerAdminRoutes(app, "rule", "rules");
  registerAdminRoutes(app, "skill", "skills");
  registerUserRoutes(app, "rule", "rules");
  registerUserRoutes(app, "skill", "skills");
}
