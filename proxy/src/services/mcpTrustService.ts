/**
 * MCP Trust Service — Phase J.J2 (SECURITY_HARDENING_PLAN.md).
 *
 * Two-layer trust check before a discovered `.mcp.json` server is
 * exposed to the agent:
 *
 *   1. Fingerprint trust — SHA-256 of the source `.mcp.json` content
 *      is recorded in the `mcp_trust` table. A user's "trusted"
 *      decision is sticky for that exact fingerprint; any edit to
 *      the file changes the hash and re-prompts.
 *
 *   2. Manifest scan — the spawned server's `command` / `args` /
 *      package name is run through the scanner pipeline so the
 *      policy can deny known-malicious packages even if the user
 *      previously trusted that fingerprint by mistake.
 *
 * Defense-in-depth: a server passes ONLY if both layers approve.
 *
 * SOLID:
 *   - SRP: trust decisions only (no UI, no transport, no discovery).
 *   - DIP: takes raw fingerprint + server def; doesn't read files.
 *   - OCP: extra trust signals (publisher signing, etc.) slot into
 *     `evaluateTrust` without touching call sites.
 */

import { and, eq } from "drizzle-orm";
import { scanSecrets } from "@ai-firewall/scanner";

import { db } from "../db";
import { mcpTrust } from "../db/schema";
import type { McpServerDef } from "./mcpDiscoveryService";

// ── Types ───────────────────────────────────────────────────────

export type McpTrustDecision = "trusted" | "denied" | "pending";

export interface McpTrustRecord {
  readonly projectPath: string;
  readonly sourcePath: string;
  readonly fingerprint: string;
  readonly decision: McpTrustDecision;
  readonly decidedAt: number;
  readonly decidedByUserId: number | null;
}

export type McpTrustGateReason =
  | { kind: "trusted" }
  | { kind: "needs-prompt"; reason: string }
  | { kind: "fingerprint-changed"; previousDecision: McpTrustDecision }
  | { kind: "denied-by-user" }
  | { kind: "manifest-blocked"; reasons: readonly string[] };

export interface McpTrustGateResult {
  readonly allowed: boolean;
  readonly reason: McpTrustGateReason;
}

// Hard-coded denylist of known-bad MCP packages. Anything matching a
// pattern here is rejected regardless of the user's trust decision —
// this is the "second layer" the plan calls out as defense-in-depth.
// Patterns intentionally lean conservative: the goal is to catch
// obvious typosquats and self-described "exploit" / "backdoor"
// packages, not to compete with a full supply-chain scanner.
//
// Patterns are NOT start-anchored — the manifest surface string
// includes the launcher (e.g. `npx -y @scope/pkg`), so the denylist
// match must be substring-style.
const MANIFEST_DENYLIST: readonly RegExp[] = [
  /\b(?:malware|backdoor|exploit-kit|crypto-?miner)\b/i,
  // Common typosquats of legitimate MCP packages.
  /@?modelcontextprotocoll\b/i,
  /@?modelcontextprotokol\b/i,
];

// ── Trust persistence ──────────────────────────────────────────

/**
 * Look up the current trust record for a (projectPath, sourcePath,
 * fingerprint) tuple. Returns null if the user has never seen this
 * exact fingerprint for this source.
 */
export function getTrustRecord(
  projectPath: string,
  sourcePath: string,
  fingerprint: string,
): McpTrustRecord | null {
  const row = db
    .select()
    .from(mcpTrust)
    .where(
      and(
        eq(mcpTrust.projectPath, projectPath),
        eq(mcpTrust.sourcePath, sourcePath),
        eq(mcpTrust.fingerprint, fingerprint),
      ),
    )
    .get();
  if (!row) return null;
  return {
    projectPath: row.projectPath,
    sourcePath: row.sourcePath,
    fingerprint: row.fingerprint,
    decision: row.decision as McpTrustDecision,
    decidedAt: row.decidedAt,
    decidedByUserId: row.decidedByUserId ?? null,
  };
}

/**
 * Look up the most recent trust record for a (projectPath, sourcePath)
 * pair regardless of fingerprint. Used to surface "the file changed
 * since you last approved it" in the prompt.
 */
export function getLastDecisionForSource(
  projectPath: string,
  sourcePath: string,
): McpTrustRecord | null {
  const rows = db
    .select()
    .from(mcpTrust)
    .where(
      and(
        eq(mcpTrust.projectPath, projectPath),
        eq(mcpTrust.sourcePath, sourcePath),
      ),
    )
    .all();
  if (rows.length === 0) return null;
  // Latest first.
  rows.sort((a, b) => b.decidedAt - a.decidedAt);
  const row = rows[0];
  return {
    projectPath: row.projectPath,
    sourcePath: row.sourcePath,
    fingerprint: row.fingerprint,
    decision: row.decision as McpTrustDecision,
    decidedAt: row.decidedAt,
    decidedByUserId: row.decidedByUserId ?? null,
  };
}

