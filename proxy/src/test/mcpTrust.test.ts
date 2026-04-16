/**
 * Tests for MCP Trust Service — Phase J.J2
 * SECURITY_HARDENING_PLAN.md.
 *
 * Covers both layers:
 *   - fingerprint trust persistence + change detection
 *   - manifest scan denylist + secret detection
 * Plus the combined `evaluateTrust` decision matrix.
 */

import assert from "node:assert";
import {
  evaluateTrust,
  getLastDecisionForSource,
  getTrustRecord,
  scanManifest,
  setTrustDecision,
} from "../services/mcpTrustService";
import type { McpServerDef } from "../services/mcpDiscoveryService";

// ── Helpers ─────────────────────────────────────────────────────

let counter = 0;
/** Make a unique project path so test runs don't see each other's rows. */
function uniqueProject(label: string): string {
  counter += 1;
  return `/tmp/mcp-trust-test/${label}-${Date.now()}-${counter}`;
}

const SAMPLE_FP =
  "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
const ALT_FP =
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

const SAFE_SERVER: McpServerDef = {
  type: "stdio",
  command: "npx",
  args: ["-y", "chrome-devtools-mcp@latest"],
};

// ── Manifest scan: denylist ─────────────────────────────────────

export function testScanManifestPassesSafeServer() {
  const result = scanManifest(SAFE_SERVER);
  assert.strictEqual(result.allowed, true);
  assert.deepStrictEqual(result.reasons, []);
}

export function testScanManifestRejectsDenylistedPackage() {
  const bad: McpServerDef = {
    command: "npx",
    args: ["-y", "@modelcontextprotocoll/some-typo"], // double-l typo
  };
  const result = scanManifest(bad);
  assert.strictEqual(result.allowed, false);
  assert.ok(
    result.reasons.some((r) => r.toLowerCase().includes("denylist")),
    "Should explain denylist hit",
  );
}

export function testScanManifestRejectsBackdoorKeyword() {
  const bad: McpServerDef = {
    command: "node",
    args: ["./backdoor-server.js"],
  };
  const result = scanManifest(bad);
  assert.strictEqual(result.allowed, false);
}

// ── Manifest scan: secret detection ────────────────────────────

export function testScanManifestRejectsLeakedSecretInEnv() {
  const bad: McpServerDef = {
    command: "npx",
    args: ["-y", "some-server"],
    env: {
      // A real-shape OpenAI project key the scanner catches.
      OPENAI_API_KEY: "sk-proj-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAxyz_",
    },
  };
  const result = scanManifest(bad);
  assert.strictEqual(result.allowed, false);
  assert.ok(
    result.reasons.some((r) => r.includes("OPENAI_PROJECT_KEY")),
    "Should report the OPENAI_PROJECT_KEY finding",
  );
}

// ── Persistence ────────────────────────────────────────────────

export function testSetAndGetTrustRecord() {
  const project = uniqueProject("trust-persist");
  const source = `${project}/.mcp.json`;

  assert.strictEqual(
    getTrustRecord(project, source, SAMPLE_FP),
    null,
    "No record before write",
  );

  setTrustDecision({
    projectPath: project,
    sourcePath: source,
    fingerprint: SAMPLE_FP,
    decision: "trusted",
    userId: 42,
  });

  const got = getTrustRecord(project, source, SAMPLE_FP);
  assert.ok(got !== null);
  assert.strictEqual(got!.decision, "trusted");
  assert.strictEqual(got!.decidedByUserId, 42);
}

export function testSetTrustDecisionIsIdempotent() {
  const project = uniqueProject("trust-idempotent");
  const source = `${project}/.mcp.json`;

  setTrustDecision({
    projectPath: project,
    sourcePath: source,
    fingerprint: SAMPLE_FP,
    decision: "trusted",
    userId: 1,
  });
  setTrustDecision({
    projectPath: project,
    sourcePath: source,
    fingerprint: SAMPLE_FP,
    decision: "denied",
    userId: 2,
  });

  const got = getTrustRecord(project, source, SAMPLE_FP);
  assert.ok(got !== null);
  // Second write wins.
  assert.strictEqual(got!.decision, "denied");
  assert.strictEqual(got!.decidedByUserId, 2);
}

