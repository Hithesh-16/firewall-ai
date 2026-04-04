/**
 * Multi-Turn Attack Tracker
 *
 * Detects prompt injection campaigns across multiple conversation turns.
 * Each message may look benign alone but the sequence reveals malicious intent.
 * Single Responsibility: Only tracks turn-level escalation patterns. No policy decisions.
 *
 * Patterns detected:
 *   - Escalation: 3+ turns with rising risk scores
 *   - Pivot: sudden category changes (>60% different) between adjacent turns
 *   - Repetition: same text fingerprint appearing 3+ times
 */

import { createHash } from "crypto";

// ── Types ────────────────────────────────────────────────────────────────

export interface TurnSummary {
  readonly timestamp: number;
  readonly riskScore: number;
  readonly categories: readonly string[];
  readonly fingerprint: string;
}

export type TurnPattern = "escalation" | "pivot" | "repetition" | "normal";

export interface MultiTurnResult {
  readonly isEscalation: boolean;
  readonly sessionRiskScore: number;
  readonly turnCount: number;
  readonly pattern: TurnPattern;
  readonly turns: readonly TurnSummary[];
}

export interface ScanResultInput {
  readonly score: number;
  readonly matches: readonly { readonly pattern: string }[];
}

interface TurnState {
  readonly summary: TurnSummary;
  readonly expiresAt: number;
}

// ── Configuration ────────────────────────────────────────────────────────

const DEFAULT_TTL_MS = 30 * 60 * 1000; // 30 minutes
const ESCALATION_MIN_TURNS = 3;
const REPETITION_THRESHOLD = 3;
const PIVOT_CATEGORY_CHANGE_RATIO = 0.6;

// ── Session Store ────────────────────────────────────────────────────────

const sessionStore = new Map<string, TurnState[]>();

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Compute a SHA-256 fingerprint for the given text.
 * Normalizes whitespace and lowercases before hashing.
 */
