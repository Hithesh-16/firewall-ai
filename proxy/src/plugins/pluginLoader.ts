/**
 * Plugin Loader
 *
 * Discovers and loads plugins from:
 *   1. Bundled (proxy/src/plugins/bundled/) — shipped with AI Firewall
 *   2. Data directory (~/.ai-firewall/plugins/) — user-installed
 *
 * Lifecycle:
 *   discover → validate manifest → load → register hooks → enable
 *
 * SECURITY:
 * - Plugin manifest files are scanned by ruleFileScanService on load
 * - Plugin hooks inherit the proxy's execution permissions
 * - Plugins cannot bypass the firewall scanning pipeline
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  type PluginManifest,
  type LoadedPlugin,
  type PluginListEntry,
  type PluginMcpServerDef,
  validateManifest,
} from "./pluginTypes";
import {
  registerHooks,
  type HookConfig,
  type HookEvent,
} from "../services/hookService";
import { env } from "../config";

// ── State ──────────────────────────────────────────────────────

const loadedPlugins = new Map<string, LoadedPlugin>();

// ── Plugin → core MCP config bridge ────────────────────────────
//
// Core reads MCP server configs from ~/.ai-firewall/mcpServers/*.json
// (see core/context/mcp/json/loadJsonMcpConfigs.ts). We write a file
// per enabled plugin so core picks up the plugin's declared MCP
// servers on its next config refresh. File naming is prefixed with
// `plugin-` so plugin-owned files are distinguishable from hand-
// authored ones and can be cleaned up safely on unload.

const PLUGIN_MCP_FILE_PREFIX = "plugin-";

function mcpConfigDir(): string {
  return path.join(os.homedir(), ".ai-firewall", "mcpServers");
}

function mcpConfigPathFor(pluginName: string): string {
  const safe = pluginName.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(mcpConfigDir(), `${PLUGIN_MCP_FILE_PREFIX}${safe}.json`);
}

function writePluginMcpConfig(
  pluginName: string,
  mcpServers: Record<string, PluginMcpServerDef>,
): void {
  try {
    const dir = mcpConfigDir();
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    // Claude-Desktop-compatible shape that core's loader accepts.
    const payload = { mcpServers };
    fs.writeFileSync(
      mcpConfigPathFor(pluginName),
      JSON.stringify(payload, null, 2),
      "utf8",
    );
  } catch {
    // Fail-open: a write error shouldn't crash plugin discovery.
    // Core will simply not see the servers this plugin declared.
  }
}

function removePluginMcpConfig(pluginName: string): void {
  try {
    const p = mcpConfigPathFor(pluginName);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch {
    // ignore
  }
}

function removeAllPluginMcpConfigs(): void {
  try {
    const dir = mcpConfigDir();
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir)) {
      if (entry.startsWith(PLUGIN_MCP_FILE_PREFIX) && entry.endsWith(".json")) {
        try {
          fs.unlinkSync(path.join(dir, entry));
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // ignore
  }
}

// ── Discovery & Loading ────────────────────────────────────────

/**
 * Resolve the `bundled/` directory. In dev (`ts-node`) `__dirname`
 * points to `src/plugins/`, so `bundled` is a sibling. In a prod
 * build `__dirname` is `dist/plugins/` — `plugin.json` files are
 * not copied by `tsc`, so we fall back to the source tree's
 * `src/plugins/bundled/` path. The proxy always ships alongside
 * its source in this monorepo, so that path is available at
 * runtime.
 */
