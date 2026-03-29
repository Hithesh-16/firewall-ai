import { exec } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export type HookEvent =
  | "pre-tool-call"
  | "post-tool-call"
  | "pre-send"
  | "post-receive"
  | "session-start"
  | "session-end";

export interface HookConfig {
  event: HookEvent;
  /** Shell command to execute */
  command: string;
  /** Only run for specific tool names (optional) */
  tools?: string[];
  /** Working directory (defaults to workspace root) */
  cwd?: string;
  /** Timeout in ms (default 30000) */
  timeout?: number;
  /** If true, block the tool call until hook completes */
  blocking?: boolean;
}

export interface HookResult {
  event: HookEvent;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  blocked: boolean;
}

const SETTINGS_FILE = ".ai-firewall/settings.json";

/**
 * Load hook configuration from .ai-firewall/settings.json in the workspace root.
 *
 * Example settings.json:
 * {
 *   "hooks": [
 *     {
 *       "event": "post-tool-call",
 *       "tools": ["edit_existing_file", "create_new_file"],
 *       "command": "npx prettier --write $TOOL_ARG_FILEPATH",
 *       "blocking": true
 *     },
 *     {
 *       "event": "pre-tool-call",
 *       "tools": ["run_terminal_command"],
 *       "command": "echo 'Terminal command about to run: $TOOL_ARG_COMMAND'"
 *     }
 *   ]
 * }
 */
export function loadHooks(workspaceRoot: string): HookConfig[] {
  const rootPath = workspaceRoot.startsWith("file://")
    ? workspaceRoot.slice(7)
    : workspaceRoot;

  const settingsPath = path.join(rootPath, SETTINGS_FILE);
  if (!fs.existsSync(settingsPath)) {
    return [];
  }

  try {
    const content = fs.readFileSync(settingsPath, "utf-8");
    const settings = JSON.parse(content);
    return Array.isArray(settings.hooks) ? settings.hooks : [];
  } catch {
    return [];
  }
}

/**
 * Run hooks matching the given event and optional tool name.
 * Substitutes $TOOL_NAME, $TOOL_ARG_* environment variables.
 */
export async function runHooks(
  event: HookEvent,
  workspaceRoot: string,
  context: {
    toolName?: string;
    toolArgs?: Record<string, unknown>;
  } = {},
): Promise<HookResult[]> {
  const hooks = loadHooks(workspaceRoot);
  const matching = hooks.filter((h) => {
    if (h.event !== event) return false;
    if (h.tools && context.toolName && !h.tools.includes(context.toolName)) {
      return false;
    }
    return true;
  });

  if (matching.length === 0) return [];

  const rootPath = workspaceRoot.startsWith("file://")
    ? workspaceRoot.slice(7)
    : workspaceRoot;

  const results: HookResult[] = [];

  for (const hook of matching) {
    // Build environment with tool args
    const env: Record<string, string> = {
      ...process.env,
      TOOL_NAME: context.toolName || "",
    };

    if (context.toolArgs) {
      for (const [key, value] of Object.entries(context.toolArgs)) {
        env[`TOOL_ARG_${key.toUpperCase()}`] = String(value ?? "");
      }
    }

    // Substitute $TOOL_ARG_* in command
    let command = hook.command;
    for (const [key, value] of Object.entries(env)) {
      command = command.replace(new RegExp(`\\$${key}`, "g"), value);
    }

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: hook.cwd || rootPath,
        timeout: hook.timeout || 30_000,
        env,
      });

      results.push({
        event,
        command: hook.command,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: 0,
        blocked: false,
      });
    } catch (err: any) {
      const exitCode = err.code ?? 1;
      // If hook exits non-zero and is blocking, mark as blocked
      const blocked = hook.blocking === true && exitCode !== 0;

      results.push({
        event,
        command: hook.command,
        stdout: err.stdout?.trim() ?? "",
        stderr: err.stderr?.trim() ?? err.message,
        exitCode,
        blocked,
      });
    }
  }

  return results;
}