/**
 * Record a user trust decision. Idempotent on (projectPath,
 * sourcePath, fingerprint) — re-running with the same key updates
 * the decision rather than inserting a duplicate.
 */
export function setTrustDecision(args: {
  projectPath: string;
  sourcePath: string;
  fingerprint: string;
  decision: "trusted" | "denied";
  userId: number | null;
}): void {
  const existing = getTrustRecord(
    args.projectPath,
    args.sourcePath,
    args.fingerprint,
  );
  const now = Date.now();
  if (existing) {
    db.update(mcpTrust)
      .set({
        decision: args.decision,
        decidedAt: now,
        decidedByUserId: args.userId,
      })
      .where(
        and(
          eq(mcpTrust.projectPath, args.projectPath),
          eq(mcpTrust.sourcePath, args.sourcePath),
          eq(mcpTrust.fingerprint, args.fingerprint),
        ),
      )
      .run();
    return;
  }
  db.insert(mcpTrust)
    .values({
      projectPath: args.projectPath,
      sourcePath: args.sourcePath,
      fingerprint: args.fingerprint,
      decision: args.decision,
      decidedAt: now,
      decidedByUserId: args.userId,
    })
    .run();
}

// ── Manifest scanning ──────────────────────────────────────────

/**
 * Build a single string representing every byte the MCP server's
 * spawn manifest would inject into the proxy's process tree —
 * `command`, every arg, every env value, and any URL. This is what
 * the scanner pipeline inspects.
 */
function manifestSurface(server: McpServerDef): string {
  const parts: string[] = [];
  if (typeof server.command === "string") parts.push(server.command);
  if (Array.isArray(server.args)) parts.push(...server.args);
  if (server.env && typeof server.env === "object") {
    for (const v of Object.values(server.env)) {
      if (typeof v === "string") parts.push(v);
    }
  }
  if (typeof server.url === "string") parts.push(server.url);
  return parts.join(" ");
}

/**
 * Scan the manifest surface against the denylist and the secret
 * scanner. A match in either layer rejects the server. The secret
 * scan catches API keys mistakenly checked into a `.mcp.json` `env`
 * block — that's a separate leak we want to refuse to spawn.
 */
export function scanManifest(server: McpServerDef): {
  allowed: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];
  const surface = manifestSurface(server);

  for (const pattern of MANIFEST_DENYLIST) {
    if (pattern.test(surface)) {
      reasons.push(
        `MCP server manifest matched denylist pattern ${pattern.source}`,
      );
    }
  }

  const secrets = scanSecrets(surface);
  if (secrets.hasSecrets) {
    for (const s of secrets.secrets) {
      reasons.push(
        `MCP server manifest contains a likely ${s.type} (severity ${s.severity}) — ` +
          `keys belong in a vault, not in .mcp.json. Refusing to spawn.`,
      );
    }
  }

  return { allowed: reasons.length === 0, reasons };
}

// ── Trust gate ─────────────────────────────────────────────────

/**
 * Run both layers (fingerprint trust + manifest scan) and return
 * a single decision the gateway can act on. Read-only — does NOT
 * record a new trust decision; that's the caller's job after the
 * user responds to the prompt.
 */
export function evaluateTrust(args: {
  projectPath: string;
  sourcePath: string;
  fingerprint: string;
  server: McpServerDef;
}): McpTrustGateResult {
  // Layer 2 first: a denylist hit short-circuits regardless of user
  // trust history. We never want a "trusted" decision to override a
  // hard-blocked package.
  const manifestResult = scanManifest(args.server);
  if (!manifestResult.allowed) {
    return {
      allowed: false,
      reason: { kind: "manifest-blocked", reasons: manifestResult.reasons },
    };
  }

  // Layer 1: fingerprint trust.
  const exact = getTrustRecord(
    args.projectPath,
    args.sourcePath,
    args.fingerprint,
  );
  if (exact) {
    if (exact.decision === "trusted") {
      return { allowed: true, reason: { kind: "trusted" } };
    }
    if (exact.decision === "denied") {
      return { allowed: false, reason: { kind: "denied-by-user" } };
    }
  }

  // Has the user seen any earlier version of this source?
  const previous = getLastDecisionForSource(args.projectPath, args.sourcePath);
  if (previous && previous.fingerprint !== args.fingerprint) {
    return {
      allowed: false,
      reason: {
        kind: "fingerprint-changed",
        previousDecision: previous.decision,
      },
    };
  }

  // First encounter — needs the prompt.
  return {
    allowed: false,
    reason: {
      kind: "needs-prompt",
      reason: previous
        ? "Previously decided as 'pending' — prompt the user."
        : "Unknown source — prompt the user before spawning.",
    },
  };
}

// ── Test affordance ─────────────────────────────────────────────

export const _internal = { MANIFEST_DENYLIST };
