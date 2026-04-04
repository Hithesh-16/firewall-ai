/**
 * PII Vault — Reversible PII Tokenization
 *
 * Replaces PII with deterministic tokens before sending to LLMs,
 * then restores original values in output. Zero-knowledge: nothing persists
 * after session destruction.
 * Single Responsibility: Only tokenizes/detokenizes PII. No scanning or policy.
 *
 * Technique:
 *   - HMAC-SHA256(sessionId + value) for deterministic token generation
 *   - Token format: <PII_{TYPE}_{6-char-hex}>
 *   - Same value always maps to same token within a session
 *   - Auto-expire sessions after configurable TTL (default 1 hour)
 */

import { createHmac } from "crypto";
import type { PiiMatch } from "@ai-firewall/scanner";

// ── Types ────────────────────────────────────────────────────────────────

export interface VaultSession {
  readonly id: string;
  readonly createdAt: number;
  readonly tokenMap: Map<string, string>;
  readonly reverseMap: Map<string, string>;
  readonly ttl: number;
}

export interface TokenizedResult {
  readonly text: string;
  readonly tokensApplied: number;
  readonly tokenMap: ReadonlyMap<string, string>;
}

// ── Configuration ────────────────────────────────────────────────────────

const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour

// ── Store ────────────────────────────────────────────────────────────────

const sessions: Map<string, VaultSession> = new Map();

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Generate a cryptographically random session ID.
 */
function generateSessionId(): string {
  const bytes = new Uint8Array(16);
  // Use crypto.createHmac with timestamp + counter for unique IDs
  const hmac = createHmac("sha256", "vault-session-seed");
  hmac.update(`${Date.now()}:${Math.random()}:${sessions.size}`);
  return `vs-${hmac.digest("hex").slice(0, 24)}`;
}

/**
 * Generate a deterministic 6-char hex token for a PII value within a session.
 * Uses HMAC-SHA256(sessionId + value), taking the first 6 hex characters.
 */
function generateToken(
  sessionId: string,
  piiType: string,
  value: string,
): string {
  const hmac = createHmac("sha256", sessionId);
  hmac.update(value);
  const hex = hmac.digest("hex").slice(0, 6);
  return `<PII_${piiType}_${hex}>`;
}

/**
 * Check if a session has expired based on its TTL.
 */
function isExpired(session: VaultSession): boolean {
  return Date.now() > session.createdAt + session.ttl;
}

/**
 * Remove all expired sessions from the store.
 */
function pruneExpiredSessions(): void {
  for (const [sessionId, session] of sessions) {
    if (isExpired(session)) {
      // Wipe maps before deleting for defense-in-depth
      session.tokenMap.clear();
      session.reverseMap.clear();
      sessions.delete(sessionId);
    }
  }
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Create a new vault session with a unique ID and empty token mappings.
 *
 * @param ttl - Session TTL in milliseconds (default: 1 hour)
 * @returns A new VaultSession
 */
export function createVaultSession(ttl = DEFAULT_TTL_MS): VaultSession {
  pruneExpiredSessions();

  const session: VaultSession = {
    id: generateSessionId(),
    createdAt: Date.now(),
    tokenMap: new Map(),
    reverseMap: new Map(),
    ttl,
  };

  sessions.set(session.id, session);
  return session;
}

/**
 * Replace each PII match in the text with a reversible token.
 * Deterministic: the same PII value always gets the same token within a session.
 *
 * @param session - The active vault session
 * @param text - Original text containing PII
 * @param piiMatches - Array of PII matches from the PII scanner
 * @returns Tokenized text with token mapping details
 * @throws Error if session is expired or not found
 */
export function tokenizePii(
  session: VaultSession,
  text: string,
  piiMatches: readonly PiiMatch[],
): TokenizedResult {
  const storedSession = sessions.get(session.id);
  if (!storedSession) {
    throw new Error(`Vault session not found: ${session.id}`);
  }
  if (isExpired(storedSession)) {
    destroySession(session.id);
    throw new Error(`Vault session expired: ${session.id}`);
  }

  if (piiMatches.length === 0) {
    return { text, tokensApplied: 0, tokenMap: new Map() };
  }

  // Sort matches by position descending so replacements don't shift indices
  const sorted = [...piiMatches].sort((a, b) => b.position - a.position);

  let tokenized = text;
  let tokensApplied = 0;

  for (const match of sorted) {
    // Check if we already have a token for this value
    const existingToken = storedSession.tokenMap.get(match.value);
    let token: string;

    if (existingToken) {
      token = existingToken;
    } else {
      token = generateToken(session.id, match.type, match.value);
      storedSession.tokenMap.set(match.value, token);
      storedSession.reverseMap.set(token, match.value);
    }

    // Replace at exact position
    const before = tokenized.slice(0, match.position);
    const after = tokenized.slice(match.position + match.length);
    tokenized = before + token + after;
    tokensApplied++;
  }

  return {
    text: tokenized,
    tokensApplied,
    tokenMap: new Map(storedSession.tokenMap),
  };
}

/**
 * Restore original PII values from tokens in the text.
 *
 * @param session - The active vault session
 * @param text - Text containing PII tokens
 * @returns Text with original PII values restored
 * @throws Error if session is expired or not found
 */
export function detokenizePii(session: VaultSession, text: string): string {
  const storedSession = sessions.get(session.id);
  if (!storedSession) {
    throw new Error(`Vault session not found: ${session.id}`);
  }
  if (isExpired(storedSession)) {
    destroySession(session.id);
    throw new Error(`Vault session expired: ${session.id}`);
  }

  let restored = text;

  // Replace all tokens with original values
  for (const [token, original] of storedSession.reverseMap) {
    // Use split+join for safe replacement (no regex special char issues)
    restored = restored.split(token).join(original);
  }

  return restored;
}

/**
 * Destroy a session and wipe all mappings. Zero-knowledge: nothing persists.
 *
 * @param sessionId - The session ID to destroy
 */
export function destroySession(sessionId: string): void {
  const session = sessions.get(sessionId);
  if (session) {
    session.tokenMap.clear();
    session.reverseMap.clear();
    sessions.delete(sessionId);
  }
}

/**
 * Get the number of active (non-expired) sessions.
 *
 * @returns Count of active sessions
 */
export function getActiveSessionCount(): number {
  pruneExpiredSessions();
  return sessions.size;
}

/**
 * Clear all sessions. Useful for testing.
 */
export function clearAllSessions(): void {
  for (const session of sessions.values()) {
    session.tokenMap.clear();
    session.reverseMap.clear();
  }
  sessions.clear();
}
