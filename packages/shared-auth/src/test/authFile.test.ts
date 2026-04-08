import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  loadAuthFile,
  saveAuthFile,
  deleteAuthFile,
  isAuthValid,
  normalizeAuthFile,
  getAuthFilePath,
  watchAuthFile,
} from "../authFile.js";
import { buildWebLoginUrl, generateStateNonce } from "../webLoginUrl.js";
import { startLoopbackTokenServer } from "../loopbackServer.js";
import type { SharedAuthFile } from "../types.js";

function tmpFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shared-auth-"));
  return path.join(dir, "auth.json");
}

const sample: SharedAuthFile = {
  version: 1,
  proxyUrl: "http://localhost:8080",
  accessToken: "afw_" + "a".repeat(64),
  user: { id: 7, email: "t@example.com", role: "admin", orgId: 1 },
  savedAt: Date.now(),
  savedBy: "web",
  onboardingComplete: true,
};

test("saveAuthFile + loadAuthFile roundtrip", () => {
  const file = tmpFile();
  saveAuthFile(sample, file);
  const loaded = loadAuthFile(file);
  assert.equal(loaded?.accessToken, sample.accessToken);
  assert.equal(loaded?.user.email, "t@example.com");
  assert.equal(loaded?.onboardingComplete, true);
});

test("saveAuthFile writes with 0600 permissions on POSIX", () => {
  if (process.platform === "win32") return;
  const file = tmpFile();
  saveAuthFile(sample, file);
  const stat = fs.statSync(file);
  // Mask to just the permission bits
  assert.equal(stat.mode & 0o777, 0o600);
});

test("loadAuthFile returns null for missing file", () => {
  assert.equal(loadAuthFile(tmpFile()), null);
});

test("loadAuthFile returns null for garbage", () => {
  const file = tmpFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "not-json");
  assert.equal(loadAuthFile(file), null);
});

test("normalizeAuthFile accepts legacy CLI shape", () => {
  const legacy = {
    userId: 42,
    userEmail: "jane@example.com",
    accessToken: "afw_legacy",
    organizationId: 3,
    expiresAt: Date.now() + 60_000,
  };
  const out = normalizeAuthFile(legacy);
  assert.ok(out);
  assert.equal(out?.user.id, 42);
  assert.equal(out?.user.email, "jane@example.com");
  assert.equal(out?.user.orgId, 3);
  assert.equal(out?.savedBy, "cli");
});

test("normalizeAuthFile rejects payloads without accessToken", () => {
  assert.equal(normalizeAuthFile({ userId: 1 }), null);
  assert.equal(normalizeAuthFile(null), null);
  assert.equal(normalizeAuthFile(42 as unknown), null);
});

test("isAuthValid checks token presence and expiry", () => {
  assert.equal(isAuthValid(null), false);
  assert.equal(isAuthValid({ ...sample, accessToken: "" }), false);
  assert.equal(isAuthValid({ ...sample, expiresAt: Date.now() - 1000 }), false);
  assert.equal(
    isAuthValid({ ...sample, expiresAt: Date.now() + 10_000 }),
    true,
  );
  // Missing expiresAt is treated as non-expiring
  assert.equal(isAuthValid({ ...sample, expiresAt: undefined }), true);
});

test("deleteAuthFile is idempotent", () => {
  const file = tmpFile();
  saveAuthFile(sample, file);
  assert.ok(fs.existsSync(file));
  deleteAuthFile(file);
  assert.equal(fs.existsSync(file), false);
  // Second call: no throw
  deleteAuthFile(file);
});

test("getAuthFilePath honors AI_FIREWALL_GLOBAL_DIR", () => {
  const prev = process.env.AI_FIREWALL_GLOBAL_DIR;
  process.env.AI_FIREWALL_GLOBAL_DIR = "/tmp/custom-af";
  try {
    assert.equal(getAuthFilePath(), path.join("/tmp/custom-af", "auth.json"));
  } finally {
    if (prev === undefined) delete process.env.AI_FIREWALL_GLOBAL_DIR;
    else process.env.AI_FIREWALL_GLOBAL_DIR = prev;
  }
});

test("buildWebLoginUrl formats query string correctly", () => {
  assert.equal(
    buildWebLoginUrl({
      proxyUrl: "http://localhost:8080",
      return: "cli",
      port: 19836,
      state: "abc",
    }),
    "http://localhost:8080/web-login-start?return=cli&port=19836&state=abc",
  );
  assert.equal(
    buildWebLoginUrl({
      proxyUrl: "https://firewall.acme.com/",
      return: "vscode",
      callback: "vscode://publisher.ai-firewall/authCallback",
    }),
    "https://firewall.acme.com/web-login-start?return=vscode&callback=vscode%3A%2F%2Fpublisher.ai-firewall%2FauthCallback",
  );
});

test("generateStateNonce produces 12-char base36 string", () => {
  const nonce = generateStateNonce();
  assert.equal(nonce.length, 12);
  assert.match(nonce, /^[0-9a-z]+$/);
});

test("watchAuthFile fires when file changes", async () => {
  const file = tmpFile();
  saveAuthFile(sample, file);
  const events: Array<SharedAuthFile | null> = [];
  const stop = watchAuthFile((auth) => events.push(auth), file);
  try {
    // Give fs.watch a tick to register
    await new Promise((r) => setTimeout(r, 50));
    saveAuthFile({ ...sample, accessToken: "afw_changed" }, file);
    await new Promise((r) => setTimeout(r, 300));
    const seen = events.find((e) => e?.accessToken === "afw_changed");
    assert.ok(seen, "expected change event");
  } finally {
    stop();
  }
});

test("startLoopbackTokenServer receives token via HTTP GET", async () => {
  const state = generateStateNonce();
  const waiter = startLoopbackTokenServer({
    port: 29836,
    portRange: 5,
    state,
    timeoutMs: 5_000,
  });
  // Give the server a moment to bind
  await new Promise((r) => setTimeout(r, 50));

  // Fire a request — we don't know the port yet if there was a collision, so
  // retry the range until one responds.
  let lastErr: unknown = null;
  for (let p = 29836; p < 29841; p++) {
    try {
      await fetch(`http://127.0.0.1:${p}/?token=afw_test&state=${state}`);
      break;
    } catch (e) {
      lastErr = e;
    }
  }

  const res = await waiter;
  assert.equal(res.token, "afw_test");
  assert.ok(
    res.port >= 29836 && res.port < 29841,
    `port ${res.port} out of range`,
  );
  if (lastErr && !res) throw lastErr;
});

test("startLoopbackTokenServer rejects bad state nonce", async () => {
  const waiter = startLoopbackTokenServer({
    port: 29850,
    state: "correct",
    timeoutMs: 3_000,
  });
  // Attach the expectation eagerly so the eventual rejection is always observed.
  const rejection = assert.rejects(waiter, /state nonce mismatch/);
  await new Promise((r) => setTimeout(r, 50));
  for (let p = 29850; p < 29860; p++) {
    try {
      await fetch(`http://127.0.0.1:${p}/?token=afw_bad&state=wrong`);
      break;
    } catch {
      /* try next port */
    }
  }
  await rejection;
});
