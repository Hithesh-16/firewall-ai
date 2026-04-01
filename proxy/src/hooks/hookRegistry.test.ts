import { describe, it, expect, beforeEach } from "vitest";
import {
  registerHook,
  unregisterHook,
  getRegisteredHooks,
  triggerHooks,
} from "./hookRegistry";

describe("hookRegistry", () => {
  beforeEach(() => {
    // Clear all hooks
    for (const hook of getRegisteredHooks()) {
      unregisterHook(hook.id);
    }
  });

  it("registers and retrieves hooks", () => {
    registerHook({
      id: "test-1",
      event: "on_block",
      execute: async () => {},
    });

    const hooks = getRegisteredHooks("on_block");
    expect(hooks).toHaveLength(1);
    expect(hooks[0].id).toBe("test-1");
  });

  it("unregisters hooks", () => {
    registerHook({
      id: "test-rm",
      event: "on_block",
      execute: async () => {},
    });
    unregisterHook("test-rm");
    expect(getRegisteredHooks("on_block")).toHaveLength(0);
  });

  it("runs gating hooks sequentially — early exit on deny", async () => {
    const order: string[] = [];

    registerHook({
      id: "gate-1",
      event: "on_block",
      execute: async () => {
        order.push("gate-1");
        return true; // deny
      },
    });

    registerHook({
      id: "gate-2",
      event: "on_block",
      execute: async () => {
        order.push("gate-2"); // should NOT run
      },
    });

    const result = await triggerHooks("on_block", { riskScore: 80 });
    expect(result.denied).toBe(true);
    expect(order).toEqual(["gate-1"]); // gate-2 never ran
  });

  it("runs observational hooks in parallel", async () => {
    const results: string[] = [];

    registerHook({
      id: "obs-1",
      event: "post_receive",
      execute: async () => {
        results.push("obs-1");
      },
    });

    registerHook({
      id: "obs-2",
      event: "post_receive",
      execute: async () => {
        results.push("obs-2");
      },
    });

    const result = await triggerHooks("post_receive", {});
    expect(result.denied).toBe(false);
    expect(results).toContain("obs-1");
    expect(results).toContain("obs-2");
  });

  it("returns denied:false when no hooks registered", async () => {
    const result = await triggerHooks("on_approve", {});
    expect(result.denied).toBe(false);
  });

  it("gating hook failure does not deny", async () => {
    registerHook({
      id: "failing-hook",
      event: "pre_send",
      execute: async () => {
        throw new Error("hook crashed");
      },
    });

    const result = await triggerHooks("pre_send", {});
    expect(result.denied).toBe(false); // fail open
  });
});
