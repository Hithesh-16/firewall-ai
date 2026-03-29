import crypto from "node:crypto";
import { db } from "../db/index";
import { users, apiTokens } from "../db/schema";
import { ApiToken, Role, User } from "../types";
import { eq, and, asc } from "drizzle-orm";

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  const check = crypto.scryptSync(password, salt, 64).toString("hex");
  return hash === check;
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function generateToken(): string {
  return `afw_${crypto.randomBytes(32).toString("hex")}`;
}

// --- User management ---

export function createUser(
  email: string,
  name: string,
  password: string,
  role: Role = "developer",
  orgId: number | null = null
): User {
  const now = Date.now();
  const passwordHash = hashPassword(password);

  const result = db.insert(users).values({
    email,
    name,
    passwordHash,
    role,
    orgId,
    createdAt: now,
    updatedAt: now
  }).run();

  return {
    id: result.lastInsertRowid as number,
    email,
    name,
    role,
    orgId,
    createdAt: now,
    updatedAt: now
  };
}

export function authenticateUser(email: string, password: string): User | null {
  const row = db.select().from(users).where(eq(users.email, email)).get();

  if (!row) return null;
  if (!verifyPassword(password, row.passwordHash)) return null;

  return rowToUser(row);
}

export function getUserById(id: number): User | null {
  const row = db.select().from(users).where(eq(users.id, id)).get();
  return row ? rowToUser(row) : null;
}

export function getUsersByOrg(orgId: number): User[] {
  const rows = db.select().from(users).where(eq(users.orgId, orgId)).orderBy(asc(users.createdAt)).all();
  return rows.map(rowToUser);
}

export function updateUserRole(userId: number, role: Role): void {
  db.update(users).set({ role, updatedAt: Date.now() }).where(eq(users.id, userId)).run();
}

export function deleteUser(userId: number): void {
  db.delete(users).where(eq(users.id, userId)).run();
}

// --- API Token management ---

export function createApiToken(
  userId: number,
  name: string,
  expiresInDays?: number
): { token: string; record: ApiToken } {
  const raw = generateToken();
  const hashed = hashToken(raw);
  const now = Date.now();
  const expiresAt = expiresInDays ? now + expiresInDays * 86_400_000 : null;

  const result = db.insert(apiTokens).values({
    userId,
    tokenHash: hashed,
    name,
    createdAt: now,
    expiresAt
  }).run();

  return {
    token: raw,
    record: {
      id: result.lastInsertRowid as number,
      userId,
      tokenHash: hashed,
      name,
      lastUsedAt: null,
      createdAt: now,
      expiresAt
    }
  };
}

export function validateApiToken(raw: string): { user: User; token: ApiToken } | null {
  const hashed = hashToken(raw);
  const tokenRow = db.select().from(apiTokens).where(eq(apiTokens.tokenHash, hashed)).get();

  if (!tokenRow) return null;

  const token = rowToApiToken(tokenRow);

  if (token.expiresAt && token.expiresAt < Date.now()) return null;

  const user = getUserById(token.userId);
  if (!user) return null;

  db.update(apiTokens).set({ lastUsedAt: Date.now() }).where(eq(apiTokens.id, token.id)).run();

  return { user, token };
}

export function listApiTokens(userId: number): Array<Omit<ApiToken, "tokenHash">> {
  const rows = db.select({
    id: apiTokens.id,
    userId: apiTokens.userId,
    name: apiTokens.name,
    lastUsedAt: apiTokens.lastUsedAt,
    createdAt: apiTokens.createdAt,
    expiresAt: apiTokens.expiresAt
  }).from(apiTokens).where(eq(apiTokens.userId, userId)).all();
  
  return rows.map((r) => ({
    id: r.id as number,
    userId: r.userId as number,
    name: r.name as string,
    lastUsedAt: r.lastUsedAt as number | null,
    createdAt: r.createdAt as number,
    expiresAt: r.expiresAt as number | null
  }));
}

export function revokeApiToken(tokenId: number, userId: number): boolean {
  const result = db.delete(apiTokens).where(and(eq(apiTokens.id, tokenId), eq(apiTokens.userId, userId))).run();
  return result.changes > 0;
}

// --- Row mappers ---

function rowToUser(row: any): User {
  return {
    id: row.id as number,
    email: row.email as string,
    name: row.name as string,
    role: row.role as Role,
    orgId: (row.orgId as number | null) ?? null,
    createdAt: row.createdAt as number,
    updatedAt: row.updatedAt as number
  };
}

function rowToApiToken(row: any): ApiToken {
  return {
    id: row.id as number,
    userId: row.userId as number,
    tokenHash: row.tokenHash as string,
    name: row.name as string,
    lastUsedAt: (row.lastUsedAt as number | null) ?? null,
    createdAt: row.createdAt as number,
    expiresAt: (row.expiresAt as number | null) ?? null
  };
}
