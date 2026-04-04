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
import path from "node:path";
import {
  type PluginManifest,
  type LoadedPlugin,
  type PluginListEntry,
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

// ── Discovery & Loading ────────────────────────────────────────

/**
 * Discover and load all plugins from bundled + data directories.
 * Returns count of successfully loaded plugins.
 */
export function loadAllPlugins(): number {
  loadedPlugins.clear();
  let loaded = 0;

  // 1. Bundled plugins
  const bundledDir = path.resolve(__dirname, "bundled");
  loaded += loadPluginsFromDirectory(bundledDir);

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
  return true;
}

export function disablePlugin(name: string): boolean {
  const plugin = loadedPlugins.get(name);
  if (!plugin) return false;
  loadedPlugins.set(name, { ...plugin, enabled: false });
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
}
