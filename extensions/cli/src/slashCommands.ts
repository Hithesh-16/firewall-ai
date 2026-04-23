import { type AssistantConfig } from "@ai-firewall/sdk";
import { loadAuthFile } from "@ai-firewall/shared-auth";
import chalk from "chalk";

import {
  isAuthenticated,
  isAuthenticatedConfig,
  loadAuthConfig,
} from "./auth/workos.js";
import { getAllSlashCommands } from "./commands/commands.js";
import { handleInit } from "./commands/init.js";
import { authenticate as webAuthenticate } from "./commands/login.js";
import { logout as webLogout } from "./commands/logout.js";
import { handleInfoSlashCommand } from "./infoScreen.js";
import { reloadService, SERVICE_NAMES } from "./services/index.js";
import { getCurrentSession, updateSessionTitle } from "./session.js";
import { posthogService } from "./telemetry/posthogService.js";
import { telemetryService } from "./telemetry/telemetryService.js";
import { SlashCommandResult } from "./ui/hooks/useChat.types.js";

type CommandHandler = (
  args: string[],
  assistant: AssistantConfig,
  remoteUrl?: string,
  options?: { isRemoteMode?: boolean },
) => Promise<SlashCommandResult> | SlashCommandResult;

async function handleHelp(_args: string[], _assistant: AssistantConfig) {
  const helpMessage = [
    chalk.bold("Keyboard Shortcuts:"),
    "",
    chalk.white("Navigation:"),
    `  ${chalk.cyan("↑/↓")}        Navigate command/file suggestions or history`,
    `  ${chalk.cyan("Tab")}        Complete command or file selection`,
    `  ${chalk.cyan("Enter")}      Submit message`,
    `  ${chalk.cyan("Shift+Enter")} New line`,
    `  ${chalk.cyan("\\")}          Line continuation (at end of line)`,
    `  ${chalk.cyan("!")}          Shell mode - run shell commands`,
    "",
    chalk.white("Controls:"),
    `  ${chalk.cyan("Ctrl+C")}     Clear input`,
    `  ${chalk.cyan("Ctrl+D")}     Exit application`,
    `  ${chalk.cyan("Ctrl+L")}     Clear screen`,
    `  ${chalk.cyan("Shift+Tab")}  Cycle permission modes (normal/plan/auto)`,
    `  ${chalk.cyan("Esc")}        Cancel streaming or close suggestions`,
    "",
    chalk.white("Special Characters:"),
    `  ${chalk.cyan("@")}          Search and attach files for context`,
    `  ${chalk.cyan("/")}          Access slash commands`,
    `  ${chalk.cyan("!")}          Execute bash commands directly`,
    "",
    chalk.white("Available Commands:"),
    `  Type ${chalk.cyan("/")} to see available slash commands`,
    `  Type ${chalk.cyan("!")} followed by a command to execute bash directly`,
  ].join("\n");
  return { output: helpMessage };
}

async function handleLogin() {
  // `/login` calls the shared web-first flow directly so it works even
  // when the AuthService failed to initialize (e.g. because there's no
  // model / no assistant yet). Opens the browser, waits for the
  // loopback callback, writes ~/.ai-firewall/auth.json.
  try {
    const ok = await webAuthenticate({ force: true });
    if (!ok) {
      return {
        exit: false,
        output: "Sign-in did not complete.",
      };
    }

    // Best-effort: refresh the auth service so downstream consumers
    // (API client, MCP, model service) pick up the new token without
    // requiring a TUI restart. If the service isn't registered yet,
    // just swallow and let the next command trigger init.
    try {
      await reloadService(SERVICE_NAMES.AUTH);
    } catch {
      /* service container not ready — next read will initialize */
    }

    const config = loadAuthConfig();
    const userInfo =
      config && isAuthenticatedConfig(config)
        ? config.userEmail || config.userId
        : "user";

    return {
      exit: false,
      output: `Signed in as ${userInfo}. Use /model to pick a model.`,
    };
  } catch (error: any) {
    return {
      exit: false,
      output: `Login failed: ${error?.message ?? String(error)}`,
    };
  }
}

async function handleLogout() {
  // `/logout` also bypasses the AuthService wrapper. It runs the
  // three-step web-first flow (server revoke → shared-auth handoff
  // delete → local cleanup) and always reports success so the user
  // can always get out of a broken state.
  try {
    await webLogout();
  } catch {
    /* webLogout already swallows everything it can */
  }

  try {
    await reloadService(SERVICE_NAMES.AUTH);
  } catch {
    /* ignore — local state is what matters for logout */
  }

  return {
    exit: true,
    output: "Signed out of AI Firewall.",
  };
}

