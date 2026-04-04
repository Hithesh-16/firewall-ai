/**
 * Hook Service
 *
 * Event-driven shell command hooks. Users configure hooks in settings
 * that fire on specific events (tool calls, messages, scans, etc.).
 *
 * Hook format (in policy.json or settings):
 *   hooks: {
 *     "tool_call": ["echo 'tool called: $TOOL_NAME' >> /tmp/hooks.log"],
 *     "scan_blocked": ["curl -X POST http://slack/webhook -d '{\"text\":\"BLOCKED\"}'"],
 *     "task_completed": ["notify-send 'Task done: $TASK_ID'"]
 *   }
 *
 * SECURITY:
 * - Hook commands are executed with the proxy's process permissions
 * - Hooks are NOT user input — they come from settings files only
 * - Hook output is logged but NOT returned to the LLM
 * - Hook failures never block the main request pipeline
 * - Environment variables are sanitized (no secret leaking)
 */

import { execSync } from "node:child_process";

// ── Types ──────────────────────────────────────────────────────

export type HookEvent =
  | "tool_call"
  | "tool_result"
  | "scan_blocked"
  | "scan_redacted"
  | "task_created"
  | "task_completed"
  | "task_failed"
  | "agent_spawned"
  | "agent_completed"
  | "memory_saved"
  | "command_executed"
  | "approval_needed"
  | "approval_resolved";

export interface HookConfig {
  readonly event: HookEvent;
  readonly command: string;
  readonly timeout?: number;
  readonly enabled?: boolean;
}

export interface HookContext {
  readonly [key: string]: string | number | boolean | undefined;
}

export interface HookResult {
  readonly event: HookEvent;
  readonly command: string;
  readonly success: boolean;
  readonly output?: string;
  readonly error?: string;
  readonly durationMs: number;
}

// ── Registry ───────────────────────────────────────────────────

const hookRegistry = new Map<HookEvent, HookConfig[]>();
const hookResults: HookResult[] = [];
const MAX_RESULTS_HISTORY = 100;
const DEFAULT_TIMEOUT_MS = 10_000;

export function registerHook(config: HookConfig): void {
  const existing = hookRegistry.get(config.event) ?? [];
  hookRegistry.set(config.event, [...existing, config]);
}

export function registerHooks(configs: readonly HookConfig[]): void {
  for (const config of configs) {
    registerHook(config);
  }
}

export function unregisterHooks(event: HookEvent): void {
  hookRegistry.delete(event);
}

export function clearAllHooks(): void {
  hookRegistry.clear();
}

export function getRegisteredHooks(): Map<HookEvent, readonly HookConfig[]> {
  return new Map(hookRegistry);
}

export function getHooksForEvent(event: HookEvent): readonly HookConfig[] {
  return hookRegistry.get(event) ?? [];
}

// ── Execution ──────────────────────────────────────────────────

/**
 * Execute all hooks registered for an event.
 * Hooks run sequentially (not parallel) to prevent race conditions.
 * Failures are caught and logged — they never block the caller.
 */
export async function executeHooks(
  event: HookEvent,
  context: HookContext = {},
): Promise<HookResult[]> {
  const hooks = hookRegistry.get(event);
  if (!hooks || hooks.length === 0) return [];

  const results: HookResult[] = [];

  for (const hook of hooks) {
    if (hook.enabled === false) continue;

    const result = executeHook(hook, context);
    results.push(result);

    // Keep rolling history
    hookResults.push(result);
    if (hookResults.length > MAX_RESULTS_HISTORY) {
      hookResults.shift();
    }
  }

  return results;
}

function executeHook(hook: HookConfig, context: HookContext): HookResult {
  const startTime = Date.now();
  const expandedCommand = expandVariables(hook.command, context);
  const timeout = hook.timeout ?? DEFAULT_TIMEOUT_MS;

  try {
    const output = execSync(expandedCommand, {
      timeout,
      stdio: "pipe",
      env: buildSafeEnv(context),
      encoding: "utf8",
    });

    return {
      event: hook.event,
      command: hook.command,
      success: true,
      output: (output ?? "").slice(0, 1000), // Cap output
      durationMs: Date.now() - startTime,
    };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);

    return {
      event: hook.event,
      command: hook.command,
      success: false,
      error: msg.slice(0, 500),
      durationMs: Date.now() - startTime,
    };
  }
}

// ── Variable expansion ─────────────────────────────────────────

/**
 * Replace $VARIABLE_NAME with context values.
 * Only expands known variables — unknown $VARS are left as-is.
 */
function expandVariables(command: string, context: HookContext): string {
  return command.replace(/\$([A-Z_]+)/g, (match, varName) => {
    const value = context[varName.toLowerCase()];
    if (value === undefined) return match;
    // Sanitize to prevent command injection
    return String(value).replace(/[;&|`$(){}]/g, "");
  });
}

/**
 * Build a safe environment for hook execution.
 * Passes context values as AF_* environment variables.
 * Strips sensitive env vars from the parent process.
 */
function buildSafeEnv(context: HookContext): Record<string, string> {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "/usr/bin:/bin",
    HOME: process.env.HOME ?? "",
    SHELL: process.env.SHELL ?? "/bin/sh",
    LANG: process.env.LANG ?? "en_US.UTF-8",
  };

  // Add context as AF_* variables
  for (const [key, value] of Object.entries(context)) {
    if (value !== undefined) {
      env[`AF_${key.toUpperCase()}`] = String(value);
    }
  }

  return env;
}

// ── History ────────────────────────────────────────────────────

export function getHookHistory(limit = 20): readonly HookResult[] {
  return hookResults.slice(-limit);
}

export function clearHookHistory(): void {
  hookResults.length = 0;
}

// ── Load hooks from settings ───────────────────────────────────

export interface HookSettings {
  readonly [event: string]: string[];
}

/**
 * Load hooks from a settings object (e.g. from policy.json or settings.json).
 * Replaces all existing hooks.
 */
export function loadHooksFromSettings(settings: HookSettings): number {
  clearAllHooks();
  let count = 0;

  for (const [event, commands] of Object.entries(settings)) {
    if (!isValidHookEvent(event)) continue;

    for (const command of commands) {
      if (typeof command !== "string" || !command.trim()) continue;
      registerHook({ event: event as HookEvent, command: command.trim() });
      count++;
    }
  }

  return count;
}

function isValidHookEvent(event: string): event is HookEvent {
  const validEvents: readonly string[] = [
    "tool_call",
    "tool_result",
    "scan_blocked",
    "scan_redacted",
    "task_created",
    "task_completed",
    "task_failed",
    "agent_spawned",
    "agent_completed",
    "memory_saved",
    "command_executed",
    "approval_needed",
    "approval_resolved",
  ];
  return validEvents.includes(event);
}
