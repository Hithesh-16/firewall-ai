/**
 * Intent Cluster Scanner
 *
 * Detects coordinated prompt injection attacks from multiple users targeting
 * the same jailbreak pattern within a sliding time window.
 * Single Responsibility: Only clusters intents by similarity. No policy decisions.
 *
 * Technique:
 *   - Text normalization (lowercase, strip punctuation, collapse whitespace)
 *   - 3-word n-gram shingling
 *   - SimHash fingerprinting (64-bit)
 *   - Hamming distance clustering (threshold: 5 bits)
 */

// ── Types ────────────────────────────────────────────────────────────────

export interface IntentClusterResult {
  readonly isCoordinated: boolean;
  readonly clusterSize: number;
  readonly distinctUsers: number;
  readonly clusterFingerprint: string;
}

export interface ClusterSummary {
  readonly fingerprint: string;
  readonly size: number;
  readonly distinctUsers: number;
  readonly oldestTimestamp: number;
  readonly newestTimestamp: number;
}

interface IntentEntry {
  readonly userId: string;
  readonly fingerprint: string;
  readonly timestamp: number;
}

// ── Configuration ────────────────────────────────────────────────────────

const DEFAULT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const HAMMING_THRESHOLD = 5;
const COORDINATED_MIN_USERS = 3;
const SHINGLE_SIZE = 3;

// ── Store ────────────────────────────────────────────────────────────────

let windowMs = DEFAULT_WINDOW_MS;
const intentEntries: IntentEntry[] = [];

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Normalize text for fingerprinting: lowercase, strip punctuation,
 * collapse whitespace.
 */
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Generate 3-word n-gram shingles from normalized text.
 */
function generateShingles(text: string): readonly string[] {
  const words = text.split(" ");
  if (words.length < SHINGLE_SIZE) return [text];

  const shingles: string[] = [];
  for (let i = 0; i <= words.length - SHINGLE_SIZE; i++) {
    shingles.push(words.slice(i, i + SHINGLE_SIZE).join(" "));
  }
  return shingles;
}

/**
 * Simple string hash (FNV-1a 32-bit) returning a 32-bit integer.
 */
function fnv1a32(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * Compute a 64-bit SimHash as a hex string from a set of shingles.
 * Uses two 32-bit FNV-1a hashes (with salt) to simulate 64 bits.
 */
function computeSimHash(shingles: readonly string[]): string {
  const bits = 64;
  const counts = new Array<number>(bits).fill(0);

  for (const shingle of shingles) {
    const hashLow = fnv1a32(shingle);
    const hashHigh = fnv1a32(`salt:${shingle}`);

    for (let i = 0; i < 32; i++) {
      counts[i] += (hashLow >>> i) & 1 ? 1 : -1;
      counts[32 + i] += (hashHigh >>> i) & 1 ? 1 : -1;
    }
  }

  // Convert counts to bit string, then to hex
  let hexResult = "";
  for (let i = 0; i < bits; i += 4) {
    let nibble = 0;
    for (let j = 0; j < 4; j++) {
      if (counts[i + j] > 0) {
        nibble |= 1 << j;
      }
    }
    hexResult += nibble.toString(16);
  }

  return hexResult;
}

/**
 * Compute hamming distance between two hex-encoded SimHash values.
 */
function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) return Infinity;
  let distance = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    // Count set bits in nibble
    distance +=
      (diff & 1) + ((diff >> 1) & 1) + ((diff >> 2) & 1) + ((diff >> 3) & 1);
  }
  return distance;
}

/**
 * Remove entries older than the sliding window.
 */
function pruneOldEntries(now: number): void {
  const cutoff = now - windowMs;
  let i = 0;
  while (i < intentEntries.length && intentEntries[i].timestamp < cutoff) {
    i++;
  }
  if (i > 0) {
    intentEntries.splice(0, i);
  }
}

/**
 * Find all entries within hamming distance of the given fingerprint.
 */
function findClusterMembers(fingerprint: string): readonly IntentEntry[] {
  return intentEntries.filter(
    (entry) =>
      hammingDistance(entry.fingerprint, fingerprint) <= HAMMING_THRESHOLD,
  );
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Record an intent and check for coordinated attack patterns.
 *
 * @param userId - Unique user identifier
 * @param text - The user's prompt text
 * @param timestamp - Optional timestamp (defaults to now)
 * @returns Cluster analysis result
 */
export function recordIntent(
  userId: string,
  text: string,
  timestamp?: number,
): IntentClusterResult {
  const now = timestamp ?? Date.now();
  pruneOldEntries(now);

  const normalized = normalizeText(text);
  const shingles = generateShingles(normalized);
  const fingerprint = computeSimHash(shingles);

  const entry: IntentEntry = { userId, fingerprint, timestamp: now };
  intentEntries.push(entry);

  const clusterMembers = findClusterMembers(fingerprint);
  const distinctUsers = new Set(clusterMembers.map((e) => e.userId)).size;

  return {
    isCoordinated: distinctUsers >= COORDINATED_MIN_USERS,
    clusterSize: clusterMembers.length,
    distinctUsers,
    clusterFingerprint: fingerprint,
  };
}

/**
 * Get all active clusters that meet the coordination threshold.
 *
 * @returns Array of cluster summaries
 */
export function getActiveClusters(): readonly ClusterSummary[] {
  pruneOldEntries(Date.now());

  const visited = new Set<number>();
  const clusters: ClusterSummary[] = [];

  for (let i = 0; i < intentEntries.length; i++) {
    if (visited.has(i)) continue;

    const members: IntentEntry[] = [];
    for (let j = 0; j < intentEntries.length; j++) {
      if (
        hammingDistance(
          intentEntries[i].fingerprint,
          intentEntries[j].fingerprint,
        ) <= HAMMING_THRESHOLD
      ) {
        members.push(intentEntries[j]);
        visited.add(j);
      }
    }

    const distinctUsers = new Set(members.map((e) => e.userId)).size;
    if (distinctUsers >= COORDINATED_MIN_USERS) {
      clusters.push({
        fingerprint: intentEntries[i].fingerprint,
        size: members.length,
        distinctUsers,
        oldestTimestamp: Math.min(...members.map((e) => e.timestamp)),
        newestTimestamp: Math.max(...members.map((e) => e.timestamp)),
      });
    }
  }

  return clusters;
}

/**
 * Remove all entries older than the current window.
 *
 * @returns Number of entries removed
 */
export function cleanOldEntries(): number {
  const before = intentEntries.length;
  pruneOldEntries(Date.now());
  return before - intentEntries.length;
}

/**
 * Clear all intent data. Useful for testing.
 */
export function clearAllIntents(): void {
  intentEntries.length = 0;
}

/**
 * Set the sliding window duration. Useful for testing.
 *
 * @param ms - Window duration in milliseconds
 */
export function setWindowMs(ms: number): void {
  windowMs = ms;
}
