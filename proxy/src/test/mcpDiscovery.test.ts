/**
 * Tests for MCP Discovery Service — Phase J.J1
 * SECURITY_HARDENING_PLAN.md.
 *
 * Covers the precedence order (project root → project/.ai-firewall →
 * ~/.ai-firewall), the Claude-Desktop / flat shape parsing, and the
 * sync/clear bridge-file lifecycle.
 */

import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  _internal,
  clearDiscoveredBridge,
  discoverMcpServers,
  syncDiscoveredToCore,
} from "../services/mcpDiscoveryService";

// ── Helpers ─────────────────────────────────────────────────────

function makeTmpProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "afw-mcp-discovery-test-"));
  return dir;
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

function cleanupHomeMcpJson(): string | null {
  const p = _internal.userFirewallMcpJsonPath();
  let backup: string | null = null;
  if (fs.existsSync(p)) {
    backup = fs.readFileSync(p, "utf8");
    fs.unlinkSync(p);
  }
  return backup;
}

function restoreHomeMcpJson(backup: string | null): void {
  const p = _internal.userFirewallMcpJsonPath();
  if (backup !== null) {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, backup, "utf8");
  } else if (fs.existsSync(p)) {
    fs.unlinkSync(p);
  }
}

// ── Discovery: shape parsing ────────────────────────────────────

export function testDiscoverParsesClaudeDesktopShape() {
  const proj = makeTmpProject();
  const homeBackup = cleanupHomeMcpJson();
  try {
    writeJson(path.join(proj, ".mcp.json"), {
      mcpServers: {
        "fs-desktop": {
          type: "stdio",
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
        },
      },
    });

    const result = discoverMcpServers(proj);
    assert.strictEqual(result.sources.length, 1);
    assert.strictEqual(result.sources[0].scope, "project-root");
    assert.ok(
      result.effective["fs-desktop"],
      "fs-desktop must be in effective",
    );
    assert.strictEqual(result.effective["fs-desktop"].command, "npx");
  } finally {
    restoreHomeMcpJson(homeBackup);
    fs.rmSync(proj, { recursive: true, force: true });
  }
}

export function testDiscoverParsesFlatShape() {
  const proj = makeTmpProject();
  const homeBackup = cleanupHomeMcpJson();
  try {
    writeJson(path.join(proj, ".mcp.json"), {
      "fs-flat": {
        command: "fs-server",
        args: ["--root", "."],
      },
    });

    const result = discoverMcpServers(proj);
    assert.strictEqual(result.sources.length, 1);
    assert.ok(result.effective["fs-flat"]);
    assert.strictEqual(result.effective["fs-flat"].command, "fs-server");
  } finally {
    restoreHomeMcpJson(homeBackup);
    fs.rmSync(proj, { recursive: true, force: true });
  }
}

// ── Discovery: precedence ───────────────────────────────────────

export function testDiscoverProjectRootBeatsFirewallScope() {
  const proj = makeTmpProject();
  const homeBackup = cleanupHomeMcpJson();
  try {
    // project/.ai-firewall/.mcp.json — middle precedence
    writeJson(path.join(proj, ".ai-firewall", ".mcp.json"), {
      mcpServers: {
        api: { command: "from-firewall-scope" },
      },
    });
    // project/.mcp.json — highest precedence
    writeJson(path.join(proj, ".mcp.json"), {
      mcpServers: {
        api: { command: "from-project-root" },
      },
    });

    const result = discoverMcpServers(proj);
    assert.strictEqual(result.sources.length, 2);
    assert.strictEqual(
      result.effective["api"].command,
      "from-project-root",
      "Project root must override the .ai-firewall scope",
    );
  } finally {
    restoreHomeMcpJson(homeBackup);
    fs.rmSync(proj, { recursive: true, force: true });
  }
}

