/**
 * AES-256-GCM Encryption with Key Rotation Support
 *
 * Supports multiple key versions:
 *   - v1: MASTER_KEY (original, default)
 *   - v2: MASTER_KEY_V2 (rotation target)
 *
 * Encrypted values are tagged with version prefix: "v2:iv:authTag:encrypted"
 * Values without a version prefix are treated as v1 (backward compat).
 *
 * Key rotation: decrypt with old key, re-encrypt with new key.
 */

import crypto from "node:crypto";
import { env } from "../config";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

const CURRENT_VERSION = (env as any).MASTER_KEY_V2 ? 2 : 1;

function deriveKey(version: number = CURRENT_VERSION): Buffer {
  const masterKey = version === 2
    ? ((env as any).MASTER_KEY_V2 ?? env.MASTER_KEY)
    : env.MASTER_KEY;

  if (!masterKey) {
    throw new Error(
      "MASTER_KEY is not set. Required for API key encryption. Add MASTER_KEY to .env"
    );
  }
  return crypto.scryptSync(masterKey, `ai-firewall-vault-v${version}`, KEY_LENGTH);
}

/**
 * Encrypt plaintext with the current key version.
 * Output format: "v{version}:{iv}:{authTag}:{encrypted}" or "{iv}:{authTag}:{encrypted}" for v1.
 */
export function encrypt(plaintext: string): string {
  const key = deriveKey(CURRENT_VERSION);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag();

  const payload = [iv.toString("hex"), authTag.toString("hex"), encrypted].join(":");

  // Tag with version for v2+, omit for v1 (backward compat)
  if (CURRENT_VERSION >= 2) {
    return `v${CURRENT_VERSION}:${payload}`;
  }
  return payload;
}

/**
 * Decrypt ciphertext, auto-detecting key version from prefix.
 */
export function decrypt(ciphertext: string): string {
  let version = 1;
  let payload = ciphertext;

  // Detect version prefix
  const versionMatch = ciphertext.match(/^v(\d+):/);
  if (versionMatch) {
    version = parseInt(versionMatch[1], 10);
    payload = ciphertext.slice(versionMatch[0].length);
  }

  const parts = payload.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted value format");
  }

  const [ivHex, authTagHex, encryptedHex] = parts;
  const key = deriveKey(version);
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encryptedHex, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

/**
 * Re-encrypt a value from its current key version to the target version.
 * Returns null if the value is already at the target version.
 */
export function rotateEncryptedValue(ciphertext: string, targetVersion: number = CURRENT_VERSION): string | null {
  // Detect current version
  const versionMatch = ciphertext.match(/^v(\d+):/);
  const currentVersion = versionMatch ? parseInt(versionMatch[1], 10) : 1;

  if (currentVersion === targetVersion) return null; // Already at target

  // Decrypt with old key, re-encrypt with new key
  const plaintext = decrypt(ciphertext);

  const key = deriveKey(targetVersion);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag();

  const payload = [iv.toString("hex"), authTag.toString("hex"), encrypted].join(":");
  return targetVersion >= 2 ? `v${targetVersion}:${payload}` : payload;
}

/**
 * Get the current encryption key version.
 */
export function getCurrentKeyVersion(): number {
  return CURRENT_VERSION;
}
