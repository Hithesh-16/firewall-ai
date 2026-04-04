/**
 * Command Type System
 *
 * Three command types (matching claude-code's pattern):
 *   - prompt:  Expands to an LLM call (skills, templates)
 *   - local:   Runs a JS function directly (no LLM involved)
 *   - action:  Triggers a proxy action (API call, state change)
 *
 * Commands are loaded from:
 *   1. Built-in commands (hardcoded in builtinCommands.ts)
 *   2. Skills directory (~/.ai-firewall/skills/)
 *   3. Plugins (future: proxy/src/plugins/)
 *   4. MCP-provided commands (future)
 */

// ── Core types ─────────────────────────────────────────────────

export type CommandType = "prompt" | "local" | "action";

export type CommandSource = "builtin" | "skill" | "plugin" | "mcp" | "user";

export interface CommandDefinition {
  readonly name: string;
  readonly aliases?: readonly string[];
  readonly description: string;
  readonly type: CommandType;
  readonly source: CommandSource;
  readonly isEnabled?: () => boolean;
  /** If true, only users can invoke (not the model) */
  readonly userInvocable?: boolean;
}

// ── Prompt command (expands to LLM call) ───────────────────────

export interface PromptCommand extends CommandDefinition {
  readonly type: "prompt";
  /** Message shown while prompt is being processed */
  readonly progressMessage?: string;
  /** Tools the LLM is allowed to use during this command */
  readonly allowedTools?: readonly string[];
  /** Model override for this command */
  readonly model?: string;
  /** Generate the prompt content from user args */
  getPrompt(args: string, context: CommandContext): Promise<string>;
}

// ── Local command (runs JS function) ───────────────────────────

export interface LocalCommandResult {
  readonly output: string;
  readonly success: boolean;
  readonly data?: Record<string, unknown>;
}

export interface LocalCommand extends CommandDefinition {
  readonly type: "local";
  call(args: string, context: CommandContext): Promise<LocalCommandResult>;
}

// ── Action command (triggers proxy action) ─────────────────────

export interface ActionCommand extends CommandDefinition {
  readonly type: "action";
  call(args: string, context: CommandContext): Promise<LocalCommandResult>;
}

// ── Union type ─────────────────────────────────────────────────

export type Command = PromptCommand | LocalCommand | ActionCommand;

// ── Context passed to command handlers ─────────────────────────

export interface CommandContext {
  readonly userId: number | null;
  readonly projectPath: string;
  readonly model: string;
  readonly sessionId?: string;
  /** Additional data from the caller */
  readonly extra?: Record<string, unknown>;
}

// ── Command match result ───────────────────────────────────────

export interface CommandMatch {
  readonly command: Command;
  readonly args: string;
  readonly matchedName: string;
}

/**
 * Parse a slash command string like "/doctor --verbose" or "/compact 4000"
 * Returns null if the input doesn't start with "/"
 */
export function parseSlashCommand(
  input: string,
): { name: string; args: string } | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return null;

  const spaceIndex = trimmed.indexOf(" ");
  if (spaceIndex === -1) {
    return { name: trimmed.slice(1).toLowerCase(), args: "" };
  }

  return {
    name: trimmed.slice(1, spaceIndex).toLowerCase(),
    args: trimmed.slice(spaceIndex + 1).trim(),
  };
}
