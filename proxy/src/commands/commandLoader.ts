/**
 * Command Loader & Registry
 *
 * Central registry that loads commands from all sources:
 *   1. Built-in commands (builtinCommands.ts)
 *   2. Skills directory (future: ~/.ai-firewall/skills/)
 *   3. Plugins (future: proxy/src/plugins/)
 *   4. MCP-provided commands (future)
 *
 * Commands are deduplicated by name (first source wins).
 * The registry is memoized per project path.
 */

import {
  type Command,
  type CommandMatch,
  type CommandContext,
  type LocalCommandResult,
  parseSlashCommand,
} from "./commandTypes";
import { BUILTIN_COMMANDS } from "./builtinCommands";

// ── Registry state ─────────────────────────────────────────────

let cachedCommands: readonly Command[] | null = null;

/**
 * Get all available commands (memoized).
 * Call clearCommandCache() to force reload.
 */
export function getCommands(): readonly Command[] {
  if (cachedCommands) return cachedCommands;

  const commands: Command[] = [];
  const seen = new Set<string>();

  // 1. Built-in commands (highest priority)
  for (const cmd of BUILTIN_COMMANDS) {
    if (!seen.has(cmd.name)) {
      // Skip disabled commands
      if (cmd.isEnabled && !cmd.isEnabled()) continue;
      seen.add(cmd.name);
      commands.push(cmd);
    }
  }

  // 2. Skills directory (future)
  // const skills = loadSkillCommands(projectPath);
  // for (const cmd of skills) { ... }

  // 3. Plugins (future)
  // const pluginCmds = loadPluginCommands();
  // for (const cmd of pluginCmds) { ... }

  // Sort alphabetically for prompt cache stability
  commands.sort((a, b) => a.name.localeCompare(b.name));

  cachedCommands = commands;
  return commands;
}

export function clearCommandCache(): void {
  cachedCommands = null;
}

// ── Find command by name or alias ──────────────────────────────

export function findCommand(name: string): Command | null {
  const lower = name.toLowerCase();
  const commands = getCommands();

  // Exact name match
  const exact = commands.find((c) => c.name === lower);
  if (exact) return exact;

  // Alias match
  const aliased = commands.find((c) =>
    c.aliases?.some((a) => a.toLowerCase() === lower),
  );
  if (aliased) return aliased;

  return null;
}

// ── Match a slash command input ────────────────────────────────

export function matchCommand(input: string): CommandMatch | null {
  const parsed = parseSlashCommand(input);
  if (!parsed) return null;

  const command = findCommand(parsed.name);
  if (!command) return null;

  return {
    command,
    args: parsed.args,
    matchedName: parsed.name,
  };
}

// ── Execute a command ──────────────────────────────────────────

export async function executeCommand(
  input: string,
  context: CommandContext,
): Promise<{
  found: boolean;
  result?: LocalCommandResult;
  prompt?: string;
  command?: Command;
}> {
  const match = matchCommand(input);
  if (!match) {
    return { found: false };
  }

  const { command, args } = match;

  switch (command.type) {
    case "local": {
      const result = await command.call(args, context);
      return { found: true, result, command };
    }

    case "action": {
      const result = await command.call(args, context);
      return { found: true, result, command };
    }

    case "prompt": {
      const prompt = await command.getPrompt(args, context);
      return { found: true, prompt, command };
    }

    default:
      return { found: false };
  }
}

// ── List commands (for /help and API) ──────────────────────────

export interface CommandListEntry {
  readonly name: string;
  readonly aliases: readonly string[];
  readonly description: string;
  readonly type: string;
  readonly source: string;
}

export function listCommands(): CommandListEntry[] {
  return getCommands().map((cmd) => ({
    name: cmd.name,
    aliases: cmd.aliases ?? [],
    description: cmd.description,
    type: cmd.type,
    source: cmd.source,
  }));
}

// ── Search commands by keyword ─────────────────────────────────

export function searchCommands(query: string): CommandListEntry[] {
  const lower = query.toLowerCase();
  return listCommands().filter(
    (cmd) =>
      cmd.name.includes(lower) ||
      cmd.description.toLowerCase().includes(lower) ||
      cmd.aliases.some((a) => a.includes(lower)),
  );
}