export function testGetLastDecisionForSourceReturnsNewest() {
  const project = uniqueProject("trust-newest");
  const source = `${project}/.mcp.json`;

  setTrustDecision({
    projectPath: project,
    sourcePath: source,
    fingerprint: SAMPLE_FP,
    decision: "trusted",
    userId: null,
  });
  // Force a millisecond gap so the timestamps differ deterministically.
  const start = Date.now();
  while (Date.now() === start) {
    /* spin */
  }
  setTrustDecision({
    projectPath: project,
    sourcePath: source,
    fingerprint: ALT_FP,
    decision: "denied",
    userId: null,
  });

  const latest = getLastDecisionForSource(project, source);
  assert.ok(latest !== null);
  assert.strictEqual(
    latest!.fingerprint,
    ALT_FP,
    "Latest decision should be for ALT_FP (the more recent write)",
  );
  assert.strictEqual(latest!.decision, "denied");
}

// ── evaluateTrust matrix ───────────────────────────────────────

export function testEvaluateTrustNeedsPromptOnFirstEncounter() {
  const project = uniqueProject("eval-first");
  const result = evaluateTrust({
    projectPath: project,
    sourcePath: `${project}/.mcp.json`,
    fingerprint: SAMPLE_FP,
    server: SAFE_SERVER,
  });
  assert.strictEqual(result.allowed, false);
  assert.strictEqual(result.reason.kind, "needs-prompt");
}

export function testEvaluateTrustAllowsAfterTrustedDecision() {
  const project = uniqueProject("eval-trusted");
  const source = `${project}/.mcp.json`;

  setTrustDecision({
    projectPath: project,
    sourcePath: source,
    fingerprint: SAMPLE_FP,
    decision: "trusted",
    userId: null,
  });

  const result = evaluateTrust({
    projectPath: project,
    sourcePath: source,
    fingerprint: SAMPLE_FP,
    server: SAFE_SERVER,
  });
  assert.strictEqual(result.allowed, true);
  assert.strictEqual(result.reason.kind, "trusted");
}

export function testEvaluateTrustBlocksDeniedDecision() {
  const project = uniqueProject("eval-denied");
  const source = `${project}/.mcp.json`;

  setTrustDecision({
    projectPath: project,
    sourcePath: source,
    fingerprint: SAMPLE_FP,
    decision: "denied",
    userId: null,
  });

  const result = evaluateTrust({
    projectPath: project,
    sourcePath: source,
    fingerprint: SAMPLE_FP,
    server: SAFE_SERVER,
  });
  assert.strictEqual(result.allowed, false);
  assert.strictEqual(result.reason.kind, "denied-by-user");
}

export function testEvaluateTrustRejectsFingerprintChange() {
  const project = uniqueProject("eval-fpchange");
  const source = `${project}/.mcp.json`;

  setTrustDecision({
    projectPath: project,
    sourcePath: source,
    fingerprint: SAMPLE_FP,
    decision: "trusted",
    userId: null,
  });

  // The file has changed — new fingerprint, no record for it.
  const result = evaluateTrust({
    projectPath: project,
    sourcePath: source,
    fingerprint: ALT_FP,
    server: SAFE_SERVER,
  });
  assert.strictEqual(result.allowed, false);
  assert.strictEqual(result.reason.kind, "fingerprint-changed");
}

export function testEvaluateTrustManifestBlockOverridesTrust() {
  const project = uniqueProject("eval-manifest-override");
  const source = `${project}/.mcp.json`;

  // User mistakenly trusted a malicious manifest in the past.
  setTrustDecision({
    projectPath: project,
    sourcePath: source,
    fingerprint: SAMPLE_FP,
    decision: "trusted",
    userId: null,
  });

  const malicious: McpServerDef = {
    command: "node",
    args: ["./backdoor-server.js"],
  };
  const result = evaluateTrust({
    projectPath: project,
    sourcePath: source,
    fingerprint: SAMPLE_FP,
    server: malicious,
  });
  // Layer 2 must override Layer 1.
  assert.strictEqual(result.allowed, false);
  assert.strictEqual(result.reason.kind, "manifest-blocked");
}
