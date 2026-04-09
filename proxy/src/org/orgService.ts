import { db } from "../db/index";
import { organizations, users } from "../db/schema";
import { Organization } from "../types";
import { eq, asc } from "drizzle-orm";

function rowToOrg(row: any): Organization {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    industry: (row.industry as string | null | undefined) ?? null,
    createdAt: row.createdAt,
  };
}

export function createOrg(name: string, slug: string): Organization {
  const now = Date.now();
  const result = db.insert(organizations).values({
    name,
    slug,
    createdAt: now
  }).run();

  return { id: Number(result.lastInsertRowid), name, slug, createdAt: now };
}

export function getOrgById(id: number): Organization | null {
  const row = db.select().from(organizations).where(eq(organizations.id, id)).get();
  return row ? rowToOrg(row) : null;
}

export function getOrgBySlug(slug: string): Organization | null {
  const row = db.select().from(organizations).where(eq(organizations.slug, slug)).get();
  return row ? rowToOrg(row) : null;
}

export function listOrgs(): Organization[] {
  const rows = db.select().from(organizations).orderBy(asc(organizations.createdAt)).all();
  return rows.map(rowToOrg);
}

export function deleteOrg(id: number): boolean {
  const result = db.delete(organizations).where(eq(organizations.id, id)).run();
  return result.changes > 0;
}

/**
 * Update an org's display name, slug, and/or industry. Returns the
 * refreshed row or `null` if the org doesn't exist.
 *
 * Leaving a field `undefined` means "don't change it". Passing an
 * explicit empty string for `industry` clears the field.
 */
export function updateOrg(
  id: number,
  patch: { name?: string; slug?: string; industry?: string | null },
): Organization | null {
  const set: Record<string, unknown> = {};
  if (typeof patch.name === "string" && patch.name.trim().length > 0) {
    set.name = patch.name.trim();
  }
  if (typeof patch.slug === "string" && patch.slug.trim().length > 0) {
    set.slug = patch.slug.trim();
  }
  if (patch.industry !== undefined) {
    set.industry =
      typeof patch.industry === "string" && patch.industry.trim().length > 0
        ? patch.industry.trim()
        : null;
  }
  if (Object.keys(set).length === 0) {
    return getOrgById(id);
  }
  db.update(organizations).set(set).where(eq(organizations.id, id)).run();
  return getOrgById(id);
}

export function assignUserToOrg(userId: number, orgId: number): void {
  db.update(users).set({ orgId, updatedAt: Date.now() }).where(eq(users.id, userId)).run();
}

export function removeUserFromOrg(userId: number): void {
  db.update(users).set({ orgId: null, updatedAt: Date.now() }).where(eq(users.id, userId)).run();
}