async function handleWhoami() {
  const authed = await isAuthenticated();
  if (authed) {
    const config = loadAuthConfig(); // TODO duplicate auth config loading
    if (config && isAuthenticatedConfig(config)) {
      return {
        exit: false,
        output: `Logged in as ${config.userEmail || config.userId}`,
      };
    } else {
      return {
        exit: false,
        output: "Authenticated via environment variable",
      };
    }
  } else {
    return {
      exit: false,
      output: "Not logged in. Use /login to authenticate.",
    };
  }
}

async function handleFork() {
  try {
    const currentSession = getCurrentSession();
    const forkCommand = `cn --fork ${currentSession.sessionId}`;
    // Try to copy to clipboard dynamically to avoid hard dependency in tests
    try {
      const clipboardy = await import("clipboardy");
      await clipboardy.default.write(forkCommand);
      return {
        exit: false,
        output: chalk.gray(`${forkCommand} (copied to clipboard)`),
      };
    } catch {
      return {
        exit: false,
        output: chalk.gray(`${forkCommand}`),
      };
    }
  } catch (error: any) {
    return {
      exit: false,
      output: chalk.red(`Failed to create fork command: ${error.message}`),
    };
  }
}

function handleTitle(args: string[]) {
  const title = args.join(" ").trim();
  if (!title) {
    return {
      exit: false,
      output: chalk.yellow(
        "Please provide a title. Usage: /title <your title>",
      ),
    };
  }

  try {
    updateSessionTitle(title);
    return {
      exit: false,
      output: chalk.green(`Session title updated to: "${title}"`),
    };
  } catch (error: any) {
    return {
      exit: false,
      output: chalk.red(`Failed to update title: ${error.message}`),
    };
  }
}

function handleJobs() {
  return { openJobsSelector: true };
}

function handleSessions() {
  return { openSessionSelector: true };
}

/**
 * `/sync` — pull the latest assistant (models) and effective
 * policy from the proxy and reload all downstream services. This
 * is the in-TUI equivalent of restarting the CLI after changing
 * something in the web dashboard.
 *
 * What it does:
 *   1. Fetch GET /api/me/assistant (with key injection) — writes
 *      the ETag cache AND ~/.ai-firewall/config.yaml.
 *   2. Fetch GET /api/me/policy — updates the scanner cache.
 *   3. Reload the CONFIG service → cascades to MODEL + MCP.
 *   4. Report what changed in a concise summary.
 */
/**
 * Relay helper: forward a slash command to the proxy's
 * `/api/commands/execute` endpoint and adapt the response.
 *
 * Used by proxy-backed commands (doctor, cost, stats, memory, tasks,
 * diff, share, security-audit, security-review, plan, review) so the
 * CLI picker stays in parity with the web dashboard without
 * duplicating every command's logic here. Routing decisions:
 *
 *   - `type: "local"` → render the returned `output` inline.
 *   - `type: "prompt"` → feed the prompt back into the chat as if the
 *     user had typed it, via `newInput`. This is what makes `/plan`
 *     and `/review` cause the model to respond instead of just
 *     printing a prompt template.
 *   - `type: "action"` → show `output`; the web UI handles action
 *     side-effects, the CLI just surfaces the message.
 *
 * Auth is read from the shared auth file — if the user hasn't signed
 * in we surface a clear "not signed in" message instead of a cryptic
 * 401.
 */
async function runProxyCommand(
  command: string,
  args: string[],
): Promise<SlashCommandResult> {
  const auth = loadAuthFile();
  if (!auth?.accessToken) {
    return {
      output: chalk.red(`Not signed in. Run /login first, then /${command}.`),
    };
  }
  const proxyUrl = auth.proxyUrl || "http://localhost:8080";
  const input = `/${command}${args.length > 0 ? " " + args.join(" ") : ""}`;

  try {
    const resp = await fetch(`${proxyUrl}/api/commands/execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.accessToken}`,
      },
      body: JSON.stringify({ input }),
    });
    if (!resp.ok) {
      // Parse the error body if we can — the proxy returns
      // { error: string, details?: ... } on 4xx/5xx.
      let message = `HTTP ${resp.status}`;
      try {
        const errBody = (await resp.json()) as { error?: string };
        if (errBody?.error) message = errBody.error;
      } catch {
        const text = await resp.text();
        if (text) message = text.slice(0, 200);
      }
      return {
        output: chalk.red(`/${command} failed: ${message}`),
      };
    }
    // Proxy returns a FLAT response (see proxy/src/routes/command.route.ts):
    //   prompt command → { type: "prompt", commandName, prompt, progressMessage }
    //   local command  → { type: "local",  commandName, result: { output, success, data? } }
    //   action command → { type: "action", commandName, result: { output, success, data? } }
    const data = (await resp.json()) as {
      type?: "prompt" | "local" | "action";
      commandName?: string;
      prompt?: string;
      result?: {
        output?: string;
        success?: boolean;
        data?: Record<string, unknown>;
      };
    };

    if (data.type === "prompt" && data.prompt) {
      // Feed the generated prompt back into the chat — same shape as
      // an assistant/invokable rule invocation.
      return { newInput: data.prompt };
    }

    const result = data.result;
    if (result?.output) {
      return { output: result.output };
    }
    if (result?.success === false) {
      return {
        output: chalk.red(`/${command} reported failure (no message).`),
      };
    }
    return { output: chalk.dim(`/${command} completed.`) };
  } catch (err) {
    return {
      output: chalk.red(
        `/${command} error: ${err instanceof Error ? err.message : String(err)}`,
      ),
    };
  }
}

