import crypto from "node:crypto";
import type { PreflightScanResult } from "../llm/firewallScan.js";

interface CacheEntry {
  result: PreflightScanResult;
  timestamp: number;
  ttl: number;
}

const DEFAULT_TTL_MS = 5 * 60 * 1000; // 5 minutes
const BLOCK_TTL_MS = 60 * 1000; // 60 seconds for blocked requests
const POLICY_VERSION_TTL_MS = 10 * 60 * 1000; // 10 minutes when policy changes

/**
 * Telemetry metrics for cache performance tracking.
 */
export interface FirewallCacheMetrics {
  totalScans: number;
  exactCacheHits: number;
  simHashHits: number;
  l1Blocks: number;
  l2Blocks: number;
  l3Escapes: number;
}

/**
 * Global metrics accumulator (reset on process start or on demand).
 */
export const firewallMetrics: FirewallCacheMetrics = {
  totalScans: 0,
  exactCacheHits: 0,
  simHashHits: 0,
  l1Blocks: 0,
  l2Blocks: 0,
  l3Escapes: 0,
};

/**
 * Returns an immutable snapshot of the current metrics plus derived rates.
 * Safe to expose to GUI / CLI / tests without leaking the mutable singleton.
 */
export interface FirewallMetricsSnapshot extends FirewallCacheMetrics {
  cacheHitRate: number; // 0..1 — exact + simhash hits / totalScans
  l3EscapeRate: number; // 0..1 — l3Escapes / totalScans
}

export function getFirewallMetricsSnapshot(): FirewallMetricsSnapshot {
  const total = Math.max(firewallMetrics.totalScans, 1);
  return {
    ...firewallMetrics,
    cacheHitRate:
      (firewallMetrics.exactCacheHits + firewallMetrics.simHashHits) / total,
    l3EscapeRate: firewallMetrics.l3Escapes / total,
  };
}

export function resetFirewallMetrics(): void {
  firewallMetrics.totalScans = 0;
  firewallMetrics.exactCacheHits = 0;
  firewallMetrics.simHashHits = 0;
  firewallMetrics.l1Blocks = 0;
  firewallMetrics.l2Blocks = 0;
  firewallMetrics.l3Escapes = 0;
}

// Opt-in periodic debug dump. Gated behind an env var so production runs
// stay quiet by default. Set AI_FIREWALL_METRICS_DEBUG=1 to enable.
const METRICS_LOG_EVERY = Number.parseInt(
  process.env.AI_FIREWALL_METRICS_EVERY ?? "50",
  10,
);
let scansSinceLastLog = 0;

export function maybeLogFirewallMetrics(): void {
  if (process.env.AI_FIREWALL_METRICS_DEBUG !== "1") return;
  scansSinceLastLog++;
  if (scansSinceLastLog < METRICS_LOG_EVERY) return;
  scansSinceLastLog = 0;
  const snap = getFirewallMetricsSnapshot();
  process.stderr.write(
    `[firewall-metrics] scans=${snap.totalScans} ` +
      `cache_hit=${(snap.cacheHitRate * 100).toFixed(1)}% ` +
      `l1=${snap.l1Blocks} l2=${snap.l2Blocks} l3=${snap.l3Escapes} ` +
      `simhash=${snap.simHashHits} exact=${snap.exactCacheHits}\n`,
  );
}

/**
 * A fast, exact-match LRU cache for Firewall verdicts with TTL support.
 * Saves 5-50% tokens/latency on edit-run-edit identical repeats.
 *
 * Features:
 * - TTL-based eviction (never store negatives forever)
 * - Separate TTL for BLOCK verdicts (1 min vs 5 min for ALLOW)
 * - Policy version awareness
 */
export class FirewallExactHashCache {
  private cache = new Map<string, CacheEntry>();
  private readonly maxCapacity = 10000;
  private currentPolicyVersion = "v1";

  private generateKey(normalizedPrompt: string, policyVersion: string): string {
    return crypto
      .createHash("sha256")
      .update(`${policyVersion}:${normalizedPrompt}`)
      .digest("hex");
  }

  private getTTL(result: PreflightScanResult): number {
    // BLOCK verdicts get shorter TTL to prevent stale blocks
    if (result.blocked) {
      return BLOCK_TTL_MS;
    }
    return DEFAULT_TTL_MS;
  }

  public setPolicyVersion(version: string): void {
    this.currentPolicyVersion = version;
    // Evict all entries when policy changes (safety first)
    this.cache.clear();
  }

  public get(
    prompt: string,
    policyVersion?: string,
  ): PreflightScanResult | undefined {
    const version = policyVersion ?? this.currentPolicyVersion;
    const key = this.generateKey(prompt, version);
    const entry = this.cache.get(key);

    if (!entry) return undefined;

    // Evict expired entries
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return undefined;
    }

