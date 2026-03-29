/**
 * Valkey/Redis Cache Adapter
 *
 * Uses ioredis client (compatible with both Valkey and Redis).
 * Valkey is the Linux Foundation fork (BSD-3), recommended for open-source projects.
 *
 * SOLID:
 * - LSP: Implements CacheAdapter interface — interchangeable with MemoryAdapter.
 * - SRP: Only provides cache operations via ioredis. No business logic.
 *
 * Graceful fallback: if Valkey is unavailable, factory in cacheAdapter.ts
 * falls back to memoryAdapter with a warning.
 */

import type { CacheAdapter } from "./cacheAdapter";

/**
 * Create a Valkey/Redis adapter using ioredis.
 * ioredis is listed as an optionalDependency — import will fail gracefully
 * if not installed.
 */
export async function createValkeyAdapter(): Promise<CacheAdapter> {
  // Dynamic import — ioredis is an optional dependency, may not be installed
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Redis = (await import(/* webpackIgnore: true */ "ioredis" as string)).default as new (
    url: string,
    opts: Record<string, unknown>
  ) => {
    status: string;
    connect(): Promise<void>;
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<string>;
    setex(key: string, seconds: number, value: string): Promise<string>;
    del(key: string): Promise<number>;
    incr(key: string): Promise<number>;
    expire(key: string, seconds: number): Promise<number>;
    quit(): Promise<string>;
  };

  const url = process.env.VALKEY_URL ?? process.env.REDIS_URL ?? "redis://localhost:6379";
  const client = new Redis(url, {
    maxRetriesPerRequest: 3,
    retryStrategy(times: number) {
      if (times > 5) return null; // Stop retrying after 5 attempts
      return Math.min(times * 200, 2000);
    },
    lazyConnect: true,
  });

  await client.connect();

  return {
    async get(key: string): Promise<string | null> {
      return client.get(key);
    },

    async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
      if (ttlSeconds) {
        await client.setex(key, ttlSeconds, value);
      } else {
        await client.set(key, value);
      }
    },

    async del(key: string): Promise<boolean> {
      const result = await client.del(key);
      return result > 0;
    },

    async incr(key: string): Promise<number> {
      return client.incr(key);
    },

    async expire(key: string, ttlSeconds: number): Promise<void> {
      await client.expire(key, ttlSeconds);
    },

    isReady(): boolean {
      return client.status === "ready";
    },

    async close(): Promise<void> {
      await client.quit();
    },
  };
}
