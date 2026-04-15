/**
 * Plugin System Tests — MCP bridge
 *
 * Covers the plugin → core MCP config bridge: a plugin that declares
 * `mcpServers` in its manifest should cause the loader to write a
 * Claude-Desktop-compatible JSON file to ~/.ai-firewall/mcpServers/
 * so core's existing MCP config loader picks it up. Disabling a
 * plugin must remove that file. Manifest validation must reject
 * obvious shape errors.
 */

import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { validateManifest } from "../plugins/pluginTypes";
import {
  clearPlugins,
  disablePlugin,
  enablePlugin,
  loadAllPlugins,
} from "../plugins/pluginLoader";

const MCP_DIR = path.join(os.homedir(), ".ai-firewall", "mcpServers");

function mcpFileFor(pluginName: string): string {
  return path.join(MCP_DIR, `plugin-${pluginName}.json`);
}

function readIfExists(p: string): string | null {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

// ── Manifest validation ──────────────────────────────────────

export function testValidateManifestAcceptsMcpStdio() {
  const errors = validateManifest({
    name: "test",
    version: "1.0.0",
    description: "",
    mcpServers: {
      fs: {
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
      },
    },
  });
  assert.deepStrictEqual(errors, [], "valid stdio MCP config should pass");
}

export function testValidateManifestAcceptsMcpHttp() {
  const errors = validateManifest({
    name: "test",
    version: "1.0.0",
    description: "",
    mcpServers: {
      remote: { type: "http", url: "https://mcp.example.com/sse" },
    },
  });
  assert.deepStrictEqual(errors, [], "valid http MCP config should pass");
}

export function testValidateManifestRejectsMcpArray() {
  const errors = validateManifest({
    name: "test",
    version: "1.0.0",
    description: "",
    mcpServers: [{ command: "npx" }],
  });
  assert.ok(
    errors.some((e) => e.includes("mcpServers")),
    "mcpServers as array should error",
  );
}

export function testValidateManifestRejectsStdioMissingCommand() {
  const errors = validateManifest({
    name: "test",
    version: "1.0.0",
    description: "",
    mcpServers: {
      bad: { type: "stdio" },
    },
  });
  assert.ok(
    errors.some((e) => e.includes("command")),
    "stdio without command should error",
  );
}

export function testValidateManifestRejectsRemoteMissingUrl() {
  const errors = validateManifest({
    name: "test",
    version: "1.0.0",
    description: "",
    mcpServers: {
      bad: { type: "http" },
    },
  });
  assert.ok(
    errors.some((e) => e.includes("url")),
    "http without url should error",
  );
}

export function testValidateManifestRejectsUnknownTransport() {
  const errors = validateManifest({
    name: "test",
    version: "1.0.0",
    description: "",
    mcpServers: {
      bad: { type: "smoke-signal", command: "x" },
    },
  });
  assert.ok(
    errors.some((e) => e.includes("stdio")),
    "unknown transport should error",
  );
}

// ── Bridge: plugin load writes the MCP file ─────────────────
//
// The bundled `filesystem` plugin declares an MCP stdio server.
// After loadAllPlugins() the bridge file must exist and parse
// into the Claude-Desktop shape core's loader expects.

export function testBundledFilesystemPluginWritesMcpFile() {
  // Start clean
  clearPlugins();

  const filePath = mcpFileFor("filesystem");
  // Clean up from prior runs in case the process was interrupted
  try {
    fs.unlinkSync(filePath);
  } catch {
    // ignore
  }

  loadAllPlugins();

  const raw = readIfExists(filePath);
  assert.ok(
    raw !== null,
    `expected plugin MCP config at ${filePath} after loadAllPlugins`,
  );

  const parsed = JSON.parse(raw!);
  assert.ok(
    parsed && typeof parsed === "object" && parsed.mcpServers,
    "bridge file must have a top-level mcpServers object",
  );
  assert.ok(
    parsed.mcpServers["firewall-filesystem"],
    "filesystem plugin should expose firewall-filesystem server",
  );
  const server = parsed.mcpServers["firewall-filesystem"];
  assert.strictEqual(server.type, "stdio");
  assert.strictEqual(server.command, "npx");
  assert.ok(Array.isArray(server.args));
}

export function testDisablePluginRemovesMcpFile() {
  clearPlugins();
  loadAllPlugins();

  const filePath = mcpFileFor("filesystem");
  assert.ok(readIfExists(filePath) !== null, "precondition: file exists");

  const ok = disablePlugin("filesystem");
  assert.ok(ok, "disablePlugin should return true for known plugin");
  assert.strictEqual(
    readIfExists(filePath),
    null,
    "disabling a plugin must remove its MCP bridge file",
  );

  // Re-enable restores the file
  enablePlugin("filesystem");
  assert.ok(
    readIfExists(filePath) !== null,
    "re-enabling must rewrite the MCP bridge file",
  );
}

export function testClearPluginsWipesAllBridgeFiles() {
  clearPlugins();
  loadAllPlugins();
  assert.ok(readIfExists(mcpFileFor("filesystem")) !== null);

  clearPlugins();
  assert.strictEqual(
    readIfExists(mcpFileFor("filesystem")),
    null,
    "clearPlugins must wipe all plugin-* bridge files",
  );
}
