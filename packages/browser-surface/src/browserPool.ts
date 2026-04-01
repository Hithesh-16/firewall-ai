/**
 * Browser Pool
 *
 * Manages a pool of Chromium instances (max 3) with acquire/release lifecycle.
 * Queues acquire() calls with 30s timeout when all instances are leased.
 *
 * SOLID:
 * - SRP: Only manages browser instance lifecycle. No page logic.
 */

const MAX_INSTANCES = 3;
const ACQUIRE_TIMEOUT_MS = 30_000;

interface BrowserInstance {
  id: number;
  browser: any; // Playwright Browser
  status: "idle" | "leased" | "warming";
  leasedAt?: number;
}

interface Waiter {
  resolve: (instance: BrowserInstance) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

let instances: BrowserInstance[] = [];
const waitQueue: Waiter[] = [];
let nextId = 0;
let playwrightModule: any = null;

async function getPlaywright(): Promise<any> {
  if (!playwrightModule) {
    try {
      playwrightModule = await import("playwright");
    } catch {
      throw new Error(
        "Playwright is not installed. Run: npm install playwright",
      );
    }
  }
  return playwrightModule;
}

/**
 * Acquire a browser instance. Queues if all slots occupied.
 */
export async function acquire(): Promise<{ instanceId: number; browser: any }> {
  // Try to find an idle instance
  const idle = instances.find((i) => i.status === "idle");
  if (idle) {
    idle.status = "leased";
    idle.leasedAt = Date.now();
    return { instanceId: idle.id, browser: idle.browser };
  }

  // Create new instance if under limit
  if (instances.length < MAX_INSTANCES) {
    const pw = await getPlaywright();
    const browser = await pw.chromium.launch({
      headless: true,
    });

    const instance: BrowserInstance = {
      id: nextId++,
      browser,
      status: "leased",
      leasedAt: Date.now(),
    };
    instances = [...instances, instance];
    return { instanceId: instance.id, browser: instance.browser };
  }

  // Queue with timeout
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const idx = waitQueue.findIndex((w) => w.resolve === resolve);
      if (idx >= 0) waitQueue.splice(idx, 1);
      reject(new Error("Browser acquire timeout — all instances leased"));
    }, ACQUIRE_TIMEOUT_MS);

    waitQueue.push({ resolve: (inst) => {
      clearTimeout(timer);
      resolve({ instanceId: inst.id, browser: inst.browser });
    }, reject: (err) => {
      clearTimeout(timer);
      reject(err);
    }, timer });
  });
}

/**
 * Release a browser instance back to the pool.
 */
export async function release(instanceId: number): Promise<void> {
  const instance = instances.find((i) => i.id === instanceId);
  if (!instance) return;

  // Close all pages to clean state
  try {
    const pages = instance.browser.contexts?.() ?? [];
    for (const ctx of pages) {
      await ctx.close().catch(() => {});
    }
  } catch {
    // Browser may be crashed — remove from pool
    await destroyInstance(instanceId);
    return;
  }

  // Drain wait queue if anyone is waiting
  if (waitQueue.length > 0) {
    const waiter = waitQueue.shift();
    if (waiter) {
      instance.status = "leased";
      instance.leasedAt = Date.now();
      waiter.resolve(instance);
      return;
    }
  }

  instance.status = "idle";
  instance.leasedAt = undefined;
}

/**
 * Destroy a specific instance and remove from pool.
 */
async function destroyInstance(instanceId: number): Promise<void> {
  const instance = instances.find((i) => i.id === instanceId);
  if (instance) {
    try {
      await instance.browser.close();
    } catch {
      // Already closed
    }
    instances = instances.filter((i) => i.id !== instanceId);
  }

  // Drain queue if capacity freed
  if (waitQueue.length > 0 && instances.length < MAX_INSTANCES) {
    const waiter = waitQueue.shift();
    if (waiter) {
      try {
        const pw = await getPlaywright();
        const browser = await pw.chromium.launch({ headless: true });
        const newInstance: BrowserInstance = {
          id: nextId++,
          browser,
          status: "leased",
          leasedAt: Date.now(),
        };
        instances = [...instances, newInstance];
        waiter.resolve(newInstance);
      } catch (err) {
        waiter.reject(err instanceof Error ? err : new Error("Browser launch failed"));
      }
    }
  }
}

/**
 * Close all browser instances and clear the pool.
 */
export async function closeAll(): Promise<void> {
  for (const instance of instances) {
    try {
      await instance.browser.close();
    } catch {
      // Ignore
    }
  }
  instances = [];
  for (const waiter of waitQueue) {
    clearTimeout(waiter.timer);
    waiter.reject(new Error("Browser pool shut down"));
  }
  waitQueue.length = 0;
}

export function getPoolStatus(): {
  total: number;
  idle: number;
  leased: number;
  queued: number;
} {
  return {
    total: instances.length,
    idle: instances.filter((i) => i.status === "idle").length,
    leased: instances.filter((i) => i.status === "leased").length,
    queued: waitQueue.length,
  };
}
