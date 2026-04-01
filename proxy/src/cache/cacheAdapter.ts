/**
 * Cache Adapter Interface + Factory
 *
 * Defines the cache contract and creates the appropriate adapter
 * based on CACHE_STORE environment variable.
 *
 * SOLID:
 * - ISP: Minimal interface — only get/set/del/incr. No complex query methods.
 * - DIP: All consumers depend on CacheAdapter interface, not concrete adapters.
 * - OCP: New adapters added without modifying this factory (register pattern).
 * - SRP: Factory logic only — no cache operations.
 */

// ── Cache Interface (ISP — minimal contract) ───────────────────────────────

export interface CacheAdapter {
  /** Get a value by key. Returns null on miss. */
  get(key: string): Promise<string | null>;

  /** Set a value with optional TTL in seconds. */
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;

  /** Delete a key. Returns true if the key existed. */
  del(key: string): Promise<boolean>;

  /** Increment a numeric value. Returns the new value. Creates key with value 1 if missing. */
  incr(key: string): Promise<number>;

  /** Set expiry on an existing key. */
  expire(key: string, ttlSeconds: number): Promise<void>;

  /** Check if adapter is connected/available. */
  isReady(): boolean;

  /** Graceful shutdown. */
  close(): Promise<void>;
}

// ── Factory ────────────────────────────────────────────────────────────────

let instance: CacheAdapter | null = null;

/**
 * Get or create the cache adapter singleton.
 * Uses CACHE_STORE env: "memory" (default) or "valkey".
 */
export async function getCache(): Promise<CacheAdapter> {
  if (instance) return instance;

  const store = process.env.CACHE_STORE ?? "memory";

  if (store === "valkey" || store === "redis") {
    try {
      const { createValkeyAdapter } = await import("./valkeyAdapter");
      instance = await createValkeyAdapter();
      return instance;
    } catch (err) {
      console.warn(
        `[cache] Failed to connect to Valkey/Redis, falling back to memory cache: ${
          err instanceof Error ? err.message : err
        }`
      );
      // Fall through to memory adapter
    }
  }

  const { createMemoryAdapter } = await import("./memoryAdapter");
  instance = createMemoryAdapter();
  return instance;
}

/**
 * Reset the singleton (for testing).
 */
export function resetCache(): void {
  if (instance) {
    instance.close().catch((e) => { console.warn("cache close failed", e); });
    instance = null;
  }
}
