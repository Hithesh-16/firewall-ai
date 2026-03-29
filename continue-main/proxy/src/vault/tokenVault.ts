import crypto from "node:crypto";
import { db } from "../db/index";
import { tokenVault } from "../db/schema";
import { env } from "../config";
import { eq, lt, asc, desc, isNotNull, and } from "drizzle-orm";

let tableReady = false;

function init(): void {
  // We no longer need to dynamically create the table, the schema is handled by drizzle/migrations.
  tableReady = true;
}

function getMasterKey(): Buffer {
  const raw = env.MASTER_KEY ?? "default-dev-key-change-in-production!!";
  return crypto.createHash("sha256").update(raw).digest();
}

function encrypt(plaintext: string): { encrypted: string; iv: string; tag: string } {
  const key = getMasterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const tag = cipher.getAuthTag();
  return {
    encrypted,
    iv: iv.toString("hex"),
    tag: tag.toString("hex")
  };
}

function decrypt(encrypted: string, iv: string, tag: string): string {
  const key = getMasterKey();
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(iv, "hex")
  );
  decipher.setAuthTag(Buffer.from(tag, "hex"));
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

export function storeToken(
  originalValue: string,
  type: string,
  ttlSeconds?: number
): string {
  init();
  const tokenId = `VAULT_TOK_${crypto.randomBytes(6).toString("hex")}`;
  const { encrypted, iv, tag } = encrypt(originalValue);
  const now = Date.now();
  const expiresAt = ttlSeconds ? now + ttlSeconds * 1000 : null;

  db.insert(tokenVault).values({
    tokenId,
    encrypted,
    iv,
    tag,
    type,
    createdAt: now,
    expiresAt
  }).run();

  return `[${tokenId}]`;
}

export function resolveToken(tokenId: string): string | null {
  init();
  const clean = tokenId.replace(/^\[/, "").replace(/\]$/, "");
  
  const row = db.select({
    encrypted: tokenVault.encrypted,
    iv: tokenVault.iv,
    tag: tokenVault.tag,
    expiresAt: tokenVault.expiresAt
  }).from(tokenVault).where(eq(tokenVault.tokenId, clean)).get();

  if (!row) return null;
  if (row.expiresAt && row.expiresAt < Date.now()) {
    db.delete(tokenVault).where(eq(tokenVault.tokenId, clean)).run();
    return null;
  }

  return decrypt(row.encrypted, row.iv, row.tag);
}

export function redactReversible(
  text: string,
  matches: Array<{ type: string; value: string }>,
  ttlSeconds?: number
): string {
  let result = text;
  const sorted = [...matches].sort((a, b) => b.value.length - a.value.length);

  for (const match of sorted) {
    if (!match.value) continue;
    const token = storeToken(match.value, match.type, ttlSeconds);
    result = result.split(match.value).join(token);
  }

  return result;
}

export function purgeExpired(): number {
  init();
  const result = db.delete(tokenVault).where(
    and(isNotNull(tokenVault.expiresAt), lt(tokenVault.expiresAt, Date.now()))
  ).run();
  return result.changes;
}

export function listTokens(
  limit = 50,
  offset = 0
): Array<{ tokenId: string; type: string; createdAt: number; expired: boolean }> {
  init();
  const rows = db.select({
    tokenId: tokenVault.tokenId,
    type: tokenVault.type,
    createdAt: tokenVault.createdAt,
    expiresAt: tokenVault.expiresAt
  }).from(tokenVault).orderBy(desc(tokenVault.createdAt)).limit(limit).offset(offset).all();

  return rows.map((r) => ({
    tokenId: r.tokenId,
    type: r.type,
    createdAt: r.createdAt,
    expired: r.expiresAt ? r.expiresAt < Date.now() : false
  }));
}
