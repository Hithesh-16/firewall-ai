import {
  __resetFirewallStateForTests,
  firewallCascade,
} from "./firewallScan.js";
import {
  firewallLocalCache,
  firewallSimHashCache,
  firewallMetrics,
  resetFirewallMetrics,
  getFirewallMetricsSnapshot,
} from "../firewall/cache.js";

/**
 * These tests focus on the cache / coalescing / session-scoping behaviour
 * introduced alongside the firewall refactor. They intentionally do NOT
 * exercise the ONNX classifier (which requires @huggingface/transformers
 * at runtime) or the proxy (not running in unit tests). Instead:
 *
 *  - ALLOW: we pre-seed firewallLocalCache so the cascade short-circuits
 *    at L0 and never needs the classifier or the proxy.
 *  - BLOCK: we use a body containing a well-known secret pattern that
 *    trips L1 synchronously, which in turn populates the cache (one of
 *    the new behaviours under test).
 */

describe("firewallCascade — cache + coalescing", () => {
  beforeEach(() => {
    __resetFirewallStateForTests();
    firewallLocalCache.clear();
    firewallSimHashCache.clear();
    resetFirewallMetrics();
  });

  const benignBody = JSON.stringify({
    model: "gpt-4o-mini",
    messages: [
      { role: "system", content: "You are a helpful coding assistant." },
      { role: "user", content: "what is the capital of France?" },
    ],
  });

  // AWS access key pattern — triggers the L1 secret scanner deterministically
  // without needing any network or ONNX runtime.
  const secretBody = JSON.stringify({
    model: "gpt-4o-mini",
    messages: [
      {
        role: "user",
        content: "deploy with AKIAIOSFODNN7EXAMPLE and the usual setup",
      },
    ],
  });

  test("L0 replay: pre-seeded cache hit returns cachedHit=true on the same body", async () => {
    // Seed as if a prior scan had cached an ALLOW verdict for this body.
    firewallLocalCache.set(benignBody, {
      finalBody: benignBody,
      blocked: false,
    });

    const result = await firewallCascade(benignBody, "gpt-4o-mini");
    expect(result.blocked).toBe(false);
    expect(result.cachedHit).toBe(true);
  });

  test("L0 replay is body-keyed: different sessionId still hits the cached verdict", async () => {
    firewallLocalCache.set(benignBody, {
      finalBody: benignBody,
      blocked: false,
    });

    const a = await firewallCascade(
      benignBody,
      "gpt-4o-mini",
      false,
      "session-A",
    );
    const b = await firewallCascade(
      benignBody,
      "gpt-4o-mini",
      false,
      "session-B",
    );
    expect(a.cachedHit).toBe(true);
    expect(b.cachedHit).toBe(true);
  });

  test("L1 block verdicts are now cached: second call returns the cached block", async () => {
    const first = await firewallCascade(secretBody, "gpt-4o-mini");
    expect(first.blocked).toBe(true);
    expect(first.cachedHit).toBeFalsy();

    // Second call for the same body must NOT re-run L1 — it must be served
    // from the cache. Guards the new block-caching path.
    const second = await firewallCascade(secretBody, "gpt-4o-mini");
    expect(second.blocked).toBe(true);
    expect(second.cachedHit).toBe(true);
  });

  test("in-flight coalescing: concurrent scans on the same body share one run", async () => {
    // Use a fresh body so there's no pre-seeded cache — the two calls must
    // genuinely coalesce, not both hit L0 independently.
    const liveBody = JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        { role: "user", content: "another secret AKIAIOSFODNN7EXAMPLE here" },
      ],
    });

    const [a, b] = await Promise.all([
      firewallCascade(liveBody, "gpt-4o-mini", false, "session-X"),
      firewallCascade(liveBody, "gpt-4o-mini", false, "session-X"),
    ]);
    expect(a.blocked).toBe(true);
    expect(b.blocked).toBe(true);
    // Exactly one task ran through runCascade — coalescing returned the
    // same promise to both callers. totalScans is incremented inside
    // runCascade, so with two concurrent callers it must be 1.
    expect(firewallMetrics.totalScans).toBe(1);
  });

  test("metrics snapshot exposes exact cache hits + derived hit rate", async () => {
    firewallLocalCache.set(benignBody, {
      finalBody: benignBody,
      blocked: false,
    });

    await firewallCascade(benignBody, "gpt-4o-mini");
    await firewallCascade(benignBody, "gpt-4o-mini");
    await firewallCascade(benignBody, "gpt-4o-mini");

    const snap = getFirewallMetricsSnapshot();
    expect(snap.exactCacheHits).toBeGreaterThanOrEqual(3);
    expect(snap.cacheHitRate).toBeGreaterThan(0);
    expect(snap.cacheHitRate).toBeLessThanOrEqual(1);
  });

  test("resetFirewallStateForTests clears delta + in-flight state", async () => {
    // Seed and scan once to populate delta state for a session.
    firewallLocalCache.set(benignBody, {
      finalBody: benignBody,
      blocked: false,
    });
    await firewallCascade(benignBody, "gpt-4o-mini", false, "reset-test");

    __resetFirewallStateForTests();
    firewallLocalCache.clear();
    resetFirewallMetrics();

    const fresh = await firewallCascade(
      secretBody,
      "gpt-4o-mini",
      false,
      "reset-test",
    );
    // Cache was cleared so we should actually run the cascade again. With
    // secretBody, L1 catches it → blocked=true, cachedHit falsy.
    expect(fresh.blocked).toBe(true);
    expect(fresh.cachedHit).toBeFalsy();
  });
});
