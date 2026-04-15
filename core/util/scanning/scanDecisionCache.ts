import type { FileScanDecision } from "../fileScanProxy.js";
import type { ScanPurpose } from "./ScanPurpose.js";

/**
 * In-process LRU cache for file scan decisions.
 *
 * The proxy already caches by content hash, but the HTTP round-trip
 * itself is the bottleneck on hot paths. Autocomplete reads 50+
 * files per keystroke — a 10ms proxy call per read is fatal.
 *
 * Key shape: `<absPath>:<mtimeMs>:<purpose>`.
 * Invalidation: mtime change → different key → miss (old entry ages
 * out naturally via LRU).
 *
 * Pure JS, zero deps — 40 lines of Map + manual LRU.
 */

const MAX_ENTRIES = 5000;

interface CacheEntry {
  readonly decision: FileScanDecision;
  readonly insertedAt: number;
}

const store = new Map<string, CacheEntry>();

function cacheKey(
  filePath: string,
  mtimeMs: number,
  purpose: ScanPurpose,
): string {
  return `${filePath}:${mtimeMs}:${purpose}`;
}

export function getCachedDecision(
  filePath: string,
  mtimeMs: number,
  purpose: ScanPurpose,
): FileScanDecision | null {
  const key = cacheKey(filePath, mtimeMs, purpose);
  const entry = store.get(key);
  if (!entry) return null;
  // LRU: re-insert to move to tail
  store.delete(key);
  store.set(key, entry);
  return entry.decision;
}

export function setCachedDecision(
  filePath: string,
  mtimeMs: number,
  purpose: ScanPurpose,
  decision: FileScanDecision,
): void {
  const key = cacheKey(filePath, mtimeMs, purpose);
  store.delete(key);
  store.set(key, { decision, insertedAt: Date.now() });
  // Evict oldest entries when over capacity.
  while (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value;
    if (oldest === undefined) break;
    store.delete(oldest);
  }
}

export function invalidateCachedDecision(filePath: string): void {
  for (const key of Array.from(store.keys())) {
    if (key.startsWith(`${filePath}:`)) {
      store.delete(key);
    }
  }
}

export function _resetScanDecisionCache(): void {
  store.clear();
}

export function _cacheSize(): number {
  return store.size;
}
