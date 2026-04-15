/**
 * Plugin Type System
 *
 * Plugins are npm-style packages that extend AI Firewall with:
 *   - Additional commands
 *   - Custom scanners
 *   - Hook handlers
 *   - Skills
 *   - MCP servers (stdio/sse/http) — wired through core's MCP client,
 *     every tool call routed through the MCP Security Gateway
 *
 * Plugin manifest (plugin.json):
 *   {
 *     "name": "my-plugin",
 *     "version": "1.0.0",
 *     "description": "...",
 *     "commands": ["command1"],
 *     "hooks": { "tool_call": ["echo $TOOL_NAME"] },
 *     "skills": ["./skills/"],
 *     "mcpServers": {
 *       "filesystem": {
 *         "command": "npx",
 *         "args": ["-y", "@modelcontextprotocol/server-filesystem", "."]
 *       }
 *     },
 *     "enabled": true
 *   }
 *
 * MCP servers declared here are written out as JSON files to
 * ~/.ai-firewall/mcpServers/plugin-<pluginName>.json on plugin load
 * using the Claude-Desktop-compatible {mcpServers: {...}} shape, so
 * core's existing MCP config loader picks them up automatically —
 * no new core plumbing required.
 */

/**
 * MCP server definition accepted in a plugin manifest. Union of the
 * three transports core's MCP client supports. Loose typing on
 * purpose: we pass this through to core as JSON and let core's
 * existing Zod schemas validate it at load time. The plugin loader
 * only checks the shape well enough to prevent obvious garbage.
 */
export type PluginMcpServerDef =
  | {
      readonly type?: "stdio";
      readonly command: string;
      readonly args?: readonly string[];
      readonly env?: Record<string, string>;
      readonly envFile?: string;
    }
  | {
      readonly type: "http" | "sse";
      readonly url: string;
      readonly headers?: Record<string, string>;
    };

export interface PluginManifest {
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly author?: string;
  readonly commands?: readonly string[];
  readonly hooks?: Record<string, readonly string[]>;
  readonly skills?: readonly string[];
  readonly mcpServers?: Record<string, PluginMcpServerDef>;
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

  if (m.mcpServers !== undefined) {
    if (
      typeof m.mcpServers !== "object" ||
      m.mcpServers === null ||
      Array.isArray(m.mcpServers)
    ) {
      errors.push("'mcpServers' must be an object keyed by server id");
    } else {
      for (const [id, def] of Object.entries(
        m.mcpServers as Record<string, unknown>,
      )) {
        if (typeof def !== "object" || def === null) {
          errors.push(`mcpServers.${id} must be an object`);
          continue;
        }
        const d = def as Record<string, unknown>;
        const isStdio = d.type === undefined || d.type === "stdio";
        const isRemote = d.type === "http" || d.type === "sse";
        if (isStdio) {
          if (typeof d.command !== "string" || !d.command.trim()) {
            errors.push(`mcpServers.${id}.command must be a non-empty string`);
          }
          if (d.args !== undefined && !Array.isArray(d.args)) {
            errors.push(`mcpServers.${id}.args must be an array`);
          }
        } else if (isRemote) {
          if (typeof d.url !== "string" || !d.url.trim()) {
            errors.push(`mcpServers.${id}.url must be a non-empty string`);
          }
        } else {
          errors.push(`mcpServers.${id}.type must be stdio | http | sse`);
        }
      }
    }
  }

  return errors;
}
