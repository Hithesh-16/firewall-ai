import crypto from "node:crypto";
import { db } from "../db/index";
import { users, apiTokens } from "../db/schema";
import { ApiToken, Role, TokenScope, User } from "../types";
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
  orgId: number | null = null,
): User {
  const now = Date.now();
  const passwordHash = hashPassword(password);

  const result = db
    .insert(users)
    .values({
      email,
      name,
      passwordHash,
      role,
      orgId,
      createdAt: now,
      updatedAt: now,
    })
    .run();

  return {
    id: result.lastInsertRowid as number,
    email,
    name,
    role,
    orgId,
    createdAt: now,
    updatedAt: now,
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
  const rows = db
    .select()
    .from(users)
    .where(eq(users.orgId, orgId))
    .orderBy(asc(users.createdAt))
    .all();
  return rows.map(rowToUser);
}

export function updateUserRole(userId: number, role: Role): void {
  db.update(users)
    .set({ role, updatedAt: Date.now() })
    .where(eq(users.id, userId))
    .run();
}

export function deleteUser(userId: number): void {
  db.delete(users).where(eq(users.id, userId)).run();
}

// --- API Token management ---

export function createApiToken(
  userId: number,
  name: string,
  options?: {
    expiresInDays?: number;
    scopes?: TokenScope[];
    orgId?: number;
    teamId?: number;
  },
): { token: string; record: ApiToken } {
  const raw = generateToken();
  const hashed = hashToken(raw);
  const now = Date.now();
  const expiresAt = options?.expiresInDays
    ? now + options.expiresInDays * 86_400_000
    : null;
  const scopesJson = options?.scopes ? JSON.stringify(options.scopes) : null;

  const result = db
    .insert(apiTokens)
    .values({
      userId,
      tokenHash: hashed,
      name,
      scopes: scopesJson,
      orgId: options?.orgId ?? null,
      teamId: options?.teamId ?? null,
      createdAt: now,
      expiresAt,
    })
    .run();

  return {
    token: raw,
    record: {
      id: result.lastInsertRowid as number,
      userId,
      tokenHash: hashed,
      name,
      scopes: options?.scopes ?? null,
      orgId: options?.orgId ?? null,
      teamId: options?.teamId ?? null,
      lastUsedAt: null,
      createdAt: now,
      expiresAt,
      rotatedFromId: null,
    },
  };
}

export function validateApiToken(
  raw: string,
): { user: User; token: ApiToken } | null {
  const hashed = hashToken(raw);
  const tokenRow = db
    .select()
    .from(apiTokens)
    .where(eq(apiTokens.tokenHash, hashed))
    .get();

  if (!tokenRow) return null;

  const token = rowToApiToken(tokenRow);

  if (token.expiresAt && token.expiresAt < Date.now()) return null;

  const user = getUserById(token.userId);
  if (!user) return null;

  db.update(apiTokens)
    .set({ lastUsedAt: Date.now() })
    .where(eq(apiTokens.id, token.id))
    .run();

  return { user, token };
}

/**
 * Check if a token has a specific scope.
 * Tokens with no scopes (null) or wildcard ("*") have full access.
 */
export function tokenHasScope(
  token: ApiToken,
  requiredScope: TokenScope,
): boolean {
  if (!token.scopes) return true; // null scopes = full access (backward compat)
  return token.scopes.includes("*") || token.scopes.includes(requiredScope);
}

/**
 * Rotate an API token: atomically revoke the old token and create a new one
 * with the same scopes, org/team binding, and a fresh expiry.
 */
export function rotateApiToken(
  oldTokenId: number,
  userId: number,
  expiresInDays?: number,
): { token: string; record: ApiToken } | null {
  const oldRow = db
    .select()
    .from(apiTokens)
    .where(and(eq(apiTokens.id, oldTokenId), eq(apiTokens.userId, userId)))
    .get();

  if (!oldRow) return null;

  const oldToken = rowToApiToken(oldRow);
  const raw = generateToken();
  const hashed = hashToken(raw);
  const now = Date.now();
  const expiresAt = expiresInDays
    ? now + expiresInDays * 86_400_000
    : oldToken.expiresAt
      ? now + (oldToken.expiresAt - oldToken.createdAt) // preserve original TTL
      : null;

  const scopesJson = oldToken.scopes ? JSON.stringify(oldToken.scopes) : null;

  const result = db
    .insert(apiTokens)
    .values({
      userId,
      tokenHash: hashed,
      name: oldToken.name,
      scopes: scopesJson,
      orgId: oldToken.orgId,
      teamId: oldToken.teamId,
      createdAt: now,
      expiresAt,
      rotatedFromId: oldTokenId,
    })
    .run();

  // Revoke old token
  db.delete(apiTokens).where(eq(apiTokens.id, oldTokenId)).run();

  return {
    token: raw,
    record: {
      id: result.lastInsertRowid as number,
      userId,
      tokenHash: hashed,
      name: oldToken.name,
      scopes: oldToken.scopes,
      orgId: oldToken.orgId,
      teamId: oldToken.teamId,
      lastUsedAt: null,
      createdAt: now,
      expiresAt,
      rotatedFromId: oldTokenId,
    },
  };
}

export function listApiTokens(
  userId: number,
): Array<Omit<ApiToken, "tokenHash">> {
  const rows = db
    .select({
      id: apiTokens.id,
      userId: apiTokens.userId,
      name: apiTokens.name,
      scopes: apiTokens.scopes,
      orgId: apiTokens.orgId,
      teamId: apiTokens.teamId,
      lastUsedAt: apiTokens.lastUsedAt,
      createdAt: apiTokens.createdAt,
      expiresAt: apiTokens.expiresAt,
      rotatedFromId: apiTokens.rotatedFromId,
    })
    .from(apiTokens)
    .where(eq(apiTokens.userId, userId))
    .all();

  return rows.map((r) => {
    let scopes: TokenScope[] | null = null;
    if (r.scopes) {
      try {
        scopes = JSON.parse(r.scopes as string) as TokenScope[];
      } catch {
        scopes = null;
      }
    }
    return {
      id: r.id as number,
      userId: r.userId as number,
      name: r.name as string,
      scopes,
      orgId: (r.orgId as number | null) ?? null,
      teamId: (r.teamId as number | null) ?? null,
      lastUsedAt: r.lastUsedAt as number | null,
      createdAt: r.createdAt as number,
      expiresAt: r.expiresAt as number | null,
      rotatedFromId: (r.rotatedFromId as number | null) ?? null,
    };
  });
}

export function revokeApiToken(tokenId: number, userId: number): boolean {
  const result = db
    .delete(apiTokens)
    .where(and(eq(apiTokens.id, tokenId), eq(apiTokens.userId, userId)))
    .run();
  return result.changes > 0;
}

export function revokeAllUserTokens(userId: number): number {
  const result = db.delete(apiTokens).where(eq(apiTokens.userId, userId)).run();
  return result.changes;
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
    updatedAt: row.updatedAt as number,
  };
}

function rowToApiToken(row: any): ApiToken {
  let scopes: TokenScope[] | null = null;
  if (row.scopes) {
    try {
      scopes = JSON.parse(row.scopes as string) as TokenScope[];
    } catch {
      scopes = null;
    }
  }

  return {
    id: row.id as number,
    userId: row.userId as number,
    tokenHash: row.tokenHash as string,
    name: row.name as string,
    scopes,
    orgId: (row.orgId as number | null) ?? null,
    teamId: (row.teamId as number | null) ?? null,
    lastUsedAt: (row.lastUsedAt as number | null) ?? null,
    createdAt: row.createdAt as number,
    expiresAt: (row.expiresAt as number | null) ?? null,
    rotatedFromId: (row.rotatedFromId as number | null) ?? null,
  };
}
