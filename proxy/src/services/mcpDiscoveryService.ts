/**
 * MCP Discovery Service — Phase J.J1 (SECURITY_HARDENING_PLAN.md).
 *
 * Reads `.mcp.json` files from three locations in precedence order
 * (project root → project/.ai-firewall → ~/.ai-firewall) and returns
 * the merged effective server set. Project-scoped entries override
 * user-scoped entries by server name (most-specific wins, same
 * pattern we use for `policy.json` and `config.yaml`).
 *
 * Design split:
 *   - `discoverMcpServers(projectPath)` is PURE READ. No side effects.
 *     Use it from the GUI to list candidates without committing.
 *   - `syncDiscoveredToCore(merged)` writes the merged set to
 *     `~/.ai-firewall/mcpServers/discovered-from-mcpjson.json` where
 *     core's existing `loadJsonMcpConfigs.ts` will pick it up on its
 *     next refresh.
 *   - The boundary between read and sync is where Phase J.J2 (trust
 *     store) inserts the user-trust prompt — discover always works,
 *     but sync only happens after the fingerprint is trusted.
 *
 * SOLID:
 *   - SRP: discovery only — no policy decisions, no transport, no UI.
 *   - DIP: takes `projectPath` as a string; no IDE dependency.
 *   - OCP: new precedence locations slot in via the `SOURCE_ORDER`
 *     array without touching call sites.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// ── Public types ────────────────────────────────────────────────

/**
 * The Claude-Desktop-compatible shape inside a `.mcp.json` file.
 * `command` + `args` for stdio; `url` for HTTP/SSE; `env` for env
 * passthrough. Validation is intentionally permissive — we keep
 * unknown fields and pass them through to core's loader, which has
 * the canonical schema in `@ai-firewall/config-yaml`.
 */
export interface McpServerDef {
  readonly type?: "stdio" | "http" | "sse";
  readonly command?: string;
  readonly args?: readonly string[];
  readonly env?: Record<string, string>;
  readonly url?: string;
  readonly headers?: Record<string, string>;
  readonly [key: string]: unknown;
}

export type McpScope = "project-root" | "project-firewall" | "user-firewall";

export interface DiscoveredMcpSource {
  readonly scope: McpScope;
  readonly path: string;
  readonly servers: Record<string, McpServerDef>;
  /** SHA-256 of the file content. Used by Phase J.J2 trust store. */
  readonly fingerprint: string;
}

export interface DiscoveredMcpResult {
  /** Sources in the order they were read (high precedence last). */
  readonly sources: readonly DiscoveredMcpSource[];
  /** The effective merged set after applying precedence. */
  readonly effective: Record<string, McpServerDef>;
}

// ── Discovery ──────────────────────────────────────────────────

/**
 * Precedence order, LOWEST first. The merge in `discoverMcpServers`
 * walks this list and lets later entries OVERWRITE earlier ones for
 * the same server name — so the most-specific (project root) wins.
 */
const SOURCE_ORDER: readonly { scope: McpScope; relative: string }[] = [
  { scope: "user-firewall", relative: "" }, // resolved against ~/.ai-firewall
  { scope: "project-firewall", relative: ".ai-firewall/.mcp.json" },
  { scope: "project-root", relative: ".mcp.json" },
];

function userFirewallMcpJsonPath(): string {
  return path.join(os.homedir(), ".ai-firewall", ".mcp.json");
}

function readJsonIfExists(filePath: string): {
  raw: string;
  parsed: unknown;
} | null {
  if (!fs.existsSync(filePath)) return null;
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
  try {
    return { raw, parsed: JSON.parse(raw) };
  } catch {
    // Malformed JSON — surface as null. The caller can decide whether
    // to log; we don't want a typo in one project's `.mcp.json` to
    // poison discovery for the others.
    return null;
  }
}