/**
 * Build a CommandHandler that forwards to `runProxyCommand(name)`.
 * Using a factory keeps the `commandHandlers` map flat and readable.
 */
function proxyCommand(name: string): CommandHandler {
  return (args) => runProxyCommand(name, args);
}

async function handleSync(): Promise<SlashCommandResult> {
  const auth = loadAuthFile();
  if (!auth?.accessToken) {
    return {
      output: chalk.red("Not signed in. Run /login first, then /sync."),
    };
  }
  const proxyUrl = auth.proxyUrl || "http://localhost:8080";
  const { syncFromProxy } = await import("./sync.js");
  const result = await syncFromProxy(auth, proxyUrl, { reloadServices: true });
  return { output: result.lines.join("\n") };
}

const commandHandlers: Record<string, CommandHandler> = {
  help: handleHelp,
  clear: () => {
    return { clear: true, output: "Chat history cleared" };
  },
  exit: () => {
    return { exit: true, output: "Goodbye!" };
  },
  config: () => {
    return { openConfigSelector: true };
  },
  login: handleLogin,
  logout: handleLogout,
  whoami: handleWhoami,
  info: handleInfoSlashCommand,
  sync: handleSync,
  model: () => ({ openModelSelector: true }),
  compact: () => {
    return { compact: true };
  },
  mcp: () => {
    return { openMcpSelector: true };
  },
  resume: () => {
    return { openSessionSelector: true };
  },
  fork: handleFork,
  title: handleTitle,
  rename: handleTitle,
  init: (args, assistant) => {
    return handleInit(args, assistant);
  },
  update: () => {
    return { openUpdateSelector: true };
  },
  jobs: handleJobs,
  sessions: handleSessions,

  // ── Proxy-backed commands ─────────────────────────────────────────
  // Relay to POST /api/commands/execute. The proxy owns the actual
  // logic; the CLI just forwards args and surfaces output or injects
  // the returned prompt into the chat. Keeps CLI in parity with the
  // web dashboard's command set.
  plan: proxyCommand("plan"),
  review: proxyCommand("review"),
  doctor: proxyCommand("doctor"),
  cost: proxyCommand("cost"),
  stats: proxyCommand("stats"),
  memory: proxyCommand("memory"),
  tasks: proxyCommand("tasks"),
  diff: proxyCommand("diff"),
  share: proxyCommand("share"),
  "security-audit": proxyCommand("security-audit"),
  "security-review": proxyCommand("security-review"),
};

export async function handleSlashCommands(
  input: string,
  assistant: AssistantConfig,
  options?: { remoteUrl?: string; isRemoteMode?: boolean },
): Promise<SlashCommandResult | null> {
  // Only trigger slash commands if slash is the very first character
  if (!input.startsWith("/") || !input.trim().startsWith("/")) {
    return null;
  }

  const [command, ...args] = input.slice(1).split(" ");

  telemetryService.recordSlashCommand(command);
  posthogService.capture("useSlashCommand", { name: command });

  const handler = commandHandlers[command];
  if (handler) {
    return await handler(args, assistant, options?.remoteUrl, options);
  }

  // Check for custom assistant prompts
  const assistantPrompt = assistant.prompts?.find(
    (prompt: { name?: string; prompt?: string } | null) =>
      prompt?.name === command,
  );
  if (assistantPrompt) {
    const newInput = assistantPrompt.prompt + args.join(" ");
    return { newInput };
  }

  // Check for invokable rules
  const invokableRule = assistant.rules?.find(
    (
      rule:
        | string
        | { invokable?: boolean; name?: string; rule?: string }
        | null,
    ) => {
      // Handle both string rules and rule objects
      if (!rule || typeof rule === "string") {
        return false;
      }
      return rule.invokable === true && rule.name === command;
    },
  );
  if (invokableRule) {
    const ruleObj = invokableRule as { rule?: string };
    const newInput = ruleObj.rule + " " + args.join(" ");
    return { newInput };
  }

  // Check if this command would match any available commands (same logic as UI)
  const allCommands = getAllSlashCommands(assistant, {
    isRemoteMode: options?.isRemoteMode,
  });
  const hasMatches = allCommands.some((cmd) =>
    cmd.name.toLowerCase().includes(command.toLowerCase()),
  );

  // If no commands match, treat this as regular text instead of an unknown command
  if (!hasMatches) {
    return null;
  }

  return { output: `Unknown command: ${command}` };
}
