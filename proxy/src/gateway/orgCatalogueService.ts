import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import sqliteDatabase from "../db/database";

/**
 * Org-curated catalogue service — shared between rules and skills.
 *
 * Both concepts are the same shape (slug + title + markdown body,
 * scoped to an org, installable per-user). Admins author a row;
 * users "install" it to create a subscription. The proxy uses
 * subscriptions to assemble the per-user assistant YAML and the
 * on-disk skills directory.
 *
 * Why two tables instead of one generic `catalogue_items` + type
 * column: queries are simpler (no WHERE filter per lookup), the
 * subscription tables have explicit foreign keys so cascades Just
 * Work, and future divergence (e.g. skills get a `tools:` field)
 * is a single ALTER instead of a type system overhaul.
 *
 * Personal rules / MCP servers / prompts live as LOCAL FILES on
 * the user's machine and never go through this service.
 */

const raw = sqliteDatabase;

export type CatalogueKind = "rule" | "skill";

export interface CatalogueItem {
  id: number;
  orgId: number;
  slug: string;
  title: string;
  description: string | null;
  body: string;
  createdBy: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface CatalogueItemWithSub extends CatalogueItem {
  installed: boolean;
  enabled: boolean;
}

function tableFor(kind: CatalogueKind): string {
  return kind === "rule" ? "org_rules" : "org_skills";
}
function subTableFor(kind: CatalogueKind): string {
  return kind === "rule"
    ? "user_rule_subscriptions"
    : "user_skill_subscriptions";
}
function refColFor(kind: CatalogueKind): string {
  return kind === "rule" ? "org_rule_id" : "org_skill_id";
}

function rowToItem(row: {
  id: number;
  org_id: number;
  slug: string;
  title: string;
  description: string | null;
  body: string;
  created_by: number | null;
  created_at: number;
  updated_at: number;
}): CatalogueItem {
  return {
    id: row.id,
    orgId: row.org_id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    body: row.body,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Normalise to lowercase kebab-case. Admin's input might be arbitrary. */
function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 80);
}

// ─── Admin CRUD (operates on org_rules / org_skills) ────────────

/**
 * Contract for every paginated list returned by this service.
 * Mirrors the shape used by `/api/admin/users` and `/api/roles` so
 * the web's `useServerTable` hook can consume either endpoint
 * without branching.
 */
export interface PaginatedCatalogue {
  items: CatalogueItem[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface PaginatedCatalogueWithSub extends Omit<
  PaginatedCatalogue,
  "items"
> {
  items: CatalogueItemWithSub[];
}

export interface PaginateOptions {
  page?: number; // 1-based
  pageSize?: number; // clamped [1, 100]
  search?: string; // case-insensitive match on title / slug / description
}

function resolvePagination(opts: PaginateOptions): {
  page: number;
  pageSize: number;
  offset: number;
  search: string;
} {
  const page = Math.max(1, Math.floor(opts.page ?? 1));
  const pageSize = Math.min(100, Math.max(1, Math.floor(opts.pageSize ?? 20)));
  const offset = (page - 1) * pageSize;
  const search = (opts.search ?? "").trim();
  return { page, pageSize, offset, search };
}

/**
 * Server-side escape for LIKE wildcards. The API accepts an arbitrary
 * user search string; we still bind it as a parameter to avoid SQL
 * injection, but `%` and `_` inside the string would surprise users
 * (they mean "any chars" / "any char" in SQL) so we escape them.
 */
function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, "\\$&");
}

export function listCatalogue(
  kind: CatalogueKind,
  orgId: number,
  opts: PaginateOptions = {},
): PaginatedCatalogue {
  const { page, pageSize, offset, search } = resolvePagination(opts);
  const table = tableFor(kind);

  const whereClauses: string[] = ["org_id = ?"];
  const whereParams: unknown[] = [orgId];
  if (search.length > 0) {
    const like = `%${escapeLike(search)}%`;
    whereClauses.push(
      "(LOWER(title) LIKE LOWER(?) ESCAPE '\\' OR " +
        "LOWER(slug) LIKE LOWER(?) ESCAPE '\\' OR " +
        "LOWER(IFNULL(description, '')) LIKE LOWER(?) ESCAPE '\\')",
    );
    whereParams.push(like, like, like);
  }

  const whereSql = whereClauses.join(" AND ");

  const totalRow = raw
    .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${whereSql}`)
    .get(...whereParams) as { n: number };

  const rows = raw
    .prepare(
      `SELECT id, org_id, slug, title, description, body,
              created_by, created_at, updated_at
         FROM ${table}
        WHERE ${whereSql}
        ORDER BY title
        LIMIT ? OFFSET ?`,
    )
    .all(...whereParams, pageSize, offset) as Array<
    Parameters<typeof rowToItem>[0]
  >;

  return {
    items: rows.map(rowToItem),
    total: totalRow.n,
    page,
    pageSize,
    hasMore: offset + rows.length < totalRow.n,
  };
}

export function getCatalogueItem(
  kind: CatalogueKind,
  orgId: number,
  slug: string,
): CatalogueItem | null {
  const row = raw
    .prepare(
      `SELECT id, org_id, slug, title, description, body,
              created_by, created_at, updated_at
         FROM ${tableFor(kind)}
        WHERE org_id = ? AND slug = ?`,
    )
    .get(orgId, slug) as Parameters<typeof rowToItem>[0] | undefined;
  return row ? rowToItem(row) : null;
}

export function getCatalogueItemById(
  kind: CatalogueKind,
  id: number,
): CatalogueItem | null {
  const row = raw
    .prepare(
      `SELECT id, org_id, slug, title, description, body,
              created_by, created_at, updated_at
         FROM ${tableFor(kind)}
        WHERE id = ?`,
    )
    .get(id) as Parameters<typeof rowToItem>[0] | undefined;
  return row ? rowToItem(row) : null;
}

export interface UpsertInput {
  orgId: number;
  slug?: string;
  title: string;
  description?: string | null;
  body: string;
  createdBy: number | null;
}

export function upsertCatalogueItem(
  kind: CatalogueKind,
  input: UpsertInput,
): CatalogueItem {
  const now = Date.now();
  const slug = slugify(input.slug || input.title);
  if (!slug) {
    throw new Error("slug cannot be empty — provide a title or explicit slug");
  }
  raw
    .prepare(
      `INSERT INTO ${tableFor(kind)} (
         org_id, slug, title, description, body,
         created_by, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(org_id, slug) DO UPDATE SET
         title = excluded.title,
         description = excluded.description,
         body = excluded.body,
         updated_at = excluded.updated_at`,
    )
    .run(
      input.orgId,
      slug,
      input.title,
      input.description ?? null,
      input.body,
      input.createdBy,
      now,
      now,
    );
  const stored = getCatalogueItem(kind, input.orgId, slug);
  if (!stored) {
    throw new Error("Failed to fetch catalogue item after upsert");
  }
  return stored;
}

export function deleteCatalogueItem(
  kind: CatalogueKind,
  orgId: number,
  slug: string,
): boolean {
  const result = raw
    .prepare(`DELETE FROM ${tableFor(kind)} WHERE org_id = ? AND slug = ?`)
    .run(orgId, slug);
  return result.changes > 0;
}

// ─── User subscriptions ─────────────────────────────────────────

export function listCatalogueForUser(
  kind: CatalogueKind,
  userId: number,
  orgId: number,
  opts: PaginateOptions = {},
): PaginatedCatalogueWithSub {
  const { page, pageSize, offset, search } = resolvePagination(opts);
  const table = tableFor(kind);
  const subTable = subTableFor(kind);
  const refCol = refColFor(kind);

  const whereClauses: string[] = ["c.org_id = ?"];
  const whereParams: unknown[] = [orgId];
  if (search.length > 0) {
    const like = `%${escapeLike(search)}%`;
    whereClauses.push(
      "(LOWER(c.title) LIKE LOWER(?) ESCAPE '\\' OR " +
        "LOWER(c.slug) LIKE LOWER(?) ESCAPE '\\' OR " +
        "LOWER(IFNULL(c.description, '')) LIKE LOWER(?) ESCAPE '\\')",
    );
    whereParams.push(like, like, like);
  }

  const whereSql = whereClauses.join(" AND ");

  const totalRow = raw
    .prepare(`SELECT COUNT(*) AS n FROM ${table} c WHERE ${whereSql}`)
    .get(...whereParams) as { n: number };

  const rows = raw
    .prepare(
      `SELECT c.id, c.org_id, c.slug, c.title, c.description, c.body,
              c.created_by, c.created_at, c.updated_at,
              s.enabled AS sub_enabled
         FROM ${table} c
    LEFT JOIN ${subTable} s
           ON s.${refCol} = c.id AND s.user_id = ?
        WHERE ${whereSql}
        ORDER BY c.title
        LIMIT ? OFFSET ?`,
    )
    .all(userId, ...whereParams, pageSize, offset) as Array<
    Parameters<typeof rowToItem>[0] & { sub_enabled: number | null }
  >;

  const items = rows.map((r) => ({
    ...rowToItem(r),
    installed: r.sub_enabled !== null,
    enabled: r.sub_enabled === 1,
  }));

  return {
    items,
    total: totalRow.n,
    page,
    pageSize,
    hasMore: offset + items.length < totalRow.n,
  };
}

export function listSubscribedItems(
  kind: CatalogueKind,
  userId: number,
): CatalogueItem[] {
  const rows = raw
    .prepare(
      `SELECT c.id, c.org_id, c.slug, c.title, c.description, c.body,
              c.created_by, c.created_at, c.updated_at
         FROM ${tableFor(kind)} c
         JOIN ${subTableFor(kind)} s
           ON s.${refColFor(kind)} = c.id
        WHERE s.user_id = ? AND s.enabled = 1
        ORDER BY c.title`,
    )
    .all(userId) as Array<Parameters<typeof rowToItem>[0]>;
  return rows.map(rowToItem);
}

export function installCatalogueItem(
  kind: CatalogueKind,
  userId: number,
  itemId: number,
): boolean {
  const now = Date.now();
  const result = raw
    .prepare(
      `INSERT INTO ${subTableFor(kind)} (user_id, ${refColFor(kind)}, enabled, subscribed_at)
       VALUES (?, ?, 1, ?)
       ON CONFLICT(user_id, ${refColFor(kind)}) DO UPDATE SET
         enabled = 1,
         subscribed_at = excluded.subscribed_at`,
    )
    .run(userId, itemId, now);

  // Mirror the subscribed content to `~/.ai-firewall/` so the IDE
  // and CLI pick it up from disk — same folder layout power users
  // already use for hand-authored personal rules/skills.
  try {
    const item = getCatalogueItemById(kind, itemId);
    if (item) {
      writeCatalogueFile(kind, item);
    }
  } catch {
    /* best-effort — DB subscription is authoritative */
  }
  return result.changes > 0;
}

export function uninstallCatalogueItem(
  kind: CatalogueKind,
  userId: number,
  itemId: number,
): boolean {
  // Fetch the item first so we know which file to remove — after
  // the delete the row is gone from the catalogue if this was the
  // last subscriber AND the admin deleted it concurrently (rare).
  const item = getCatalogueItemById(kind, itemId);
  const result = raw
    .prepare(
      `DELETE FROM ${subTableFor(kind)}
        WHERE user_id = ? AND ${refColFor(kind)} = ?`,
    )
    .run(userId, itemId);

  if (result.changes > 0 && item) {
    try {
      removeCatalogueFile(kind, item.slug);
    } catch {
      /* best-effort */
    }
  }
  return result.changes > 0;
}

// ─── Filesystem mirroring ───────────────────────────────────────
//
// Every installed catalogue item is written to `~/.ai-firewall/`
// so the IDE + CLI pick them up without the extra round-trip of
// fetching from the proxy. Layout:
//
//   ~/.ai-firewall/rules/<slug>.md
//   ~/.ai-firewall/skills/<slug>/SKILL.md
//
// Each generated file carries a tracking marker on line 1 so we
// can safely delete on uninstall without clobbering a hand-authored
// file at the same slug.

const TRACKING_MARKER = "<!-- ai-firewall:managed -->";

function rootDir(): string {
  return (
    process.env.AI_FIREWALL_GLOBAL_DIR ||
    path.join(os.homedir(), ".ai-firewall")
  );
}

function pathForItem(kind: CatalogueKind, slug: string): string {
  const root = rootDir();
  if (kind === "rule") return path.join(root, "rules", `${slug}.md`);
  return path.join(root, "skills", slug, "SKILL.md");
}

function isManagedFile(filePath: string): boolean {
  try {
    if (!fs.existsSync(filePath)) return false;
    const head = fs.readFileSync(filePath, "utf8").slice(0, 200);
    return head.includes(TRACKING_MARKER);
  } catch {
    return false;
  }
}

function writeCatalogueFile(kind: CatalogueKind, item: CatalogueItem): void {
  const target = pathForItem(kind, item.slug);
  const dir = path.dirname(target);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  // Don't clobber a hand-authored file that happens to share the
  // slug. If the existing file isn't managed by us, skip — users
  // who want to install over a custom one can rename/delete theirs.
  if (fs.existsSync(target) && !isManagedFile(target)) {
    return;
  }

  const header = `${TRACKING_MARKER}\n<!-- slug: ${item.slug} -->\n`;
  const titleLine = `# ${item.title}\n`;
  const descLine = item.description ? `\n> ${item.description}\n` : "";
  const body = `${header}\n${titleLine}${descLine}\n${item.body.trimEnd()}\n`;
  const tmp = target + ".tmp";
  fs.writeFileSync(tmp, body, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tmp, target);
}

function removeCatalogueFile(kind: CatalogueKind, slug: string): void {
  const target = pathForItem(kind, slug);
  if (!fs.existsSync(target)) return;
  if (!isManagedFile(target)) return;
  try {
    fs.unlinkSync(target);
  } catch {
    /* ignore */
  }
  // Clean up the containing skills/<slug>/ directory if empty.
  if (kind === "skill") {
    const dir = path.dirname(target);
    try {
      const remaining = fs.readdirSync(dir);
      if (remaining.length === 0) fs.rmdirSync(dir);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Rewrite every currently-subscribed file to disk. Used by sync
 * flows that want to guarantee the filesystem matches the DB (e.g.
 * after a `cn sync` or an IDE sign-in).
 */
export function reconcileCatalogueFiles(
  kind: CatalogueKind,
  userId: number,
): void {
  const items = listSubscribedItems(kind, userId);
  for (const item of items) {
    try {
      writeCatalogueFile(kind, item);
    } catch {
      /* best-effort — skip items we can't write */
    }
  }
}

export function setSubscriptionEnabled(
  kind: CatalogueKind,
  userId: number,
  itemId: number,
  enabled: boolean,
): boolean {
  const result = raw
    .prepare(
      `UPDATE ${subTableFor(kind)}
          SET enabled = ?
        WHERE user_id = ? AND ${refColFor(kind)} = ?`,
    )
    .run(enabled ? 1 : 0, userId, itemId);
  return result.changes > 0;
}