/**
 * Pull `mcpServers` out of either Claude Desktop shape (top-level
 * `mcpServers`) or a flat `{ name: serverDef }` shape. Returns an
 * empty object when neither pattern matches.
 */
function extractServers(parsed: unknown): Record<string, McpServerDef> {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const obj = parsed as Record<string, unknown>;

  // Claude Desktop / Claude Code shape: { "mcpServers": { ... } }
  if (
    obj.mcpServers &&
    typeof obj.mcpServers === "object" &&
    !Array.isArray(obj.mcpServers)
  ) {
    return obj.mcpServers as Record<string, McpServerDef>;
  }

  // Flat shape: every top-level value that looks like a server def.
  // We accept anything with `command` or `url` to be lenient.
  const out: Record<string, McpServerDef> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const v = value as Record<string, unknown>;
    if (typeof v.command === "string" || typeof v.url === "string") {
      out[key] = v as McpServerDef;
    }
  }
  return out;
}

function fingerprintOf(raw: string): string {
  return crypto.createHash("sha256").update(raw, "utf8").digest("hex");
}

/**
 * Read every `.mcp.json` from the precedence list, parse, and merge.
 * Pure function — no side effects.
 *
 * Project root is anchored at `projectPath`. The user-firewall path
 * is always at `~/.ai-firewall/.mcp.json` regardless of project.
 */
export function discoverMcpServers(projectPath: string): DiscoveredMcpResult {
  const sources: DiscoveredMcpSource[] = [];
  const merged: Record<string, McpServerDef> = {};

  for (const { scope, relative } of SOURCE_ORDER) {
    const filePath =
      scope === "user-firewall"
        ? userFirewallMcpJsonPath()
        : path.join(projectPath, relative);

    const file = readJsonIfExists(filePath);
    if (!file) continue;

    const servers = extractServers(file.parsed);
    if (Object.keys(servers).length === 0) continue;

    sources.push({
      scope,
      path: filePath,
      servers,
      fingerprint: fingerprintOf(file.raw),
    });

    // Project-most-specific wins: walk in SOURCE_ORDER, later
    // entries overwrite earlier ones for the same name.
    for (const [name, def] of Object.entries(servers)) {
      merged[name] = def;
    }
  }

  return { sources, effective: merged };
}

// ── Sync to core ──────────────────────────────────────────────

const DISCOVERED_BRIDGE_FILE = "discovered-from-mcpjson.json";

function bridgeDir(): string {
  return path.join(os.homedir(), ".ai-firewall", "mcpServers");
}

function bridgeFilePath(): string {
  return path.join(bridgeDir(), DISCOVERED_BRIDGE_FILE);
}

/**
 * Write the merged effective set into core's MCP config directory in
 * the Claude-Desktop-compatible `{ mcpServers: { ... } }` shape so
 * `core/context/mcp/json/loadJsonMcpConfigs.ts` picks it up on its
 * next refresh.
 *
 * Phase J.J2 (trust store) gates this call — discovery always works,
 * sync only happens after the fingerprint is trusted.
 */
export function syncDiscoveredToCore(
  effective: Record<string, McpServerDef>,
): void {
  const dir = bridgeDir();
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const payload = { mcpServers: effective };
  fs.writeFileSync(bridgeFilePath(), JSON.stringify(payload, null, 2), "utf8");
}

/**
 * Remove the discovered-bridge file. Used when the active project
 * changes (so a different workspace's `.mcp.json` doesn't bleed in)
 * or when the user explicitly revokes trust.
 */
export function clearDiscoveredBridge(): void {
  const p = bridgeFilePath();
  if (fs.existsSync(p)) {
    try {
      fs.unlinkSync(p);
    } catch {
      // ignore — the next sync overwrites the file anyway
    }
  }
}

// ── Test affordance ─────────────────────────────────────────────

/**
 * For tests that need to assert against the bridge file path.
 */
export const _internal = {
  bridgeFilePath,
  userFirewallMcpJsonPath,
};
