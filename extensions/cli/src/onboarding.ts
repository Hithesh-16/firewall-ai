import * as fs from "fs";
import * as path from "path";

import chalk from "chalk";
import { setConfigFilePermissions } from "core/util/paths.js";

import { AuthConfig, isAuthenticated } from "./auth/workos.js";
import { authenticate } from "./commands/login.js";
import { getApiClient } from "./config.js";
import { loadConfiguration } from "./configLoader.js";
import { env } from "./env.js";
import { question } from "./util/prompt.js";
import { updateAnthropicModelInYaml } from "./util/yamlConfigUpdater.js";

const CONFIG_PATH = path.join(env.continueHome, "config.yaml");

export async function checkHasAcceptableModel(
  configPath: string,
): Promise<boolean> {
  try {
    if (!fs.existsSync(configPath)) {
      return false;
    }

    const content = fs.readFileSync(configPath, "utf8");
    return content.includes("claude");
  } catch {
    return false;
  }
}

export async function createOrUpdateConfig(apiKey: string): Promise<void> {
  const configDir = path.dirname(CONFIG_PATH);

  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  const existingContent = fs.existsSync(CONFIG_PATH)
    ? fs.readFileSync(CONFIG_PATH, "utf8")
    : "";

  const updatedContent = updateAnthropicModelInYaml(existingContent, apiKey);
  fs.writeFileSync(CONFIG_PATH, updatedContent);
  setConfigFilePermissions(CONFIG_PATH);
}

/**
 * First-run onboarding.
 *
 * Phase 5 drastically simplifies what used to be a 3-option interactive
 * menu (log in / paste API key / Ollama). The only sign-in surface the
 * product supports now is the web dashboard, so the CLI just runs the
 * web-first `authenticate()` flow. The two escape hatches remain:
 *
 *   - `AI_FIREWALL_API_KEY=<token>` env var → skip onboarding entirely
 *   - `AI_FIREWALL_USE_BEDROCK=1` env var → skip onboarding entirely
 *   - `ANTHROPIC_API_KEY=<key>` env var in headless/CI → auto-write
 *     config.yaml with Anthropic as the default model (unchanged)
 *
 * Everyone else hits `authenticate()` which opens the browser, runs
 * the loopback callback, and writes `~/.ai-firewall/auth.json`.
 */
export async function runOnboardingFlow(
  configPath: string | undefined,
): Promise<boolean> {
  // Step 1: explicit --config flag → skip onboarding, the user knows
  // what they're doing.
  if (configPath !== undefined) {
    return false;
  }

  // Step 2: Bedrock env var shortcut — unchanged from pre-Phase 5.
  if (process.env.AI_FIREWALL_USE_BEDROCK === "1") {
    console.log(
      chalk.blue("✓ Using AWS Bedrock (AI_FIREWALL_USE_BEDROCK detected)"),
    );
    return true;
  }

  // Step 3: test / CI / headless → skip interactive prompts. The
  // ANTHROPIC_API_KEY fast-path still works for CI runners that
  // ship an Anthropic key in the environment.
  const isTestEnv =
    process.env.NODE_ENV === "test" ||
    process.env.CI === "true" ||
    process.env.VITEST === "true" ||
    process.env.GITHUB_ACTIONS === "true" ||
    !process.stdin.isTTY;

  if (isTestEnv) {
    if (process.env.ANTHROPIC_API_KEY) {
      console.log(chalk.blue("✓ Using ANTHROPIC_API_KEY from environment"));
      await createOrUpdateConfig(process.env.ANTHROPIC_API_KEY);
      console.log(chalk.gray(`  Config saved to: ${CONFIG_PATH}`));
      return false;
    }
    // No interactive shell AND no env var → caller is expected to
    // either pass --config or supply AI_FIREWALL_API_KEY. Nothing
    // for us to do.
    return false;
  }

  // Step 4: interactive shell → run the web-first sign-in flow.
  // Authenticate opens the browser, starts the loopback receiver,
  // and returns a boolean. That's the whole onboarding.
  console.log(
    chalk.yellow(
      "Welcome to AI Firewall. Let's sign you in via the web dashboard.",
    ),
  );
  const success = await authenticate();
  return success;
}

export async function isFirstTime(): Promise<boolean> {
  return !fs.existsSync(path.join(env.continueHome, ".onboarding_complete"));
}

export async function markOnboardingComplete(): Promise<void> {
  const flagPath = path.join(env.continueHome, ".onboarding_complete");
  const flagDir = path.dirname(flagPath);

  if (!fs.existsSync(flagDir)) {
    fs.mkdirSync(flagDir, { recursive: true });
  }

  fs.writeFileSync(flagPath, new Date().toISOString());
}

export async function initializeWithOnboarding(
  authConfig: AuthConfig,
  configPath: string | undefined,
) {
  const firstTime = await isFirstTime();

  if (configPath !== undefined) {
    // throw an early error is configPath is invalid or has errors
    try {
      await loadConfiguration(
        authConfig,
        configPath,
        getApiClient(authConfig?.accessToken),
        [],
        false,
      );
    } catch (errorMessage) {
      throw new Error(
        `Failed to load config from "${configPath}": ${errorMessage}`,
      );
    }
  }

  if (!firstTime) {
    // Not the user's first run, but they may have logged out, their token
    // may have expired, or ~/.ai-firewall/auth.json may have been wiped.
    // If so, prompt them (once) and kick off the web-first sign-in flow
    // before we hand control to the TUI — otherwise the chat view just
    // sits at "Model: Loading..." because every downstream service needs
    // an access token.
    await ensureSignedInOrPrompt(configPath);
    return;
  }

  const wasOnboarded = await runOnboardingFlow(configPath);
  if (wasOnboarded) {
    await markOnboardingComplete();
  }
}

/**
 * If the user is not currently authenticated, show a Y/n prompt and run
 * `authenticate()` (the web-first loopback flow). Skips in non-interactive
 * shells, when `--config` is supplied, when Bedrock is on, or when an
 * explicit API key env var is set — the same escape hatches the first-run
 * onboarding respects.
 */
async function ensureSignedInOrPrompt(
  configPath: string | undefined,
): Promise<void> {
  if (configPath !== undefined) return;
  if (process.env.AI_FIREWALL_API_KEY) return;
  if (process.env.AI_FIREWALL_USE_BEDROCK === "1") return;
  if (!process.stdin.isTTY) return;

  if (await isAuthenticated()) return;

  console.log(chalk.yellow("\nYou're not signed in to AI Firewall."));
  console.log(
    chalk.gray(
      "  Sign-in opens your browser to the AI Firewall web dashboard.",
    ),
  );
  const answer = (await question(chalk.cyan("  Sign in now? (Y/n) ")))
    .trim()
    .toLowerCase();

  if (answer === "" || answer === "y" || answer === "yes") {
    await authenticate();
    return;
  }

  console.log(
    chalk.gray("  Skipped. Run 'cn login' any time to authenticate."),
  );
}
