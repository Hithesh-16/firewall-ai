import { db } from "../db/index";
import { organizations, users } from "../db/schema";
import { Organization } from "../types";
import { eq, asc } from "drizzle-orm";

function rowToOrg(row: any): Organization {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    createdAt: row.createdAt
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

export function assignUserToOrg(userId: number, orgId: number): void {
  db.update(users).set({ orgId, updatedAt: Date.now() }).where(eq(users.id, userId)).run();
}

export function removeUserFromOrg(userId: number): void {
  db.update(users).set({ orgId: null, updatedAt: Date.now() }).where(eq(users.id, userId)).run();
}
