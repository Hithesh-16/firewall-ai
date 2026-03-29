/**
 * Enterprise Infrastructure Tests (Phase 5)
 *
 * Tests cache layer, license system, and webhook queue.
 */

import assert from "node:assert";
import { createMemoryAdapter } from "../cache/memoryAdapter";
import {
  verifyLicense,
  activateLicense,
  deactivateLicense,
  getLicenseState,
  hasFeature,
} from "../license/licenseVerifier";
import {
  enqueueWebhookEvent,
  getDeliveries,
} from "../services/webhookQueue";

// --- Memory Cache Adapter ---

export async function testCacheSetAndGet() {
  const cache = createMemoryAdapter();
  await cache.set("key1", "value1");
  const result = await cache.get("key1");
  assert.strictEqual(result, "value1", "Should get stored value");
  await cache.close();
}

export async function testCacheTTLExpiry() {
  const cache = createMemoryAdapter();
  await cache.set("ttl-key", "temp", 1); // 1 second TTL
  const before = await cache.get("ttl-key");
  assert.strictEqual(before, "temp", "Should exist before expiry");

  // Wait for expiry
  await new Promise((r) => setTimeout(r, 1100));
  const after = await cache.get("ttl-key");
  assert.strictEqual(after, null, "Should be null after TTL expiry");
  await cache.close();
}

export async function testCacheDelete() {
  const cache = createMemoryAdapter();
  await cache.set("del-key", "value");
  const deleted = await cache.del("del-key");
  assert.strictEqual(deleted, true, "Should return true for existing key");
  const result = await cache.get("del-key");
  assert.strictEqual(result, null, "Should be null after delete");
  await cache.close();
}

export async function testCacheIncrement() {
  const cache = createMemoryAdapter();
  const v1 = await cache.incr("counter");
  assert.strictEqual(v1, 1, "First incr should be 1");
  const v2 = await cache.incr("counter");
  assert.strictEqual(v2, 2, "Second incr should be 2");
  await cache.close();
}

export async function testCacheMiss() {
  const cache = createMemoryAdapter();
  const result = await cache.get("nonexistent");
  assert.strictEqual(result, null, "Cache miss should return null");
  await cache.close();
}

// --- License Verifier ---

export function testLicenseVerifyInvalid() {
  const result = verifyLicense("invalid-key");
  assert.strictEqual(result, null, "Invalid key should return null");
}

export function testLicenseVerifyMalformed() {
  const result = verifyLicense("not.a.valid.key.format");
  assert.strictEqual(result, null, "Malformed key should return null");
}

export function testLicenseActivateInvalid() {
  const state = activateLicense("bad-key");
  assert.strictEqual(state.plan, "community", "Invalid key should give community plan");
}

export function testLicenseDeactivate() {
  deactivateLicense();
  const state = getLicenseState();
  assert.strictEqual(state.plan, "community", "After deactivation should be community");
  assert.strictEqual(state.active, true, "Community should still be active");
}

export function testLicenseDevModeAcceptsPayload() {
  // Without LICENSE_PUBLIC_KEY env, dev mode accepts any well-formed payload
  const payload = {
    plan: "team",
    features: ["rbac", "webhooks:streaming"],
    seats: 10,
    orgId: "test-org",
    expiresAt: Date.now() + 86400000, // 24h from now
    issuedAt: Date.now(),
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const fakeSignature = Buffer.from("fake-sig").toString("base64url");

  const result = verifyLicense(`${encoded}.${fakeSignature}`);
  assert.ok(result !== null, "Dev mode should accept well-formed payload");
  assert.strictEqual(result!.plan, "team");
  assert.ok(result!.features.includes("rbac"), "Should have rbac feature");
}

export function testHasFeatureWithLicense() {
  const payload = {
    plan: "enterprise",
    features: ["rbac", "sso:saml", "compliance:soc2"],
    seats: 50,
    orgId: "enterprise-org",
    expiresAt: Date.now() + 86400000,
    issuedAt: Date.now(),
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const fakeSignature = Buffer.from("sig").toString("base64url");
  activateLicense(`${encoded}.${fakeSignature}`);

  assert.strictEqual(hasFeature("rbac"), true, "Should have rbac");
  assert.strictEqual(hasFeature("sso:saml"), true, "Should have sso:saml");
  assert.strictEqual(hasFeature("nonexistent"), false, "Should not have nonexistent feature");

  deactivateLicense(); // Cleanup
}

// --- Webhook Queue ---

export function testWebhookEnqueue() {
  // This tests the enqueue function — delivery requires a running server
  // Since we may not have any enabled webhooks in test DB, it should return 0
  const queued = enqueueWebhookEvent("test_event", { data: "test" });
  assert.ok(queued >= 0, "Should return number of queued deliveries (0 if no webhooks)");
}

export function testWebhookGetDeliveries() {
  const deliveries = getDeliveries(999, 10); // Non-existent webhook
  assert.ok(Array.isArray(deliveries), "Should return array");
  assert.strictEqual(deliveries.length, 0, "Should be empty for non-existent webhook");
}
