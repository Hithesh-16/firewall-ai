/**
 * Federated Threat Intelligence
 *
 * Privacy-preserving threat signature sharing across tenants using
 * locality-sensitive hashing (LSH). No raw content is ever stored or
 * transmitted — only minhash band signatures derived from text shingles.
 *
 * Design:
 * - Single Responsibility: Creates, stores, and queries threat signatures
 * - Open/Closed: New hash functions or band configs via constants, no code changes
 * - Pure matching logic (createSignature is a pure function)
 * - In-memory shared store simulates federation (production: distributed store)
 */

import crypto from "node:crypto";

// ── Constants ─────────────────────────────────────────────────────────────────

const NUM_HASH_FUNCTIONS = 64;
const NUM_BANDS = 8;
const ROWS_PER_BAND = NUM_HASH_FUNCTIONS / NUM_BANDS; // 8
const SHINGLE_SIZE = 3;
const SIGNATURE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ThreatSignature {
  readonly id: string;
  readonly lshBands: readonly string[];
  readonly categories: readonly string[];
  readonly riskScore: number;
  readonly tenantHash: string;
  readonly createdAt: number;
}

export interface SignatureMatch {
  readonly signature: ThreatSignature;
  readonly matchedBands: number;
  readonly similarity: number;
}

// ── In-Memory Shared Store ────────────────────────────────────────────────────

let signatureStore: ThreatSignature[] = [];
let recentMatchCount = 0;

// ── Internal Helpers ──────────────────────────────────────────────────────────

/**
 * Normalize text for consistent shingling: lowercase, collapse whitespace,
 * strip non-alphanumeric (except spaces).
 */
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Generate word-level shingles (n-grams) from normalized text.
 */
function shingle(text: string): readonly string[] {
  const words = normalizeText(text).split(" ");
  if (words.length < SHINGLE_SIZE) {
    return [words.join(" ")];
  }
  const shingles: string[] = [];
  for (let i = 0; i <= words.length - SHINGLE_SIZE; i++) {
    shingles.push(words.slice(i, i + SHINGLE_SIZE).join(" "));
  }
  return shingles;
}

/**
 * FNV-1a hash with a seed, returning a 32-bit unsigned integer.
 */
function fnv1a(input: string, seed: number): number {
  let hash = (FNV_OFFSET ^ seed) >>> 0;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash;
}

/**
 * Compute a minhash signature (array of minimum hash values) for a set of shingles.
 * Each of the 64 hash functions uses a different seed.
 */
function minhash(shingles: readonly string[]): readonly number[] {
  const signature: number[] = new Array(NUM_HASH_FUNCTIONS).fill(0xffffffff);
  for (const s of shingles) {
    for (let i = 0; i < NUM_HASH_FUNCTIONS; i++) {
      const h = fnv1a(s, i * 7919 + 31);
      if (h < signature[i]) {
        signature[i] = h;
      }
    }
  }
  return signature;
}

/**
 * Split a minhash signature into bands. Each band is a hex string
 * derived from its constituent rows for fast equality comparison.
 */
function toBands(signature: readonly number[]): readonly string[] {
  const bands: string[] = [];
  for (let b = 0; b < NUM_BANDS; b++) {
    const start = b * ROWS_PER_BAND;
    const slice = signature.slice(start, start + ROWS_PER_BAND);
    const bandKey = slice.map((v) => v.toString(16).padStart(8, "0")).join("");
    bands.push(bandKey);
  }
  return bands;
}

/**
 * Remove signatures older than TTL from the store.
 */
function purgeExpired(): void {
  const cutoff = Date.now() - SIGNATURE_TTL_MS;
  signatureStore = signatureStore.filter((s) => s.createdAt > cutoff);
}

/**
 * Hash a tenant ID with SHA-256 so raw IDs are never stored.
 */
function hashTenant(tenantId: string): string {
  return crypto.createHash("sha256").update(tenantId).digest("hex");
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Create a privacy-preserving threat signature from text.
 * No raw content is retained — only LSH band hashes.
 *
 * @param text - Raw text to fingerprint
 * @param categories - Threat categories (e.g., ["prompt_injection", "jailbreak"])
 * @param riskScore - Risk score 0-100
 * @returns Immutable ThreatSignature
 */
export function createSignature(
  text: string,
  categories: string[],
  riskScore: number,
): ThreatSignature {
  const shingles = shingle(text);
  const sig = minhash(shingles);
  const lshBands = toBands(sig);
  const id = crypto.randomUUID();

  return Object.freeze({
    id,
    lshBands,
    categories: [...categories],
    riskScore: Math.max(0, Math.min(100, riskScore)),
    tenantHash: "",
    createdAt: Date.now(),
  });
}

/**
 * Publish a signature to the shared store on behalf of a tenant.
 * The tenant ID is hashed (SHA-256) before storage.
 *
 * @param tenantId - Raw tenant identifier (never stored)
 * @param signature - Signature to publish
 */
export function publishSignature(
  tenantId: string,
  signature: ThreatSignature,
): void {
  purgeExpired();
  const published: ThreatSignature = Object.freeze({
    ...signature,
    tenantHash: hashTenant(tenantId),
  });
  signatureStore = [...signatureStore, published];
}

/**
 * Query the shared store for signatures matching the given text.
 * Uses band-level comparison — two signatures match if they share at
 * least one identical band (indicating high Jaccard similarity).
 *
 * @param text - Text to check against known threat signatures
 * @param threshold - Minimum risk score filter (default 0)
 * @returns Matching signatures sorted by matched band count descending
 */
export function querySignatures(
  text: string,
  threshold: number = 0,
): SignatureMatch[] {
  purgeExpired();

  const shingles = shingle(text);
  const sig = minhash(shingles);
  const queryBands = toBands(sig);

  const matches: SignatureMatch[] = [];

  for (const stored of signatureStore) {
    if (stored.riskScore < threshold) {
      continue;
    }

    let matchedBands = 0;
    for (let b = 0; b < NUM_BANDS; b++) {
      if (queryBands[b] === stored.lshBands[b]) {
        matchedBands++;
      }
    }

    if (matchedBands > 0) {
      matches.push(
        Object.freeze({
          signature: stored,
          matchedBands,
          similarity: matchedBands / NUM_BANDS,
        }),
      );
    }
  }

  recentMatchCount += matches.length;

  return [...matches].sort((a, b) => b.matchedBands - a.matchedBands);
}

/**
 * Return aggregate statistics about the signature store.
 */
export function getSignatureStats(): {
  totalSignatures: number;
  tenants: number;
  recentMatches: number;
} {
  purgeExpired();
  const uniqueTenants = new Set(signatureStore.map((s) => s.tenantHash));
  return {
    totalSignatures: signatureStore.length,
    tenants: uniqueTenants.size,
    recentMatches: recentMatchCount,
  };
}

/**
 * Clear all signatures and reset match counter.
 * Primarily for testing and tenant offboarding.
 */
export function clearSignatures(): void {
  signatureStore = [];
  recentMatchCount = 0;
}