export function testDiscoverFirewallScopeBeatsUserHome() {
  const proj = makeTmpProject();
  const homeBackup = cleanupHomeMcpJson();
  try {
    // Write user-firewall (lowest)
    writeJson(_internal.userFirewallMcpJsonPath(), {
      mcpServers: {
        shared: { command: "from-user-home" },
      },
    });
    // Write project-firewall (middle)
    writeJson(path.join(proj, ".ai-firewall", ".mcp.json"), {
      mcpServers: {
        shared: { command: "from-project-firewall" },
      },
    });

    const result = discoverMcpServers(proj);
    // 2 sources merged
    assert.ok(
      result.sources.some((s) => s.scope === "user-firewall"),
      "Should pick up user-firewall source",
    );
    assert.ok(
      result.sources.some((s) => s.scope === "project-firewall"),
      "Should pick up project-firewall source",
    );
    assert.strictEqual(
      result.effective["shared"].command,
      "from-project-firewall",
      "Project firewall scope must override user firewall scope",
    );
  } finally {
    restoreHomeMcpJson(homeBackup);
    fs.rmSync(proj, { recursive: true, force: true });
  }
}

// ── Discovery: edge cases ───────────────────────────────────────

export function testDiscoverNoFilesReturnsEmpty() {
  const proj = makeTmpProject();
  const homeBackup = cleanupHomeMcpJson();
  try {
    const result = discoverMcpServers(proj);
    assert.strictEqual(result.sources.length, 0);
    assert.deepStrictEqual(result.effective, {});
  } finally {
    restoreHomeMcpJson(homeBackup);
    fs.rmSync(proj, { recursive: true, force: true });
  }
}

export function testDiscoverMalformedJsonIsSilentlySkipped() {
  const proj = makeTmpProject();
  const homeBackup = cleanupHomeMcpJson();
  try {
    fs.writeFileSync(
      path.join(proj, ".mcp.json"),
      "{ this is not json",
      "utf8",
    );
    // Also add a valid one in user home so we know the malformed file
    // didn't poison the rest.
    writeJson(_internal.userFirewallMcpJsonPath(), {
      mcpServers: { ok: { command: "valid" } },
    });

    const result = discoverMcpServers(proj);
    // Only the valid user-home source survives.
    assert.strictEqual(result.sources.length, 1);
    assert.strictEqual(result.sources[0].scope, "user-firewall");
    assert.strictEqual(result.effective["ok"].command, "valid");
  } finally {
    restoreHomeMcpJson(homeBackup);
    fs.rmSync(proj, { recursive: true, force: true });
  }
}

export function testDiscoverFingerprintIsStable() {
  const proj = makeTmpProject();
  const homeBackup = cleanupHomeMcpJson();
  try {
    writeJson(path.join(proj, ".mcp.json"), {
      mcpServers: { stable: { command: "x" } },
    });
    const a = discoverMcpServers(proj);
    const b = discoverMcpServers(proj);
    assert.strictEqual(a.sources[0].fingerprint, b.sources[0].fingerprint);
    assert.ok(
      a.sources[0].fingerprint.length === 64,
      "Should be 64-char SHA-256",
    );
  } finally {
    restoreHomeMcpJson(homeBackup);
    fs.rmSync(proj, { recursive: true, force: true });
  }
}

// ── Sync / clear ────────────────────────────────────────────────

export function testSyncWritesBridgeFile() {
  const bridgePath = _internal.bridgeFilePath();
  // Clean any previous run
  if (fs.existsSync(bridgePath)) fs.unlinkSync(bridgePath);

  syncDiscoveredToCore({ test: { command: "echo", args: ["hello"] } });

  assert.ok(fs.existsSync(bridgePath), "Bridge file must be written");
  const written = JSON.parse(fs.readFileSync(bridgePath, "utf8"));
  assert.ok(written.mcpServers, "Must wrap in {mcpServers}");
  assert.strictEqual(written.mcpServers.test.command, "echo");

  // Cleanup
  fs.unlinkSync(bridgePath);
}

export function testClearRemovesBridgeFile() {
  const bridgePath = _internal.bridgeFilePath();
  syncDiscoveredToCore({ tmp: { command: "x" } });
  assert.ok(fs.existsSync(bridgePath), "precondition: bridge file exists");

  clearDiscoveredBridge();
  assert.strictEqual(
    fs.existsSync(bridgePath),
    false,
    "clearDiscoveredBridge must remove the bridge file",
  );
}

export function testClearOnEmptyIsSafe() {
  const bridgePath = _internal.bridgeFilePath();
  if (fs.existsSync(bridgePath)) fs.unlinkSync(bridgePath);
  // Should not throw
  clearDiscoveredBridge();
  assert.strictEqual(fs.existsSync(bridgePath), false);
}