function computeFingerprint(text: string): string {
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
  return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

/**
 * Compute the Jaccard distance between two category sets.
 * Returns a ratio [0, 1] of how different the sets are.
 */
function categoryChangeRatio(
  prev: readonly string[],
  curr: readonly string[],
): number {
  if (prev.length === 0 && curr.length === 0) return 0;
  const prevSet = new Set(prev);
  const currSet = new Set(curr);
  const union = new Set([...prevSet, ...currSet]);
  const intersection = [...prevSet].filter((c) => currSet.has(c));
  if (union.size === 0) return 0;
  return 1 - intersection.length / union.size;
}

/**
 * Detect escalation: 3+ consecutive turns with non-decreasing risk
 * where at least one increase occurs.
 */
function detectEscalation(turns: readonly TurnSummary[]): boolean {
  if (turns.length < ESCALATION_MIN_TURNS) return false;
  const recent = turns.slice(-ESCALATION_MIN_TURNS);
  let hasIncrease = false;
  for (let i = 1; i < recent.length; i++) {
    if (recent[i].riskScore < recent[i - 1].riskScore) return false;
    if (recent[i].riskScore > recent[i - 1].riskScore) hasIncrease = true;
  }
  return hasIncrease;
}

/**
 * Detect pivot: adjacent turns with >60% category change.
 */
function detectPivot(turns: readonly TurnSummary[]): boolean {
  if (turns.length < 2) return false;
  const last = turns[turns.length - 1];
  const prev = turns[turns.length - 2];
  return (
    categoryChangeRatio(prev.categories, last.categories) >
    PIVOT_CATEGORY_CHANGE_RATIO
  );
}

/**
 * Detect repetition: same fingerprint appearing 3+ times.
 */
function detectRepetition(turns: readonly TurnSummary[]): boolean {
  const counts = new Map<string, number>();
  for (const turn of turns) {
    const count = (counts.get(turn.fingerprint) ?? 0) + 1;
    counts.set(turn.fingerprint, count);
    if (count >= REPETITION_THRESHOLD) return true;
  }
  return false;
}

/**
 * Compute an aggregate session risk score from all turns.
 * Weighted toward recent turns using exponential decay.
 */
function computeSessionRisk(turns: readonly TurnSummary[]): number {
  if (turns.length === 0) return 0;
  let weightedSum = 0;
  let totalWeight = 0;
  for (let i = 0; i < turns.length; i++) {
    const recency = Math.pow(1.5, i - turns.length + 1);
    weightedSum += turns[i].riskScore * recency;
    totalWeight += recency;
  }
  return Math.min(Math.round(weightedSum / totalWeight), 100);
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Record a conversation turn and evaluate multi-turn attack patterns.
 *
 * @param sessionId - Unique session identifier
 * @param text - The user's prompt text
 * @param scanResult - Output from the prompt injection scanner
 * @param ttlMs - Session TTL in milliseconds (default 30 minutes)
 * @returns Multi-turn analysis result
 */
export function trackTurn(
  sessionId: string,
  text: string,
  scanResult: ScanResultInput,
  ttlMs: number = DEFAULT_TTL_MS,
): MultiTurnResult {
  const now = Date.now();
  const fingerprint = computeFingerprint(text);
  const categories = [...new Set(scanResult.matches.map((m) => m.pattern))];

  const newTurn: TurnState = {
    summary: {
      timestamp: now,
      riskScore: scanResult.score,
      categories,
      fingerprint,
    },
    expiresAt: now + ttlMs,
  };

  const existing = sessionStore.get(sessionId) ?? [];
  const active = [...existing.filter((t) => t.expiresAt > now), newTurn];
  sessionStore.set(sessionId, active);

  const turns = active.map((t) => t.summary);
  const sessionRiskScore = computeSessionRisk(turns);

  let pattern: TurnPattern = "normal";
  if (detectEscalation(turns)) {
    pattern = "escalation";
  } else if (detectRepetition(turns)) {
    pattern = "repetition";
  } else if (detectPivot(turns)) {
    pattern = "pivot";
  }

  return {
    isEscalation: pattern !== "normal",
    sessionRiskScore,
    turnCount: turns.length,
    pattern,
    turns,
  };
}

/**
 * Get the current risk assessment for a session without adding a turn.
 *
 * @param sessionId - Unique session identifier
 * @returns Multi-turn analysis result, or a zero-risk result if no session exists
 */
export function getSessionRisk(sessionId: string): MultiTurnResult {
  const now = Date.now();
  const existing = sessionStore.get(sessionId) ?? [];
  const active = existing.filter((t) => t.expiresAt > now);

  if (active.length === 0) {
    return {
      isEscalation: false,
      sessionRiskScore: 0,
      turnCount: 0,
      pattern: "normal",
      turns: [],
    };
  }

  const turns = active.map((t) => t.summary);
  const sessionRiskScore = computeSessionRisk(turns);

  let pattern: TurnPattern = "normal";
  if (detectEscalation(turns)) {
    pattern = "escalation";
  } else if (detectRepetition(turns)) {
    pattern = "repetition";
  } else if (detectPivot(turns)) {
    pattern = "pivot";
  }

  return {
    isEscalation: pattern !== "normal",
    sessionRiskScore,
    turnCount: turns.length,
    pattern,
    turns,
  };
}

/**
 * Remove all expired sessions from the store.
 * Should be called periodically (e.g., every few minutes) to prevent memory leaks.
 *
 * @returns Number of sessions removed
 */
export function cleanExpiredSessions(): number {
  const now = Date.now();
  let removed = 0;

  for (const [sessionId, turns] of sessionStore) {
    const active = turns.filter((t) => t.expiresAt > now);
    if (active.length === 0) {
      sessionStore.delete(sessionId);
      removed++;
    } else if (active.length !== turns.length) {
      sessionStore.set(sessionId, active);
    }
  }

  return removed;
}

/**
 * Clear all session data. Useful for testing.
 */
export function clearAllSessions(): void {
  sessionStore.clear();
}
