/**
 * In-Memory Cache Adapter
 *
 * Uses a simple Map with TTL tracking. No external dependencies.
 * Default adapter when CACHE_STORE is not set or is "memory".
 *
 * SOLID:
 * - LSP: Implements CacheAdapter interface — interchangeable with ValkeyAdapter.
 * - SRP: Only provides in-memory cache operations. No persistence.
 *
 * For production with multiple proxy instances, use ValkeyAdapter instead.
 */

import type { CacheAdapter } from "./cacheAdapter";

interface CacheEntry {
  value: string;
  expiresAt: number | null; // null = no expiry
}

export function createMemoryAdapter(): CacheAdapter {
  const store = new Map<string, CacheEntry>();

  // Lazy cleanup every 60s
  const cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (entry.expiresAt !== null && entry.expiresAt <= now) {
        store.delete(key);
      }
    }
  }, 60_000);

  // Prevent timer from keeping process alive
  if (cleanupTimer.unref) cleanupTimer.unref();

  function isExpired(entry: CacheEntry): boolean {
    return entry.expiresAt !== null && entry.expiresAt <= Date.now();
  }

  return {
    async get(key: string): Promise<string | null> {
      const entry = store.get(key);
      if (!entry || isExpired(entry)) {
        if (entry) store.delete(key);
        return null;
      }
      return entry.value;
    },

    async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
      store.set(key, {
        value,
        expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
      });
    },

    async del(key: string): Promise<boolean> {
      return store.delete(key);
    },

    async incr(key: string): Promise<number> {
      const entry = store.get(key);
      let current = 0;
      if (entry && !isExpired(entry)) {
        current = parseInt(entry.value, 10) || 0;
      }
      const next = current + 1;
      store.set(key, {
        value: String(next),
        expiresAt: entry?.expiresAt ?? null,
      });
      return next;
    },

    async expire(key: string, ttlSeconds: number): Promise<void> {
      const entry = store.get(key);
      if (entry) {
        entry.expiresAt = Date.now() + ttlSeconds * 1000;
      }
    },

    isReady(): boolean {
      return true; // Memory is always ready
    },

    async close(): Promise<void> {
      clearInterval(cleanupTimer);
      store.clear();
    },
  };
}
