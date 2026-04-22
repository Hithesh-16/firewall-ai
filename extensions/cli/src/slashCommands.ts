import { type AssistantConfig } from "@ai-firewall/sdk";
import { loadAuthFile } from "@ai-firewall/shared-auth";
import chalk from "chalk";

import { loadAssistantYamlFromApi } from "./apiAssistantLoader.js";
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
async function handleSync(): Promise<SlashCommandResult> {
  const auth = loadAuthFile();
  if (!auth?.accessToken) {
    return {
      output: chalk.red("Not signed in. Run /login first, then /sync."),
    };
  }
  const proxyUrl = auth.proxyUrl || "http://localhost:8080";
  const lines: string[] = [];

  // ── 1. Sync models from user_models table ─────────────────
  // Fetches the user's model list from the unified user_models
  // table, then writes a config.yaml with one model entry per
  // row so the config service and model selector pick them up.
  try {
    const modelsRes = await fetch(`${proxyUrl}/api/me/models/list`, {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
    });
    if (!modelsRes.ok) {
      throw new Error(`HTTP ${modelsRes.status} ${modelsRes.statusText}`);
    }
    const modelsBody = (await modelsRes.json()) as {
      models: Array<{
        providerSlug: string;
        modelSlug: string;
        displayName: string | null;
        apiBase: string | null;
        roles: string[];
      }>;
    };

    // Also fetch the assistant YAML for non-model config (MCP
    // servers, rules, context providers, prompts). Models come
    // from user_models now, not from the assistant YAML.
    let assistantYaml = "";
    try {
      assistantYaml = await loadAssistantYamlFromApi(true); // Force refresh to get latest from server
    } catch {
      // No assistant — that's fine for model sync, assistant is
      // only needed for MCP/rules/context.
    }

    // Build a config.yaml that has the models from user_models
    // + non-model blocks from the assistant (if any).
    const fs = await import("fs");
    const pathMod = await import("path");
    const os = await import("os");

    // Parse the assistant YAML to extract non-model fields.
    let nonModelFields = "";
    if (assistantYaml) {
      try {
        const yamlMod = await import("yaml");
        const parsed = yamlMod.parse(assistantYaml) as Record<string, unknown>;
        // Remove models — we'll rebuild from user_models
        delete parsed.models;
        nonModelFields = yamlMod.stringify(parsed);
      } catch {
        nonModelFields = "";
      }
    }

    // Build the models: block from user_models
    const modelEntries = modelsBody.models.map((m) => {
      const lines2: string[] = [];
      lines2.push(`  - name: ${JSON.stringify(m.displayName || m.modelSlug)}`);
      lines2.push(`    provider: ${m.providerSlug}`);
      lines2.push(`    model: ${m.modelSlug}`);
      if (m.apiBase) {
        lines2.push(`    apiBase: ${m.apiBase}`);
      }
      lines2.push(`    roles:`);
      for (const r of m.roles) {
        lines2.push(`      - ${r}`);
      }
      return lines2.join("\n");
    });

    // Note: API keys are NOT written to config.yaml here because
    // the gateway now reads them directly from user_models at
    // dispatch time. The config.yaml is only for the CLI's local
    // model selector — it doesn't need keys for that.
    const header =
      "# Managed by AI Firewall — synced from the web dashboard.\n" +
      "# Add `# user-managed: true` on the first line to prevent auto-sync.\n";

    // If we have non-model assistant config, use it as the base;
    // otherwise generate a minimal config.
    let yamlContent: string;
    if (nonModelFields.trim()) {
      yamlContent =
        nonModelFields.trimEnd() +
        "\nmodels:\n" +
        modelEntries.join("\n") +
        "\n";
    } else {
      yamlContent =
        "name: synced\nschema: v1\nversion: 0.0.1\nmodels:\n" +
        modelEntries.join("\n") +
        "\n";
    }

    // Also inject API keys from the assistant endpoint (which
    // does server-side key injection) so the CLI can actually
    // make LLM calls, not just list models.
    if (assistantYaml) {
      // The assistant YAML already has keys injected — use it
      // directly if it has models, it's the most complete version.
      const configPath = pathMod.join(
        os.homedir(),
        ".ai-firewall",
        "config.yaml",
      );
      fs.writeFileSync(configPath, header + assistantYaml, {
        encoding: "utf8",
        mode: 0o600,
      });
    } else {
      const configPath = pathMod.join(
        os.homedir(),
        ".ai-firewall",
        "config.yaml",
      );
      fs.writeFileSync(configPath, header + yamlContent, {
        encoding: "utf8",
        mode: 0o600,
      });
    }

    const modelCount = modelsBody.models.length;
    lines.push(
      chalk.green(
        `✓ Models synced (${modelCount} model${modelCount === 1 ? "" : "s"})`,
      ),
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    lines.push(chalk.red(`✗ Model sync failed: ${msg}`));
  }

  // ── 2. Sync effective policy ──────────────────────────────
  try {
    const res = await fetch(`${proxyUrl}/api/me/policy`, {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
    });
    if (res.ok) {
      const body = (await res.json()) as { policy: Record<string, unknown> };
      const blocklist =
        ((body.policy?.file_scope as Record<string, unknown>)?.blocklist as
          | string[]
          | undefined) ?? [];
      lines.push(
        chalk.green(
          `✓ Policy synced (${blocklist.length} blocked pattern${blocklist.length === 1 ? "" : "s"})`,
        ),
      );
    } else {
      lines.push(chalk.yellow(`⚠ Policy sync: HTTP ${res.status}`));
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    lines.push(chalk.yellow(`⚠ Policy sync failed: ${msg}`));
  }

  // ── 3. Reload services ────────────────────────────────────
  try {
    // Manually update the ConfigService state to trigger the reactive reload
    // configService.reload() or configService.updateConfigPath() are internal
    // methods that we can't easily call here. Instead, we use reloadService.
    await reloadService(SERVICE_NAMES.CONFIG);

    // After CONFIG is reloaded, MODEL and MCP should follow because they
    // depend on CONFIG in the ServiceContainer.
    await reloadService(SERVICE_NAMES.MODEL);
    await reloadService(SERVICE_NAMES.MCP);

    lines.push(chalk.green("✓ Config, model, and MCP services reloaded"));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    lines.push(chalk.yellow(`⚠ Service reload failed: ${msg}`));
  }

  return {
    output: lines.join("\n"),
  };
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