function resolveBundledPluginsDir(): string | null {
  const candidates = [
    path.resolve(__dirname, "bundled"),
    path.resolve(__dirname, "..", "..", "src", "plugins", "bundled"),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  return null;
}

/**
 * Discover and load all plugins from bundled + data directories.
 * Returns count of successfully loaded plugins.
 */
export function loadAllPlugins(): number {
  loadedPlugins.clear();
  // Wipe stale plugin-owned MCP config files from a previous run.
  // Each enabled plugin rewrites its file below; orphans (from a
  // plugin that was removed between restarts) get cleaned up.
  removeAllPluginMcpConfigs();
  let loaded = 0;

  // 1. Bundled plugins
  const bundledDir = resolveBundledPluginsDir();
  if (bundledDir) {
    loaded += loadPluginsFromDirectory(bundledDir);
  }

  // 2. User plugins
  const dataDir = path.dirname(path.resolve(process.cwd(), env.DB_PATH));
  const userPluginDir = path.join(dataDir, "plugins");
  loaded += loadPluginsFromDirectory(userPluginDir);

  return loaded;
}

function loadPluginsFromDirectory(dirPath: string): number {
  if (!fs.existsSync(dirPath)) return 0;

  let loaded = 0;

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const pluginDir = path.join(dirPath, entry.name);
      const manifestPath = path.join(pluginDir, "plugin.json");

      if (!fs.existsSync(manifestPath)) continue;

      const plugin = loadPlugin(manifestPath, pluginDir);
      if (plugin) {
        loadedPlugins.set(plugin.manifest.name, plugin);
        loaded++;
      }
    }
  } catch {
    // Directory unreadable
  }

  return loaded;
}

function loadPlugin(
  manifestPath: string,
  dirPath: string,
): LoadedPlugin | null {
  try {
    const raw = fs.readFileSync(manifestPath, "utf8");
    const parsed = JSON.parse(raw);

    const errors = validateManifest(parsed);
    if (errors.length > 0) {
      return {
        manifest: { name: "invalid", version: "0", description: "" },
        dirPath,
        loadedAt: Date.now(),
        enabled: false,
        errors,
      };
    }

    const manifest = parsed as PluginManifest;
    const enabled = manifest.enabled !== false;

    // Register hooks if enabled
    if (enabled && manifest.hooks) {
      const hookConfigs: HookConfig[] = [];
      for (const [event, commands] of Object.entries(manifest.hooks)) {
        for (const command of commands) {
          hookConfigs.push({
            event: event as HookEvent,
            command,
            enabled: true,
          });
        }
      }
      if (hookConfigs.length > 0) {
        registerHooks(hookConfigs);
      }
    }

    // Publish MCP servers to core's MCP config directory so the
    // existing MCPManagerSingleton picks them up on next refresh.
    if (
      enabled &&
      manifest.mcpServers &&
      Object.keys(manifest.mcpServers).length > 0
    ) {
      writePluginMcpConfig(manifest.name, manifest.mcpServers);
    }

    return {
      manifest,
      dirPath,
      loadedAt: Date.now(),
      enabled,
      errors: [],
    };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      manifest: { name: path.basename(dirPath), version: "0", description: "" },
      dirPath,
      loadedAt: Date.now(),
      enabled: false,
      errors: [`Failed to load: ${msg}`],
    };
  }
}

// ── CRUD ───────────────────────────────────────────────────────

export function getPlugin(name: string): LoadedPlugin | null {
  return loadedPlugins.get(name) ?? null;
}

export function getAllPlugins(): LoadedPlugin[] {
  return Array.from(loadedPlugins.values());
}

export function enablePlugin(name: string): boolean {
  const plugin = loadedPlugins.get(name);
  if (!plugin) return false;
  loadedPlugins.set(name, { ...plugin, enabled: true });
  if (
    plugin.manifest.mcpServers &&
    Object.keys(plugin.manifest.mcpServers).length > 0
  ) {
    writePluginMcpConfig(plugin.manifest.name, plugin.manifest.mcpServers);
  }
  return true;
}

export function disablePlugin(name: string): boolean {
  const plugin = loadedPlugins.get(name);
  if (!plugin) return false;
  loadedPlugins.set(name, { ...plugin, enabled: false });
  if (plugin.manifest.mcpServers) {
    removePluginMcpConfig(plugin.manifest.name);
  }
  return true;
}

export function listPlugins(): PluginListEntry[] {
  return Array.from(loadedPlugins.values()).map((p) => ({
    name: p.manifest.name,
    version: p.manifest.version,
    description: p.manifest.description,
    enabled: p.enabled,
    source: p.dirPath,
    commandCount: p.manifest.commands?.length ?? 0,
    hookCount: Object.values(p.manifest.hooks ?? {}).flat().length,
    skillCount: p.manifest.skills?.length ?? 0,
  }));
}

// ── Reset (for testing) ────────────────────────────────────────

export function clearPlugins(): void {
  loadedPlugins.clear();
  removeAllPluginMcpConfigs();
}
