/**
 * Plugin Type System
 *
 * Plugins are npm-style packages that extend AI Firewall with:
 *   - Additional commands
 *   - Custom scanners
 *   - Hook handlers
 *   - Skills
 *
 * Plugin manifest (plugin.json):
 *   {
 *     "name": "my-plugin",
 *     "version": "1.0.0",
 *     "description": "...",
 *     "commands": ["command1", "command2"],
 *     "hooks": { "tool_call": ["echo $TOOL_NAME"] },
 *     "skills": ["./skills/"],
 *     "enabled": true
 *   }
 */

export interface PluginManifest {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly author?: string;
  readonly commands?: readonly string[];
  readonly hooks?: Record<string, readonly string[]>;
  readonly skills?: readonly string[];
  readonly enabled?: boolean;
}

export interface LoadedPlugin {
  readonly manifest: PluginManifest;
  readonly dirPath: string;
  readonly loadedAt: number;
  readonly enabled: boolean;
  readonly errors: readonly string[];
}

export interface PluginListEntry {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly enabled: boolean;
  readonly source: string;
  readonly commandCount: number;
  readonly hookCount: number;
  readonly skillCount: number;
}

/**
 * Validate a plugin manifest.
 * Returns array of error strings (empty = valid).
 */
export function validateManifest(manifest: unknown): string[] {
  const errors: string[] = [];
  if (!manifest || typeof manifest !== "object") {
    return ["Manifest must be a JSON object"];
  }

  const m = manifest as Record<string, unknown>;

  if (typeof m.name !== "string" || !m.name.trim()) {
    errors.push("Missing or invalid 'name'");
  }
  if (typeof m.version !== "string" || !m.version.trim()) {
    errors.push("Missing or invalid 'version'");
  }
  if (typeof m.description !== "string") {
    errors.push("Missing or invalid 'description'");
  }

  if (m.commands !== undefined && !Array.isArray(m.commands)) {
    errors.push("'commands' must be an array");
  }
  if (
    m.hooks !== undefined &&
    (typeof m.hooks !== "object" || m.hooks === null)
  ) {
    errors.push("'hooks' must be an object");
  }
  if (m.skills !== undefined && !Array.isArray(m.skills)) {
    errors.push("'skills' must be an array");
  }

  return errors;
}
