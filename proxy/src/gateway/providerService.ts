import { db } from "../db/index";
import { providers } from "../db/schema";
import { Provider } from "../types";
import { decrypt, encrypt } from "../vault/encryption";
import { eq, asc } from "drizzle-orm";

function toProvider(row: any): Provider {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    baseUrl: row.baseUrl,
    apiKeyEncrypted: row.apiKeyEncrypted,
    enabled: row.enabled === 1,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function createProvider(
  name: string,
  apiKey: string,
  baseUrl: string
): Provider {
  const slug = slugify(name);
  const now = Date.now();
  const encrypted = encrypt(apiKey);

  const result = db.insert(providers).values({
    name,
    slug,
    baseUrl,
    apiKeyEncrypted: encrypted,
    enabled: 1,
    createdAt: now,
    updatedAt: now
  }).run();
  
  return getProviderById(Number(result.lastInsertRowid))!;
}

export function listProviders(): Provider[] {
  const rows = db.select().from(providers).orderBy(asc(providers.name)).all();
  return rows.map(toProvider);
}

export function getProviderById(id: number): Provider | null {
  const row = db.select().from(providers).where(eq(providers.id, id)).get();
  return row ? toProvider(row) : null;
}

export function getProviderBySlug(slug: string): Provider | null {
  const row = db.select().from(providers).where(eq(providers.slug, slug)).get();
  return row ? toProvider(row) : null;
}

export function updateProvider(
  id: number,
  updates: { name?: string; baseUrl?: string; apiKey?: string; enabled?: boolean }
): Provider | null {
  const provider = getProviderById(id);
  if (!provider) return null;

  const now = Date.now();
  const setObj: Record<string, any> = { updatedAt: now };

  if (updates.name !== undefined) {
    setObj.name = updates.name;
    setObj.slug = slugify(updates.name);
  }
  if (updates.baseUrl !== undefined) {
    setObj.baseUrl = updates.baseUrl;
  }
  if (updates.apiKey !== undefined) {
    setObj.apiKeyEncrypted = encrypt(updates.apiKey);
  }
  if (updates.enabled !== undefined) {
    setObj.enabled = updates.enabled ? 1 : 0;
  }

  db.update(providers).set(setObj).where(eq(providers.id, id)).run();

  return getProviderById(id);
}

export function deleteProvider(id: number): boolean {
  const result = db.delete(providers).where(eq(providers.id, id)).run();
  return result.changes > 0;
}

export function decryptProviderKey(provider: Provider): string {
  return decrypt(provider.apiKeyEncrypted);
}