    firewallMetrics.exactCacheHits++;
    return entry.result;
  }

  public set(
    prompt: string,
    result: PreflightScanResult,
    policyVersion?: string,
  ): void {
    const version = policyVersion ?? this.currentPolicyVersion;

    // Evict oldest if at capacity
    if (this.cache.size >= this.maxCapacity) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }

    const key = this.generateKey(prompt, version);
    const ttl = this.getTTL(result);

    this.cache.set(key, {
      result,
      timestamp: Date.now(),
      ttl,
    });
  }

  /**
   * Get cache statistics for telemetry.
   */
  public getStats(): { size: number; maxCapacity: number; hitRate: number } {
    return {
      size: this.cache.size,
      maxCapacity: this.maxCapacity,
      hitRate: 0, // Calculated externally
    };
  }

  /**
   * Clear all entries from cache.
   */
  public clear(): void {
    this.cache.clear();
  }

  /**
   * Remove expired entries (call periodically for memory cleanup).
   */
  public evictExpired(): number {
    const now = Date.now();
    let evicted = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > entry.ttl) {
        this.cache.delete(key);
        evicted++;
      }
    }

    return evicted;
  }
}

export const firewallLocalCache = new FirewallExactHashCache();

// ─── SimHash Near-Duplicate Cache ─────────────────────────────────────────────

/**
 * SimHash implementation for near-duplicate detection.
 * Allows finding prompts that are "similar enough" to cached verdicts.
 */
class SimHash {
  private static readonly FEATURES = 64;

  static async hash(text: string): Promise<string> {
    // Normalize: lowercase, trim, remove extra whitespace
    const normalized = text.toLowerCase().trim().replace(/\s+/g, " ");

    // Simple bag-of-words hash (production should use proper tokenizer)
    const words = normalized.split(" ");
    const bits = new Array(SimHash.FEATURES).fill(0);

    for (const word of words) {
      const wordHash = crypto.createHash("md5").update(word).digest("hex");

      for (let i = 0; i < SimHash.FEATURES; i++) {
        const bit = parseInt(wordHash[i % wordHash.length], 16) % 2;
        bits[i] += bit === 0 ? -1 : 1;
      }
    }

    return bits.map((b) => (b >= 0 ? "1" : "0")).join("");
  }

  static hammingDistance(a: string, b: string): number {
    let distance = 0;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) distance++;
    }
    return distance;
  }
}

interface SimHashCacheEntry {
  result: PreflightScanResult;
  hash: string;
  timestamp: number;
}

/**
 * Near-duplicate cache using SimHash for fuzzy matching.
 * Provides 5-20% additional cache hits on top of exact-match cache.
 * NEVER caches negative/BLOCK verdicts.
 */
export class FirewallSimHashCache {
  private cache = new Map<string, SimHashCacheEntry>();
  private readonly maxCapacity = 5000;
  private readonly simThreshold = 3; // Hamming distance threshold for "similar"
  private readonly simHashCacheTTL = 5 * 60 * 1000; // 5 minutes

  private async generateKey(text: string): Promise<string> {
    return SimHash.hash(text);
  }

  /**
   * Find a near-duplicate match in the cache.
   * Returns null if no similar entry exists within the threshold.
   * Never returns blocked verdicts (security first).
   */
  public async getNearMatch(text: string): Promise<PreflightScanResult | null> {
    const hash = await this.generateKey(text);
    const now = Date.now();

    for (const [_key, entry] of this.cache.entries()) {
      // Evict expired
      if (now - entry.timestamp > this.simHashCacheTTL) {
        this.cache.delete(_key);
        continue;
      }

      // Never return BLOCK verdicts from SimHash cache (security)
      if (entry.result.blocked) {
        continue;
      }

      if (SimHash.hammingDistance(hash, entry.hash) <= this.simThreshold) {
        firewallMetrics.simHashHits++;
        return entry.result;
      }
    }
    return null;
  }

  /**
   * Store a result in the SimHash cache.
   * Only stores non-blocked (benign) results.
   */
  public async set(text: string, result: PreflightScanResult): Promise<void> {
    // Never cache blocked verdicts
    if (result.blocked) {
      return;
    }

    if (this.cache.size >= this.maxCapacity) {
      // Evict oldest
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }

    const hash = await this.generateKey(text);
    this.cache.set(text, {
      result,
      hash,
      timestamp: Date.now(),
    });
  }

  /**
   * Clear all entries.
   */
  public clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics.
   */
  public getStats(): { size: number; maxCapacity: number } {
    return {
      size: this.cache.size,
      maxCapacity: this.maxCapacity,
    };
  }
}

export const firewallSimHashCache = new FirewallSimHashCache();
