import * as os from "os";
import * as path from "path";

import { BRAND } from "@ai-firewall/brand";
import dotenv from "dotenv";

dotenv.config();

/**
 * Backward-compatible env var resolution.
 * Checks AI_FIREWALL_* first, falls back to legacy CONTINUE_* names.
 */
function envWithFallback(primary: string, legacy: string): string | undefined {
  return process.env[primary] ?? process.env[legacy];
}

// Populate AI_FIREWALL_* from legacy CONTINUE_* if only legacy is set.
// This ensures downstream code that reads process.env.AI_FIREWALL_* directly
// also picks up the legacy value.
const ENV_MIGRATION_MAP: Record<string, string> = {
  AI_FIREWALL_API_KEY: "CONTINUE_API_KEY",
  AI_FIREWALL_API_BASE: "CONTINUE_API_BASE",
  AI_FIREWALL_GLOBAL_DIR: "CONTINUE_GLOBAL_DIR",
  AI_FIREWALL_TELEMETRY_ENABLED: "CONTINUE_TELEMETRY_ENABLED",
  AI_FIREWALL_ALLOW_ANONYMOUS_TELEMETRY: "CONTINUE_ALLOW_ANONYMOUS_TELEMETRY",
  AI_FIREWALL_WORKSPACE_KEY: "CONTINUE_WORKSPACE_KEY",
  AI_FIREWALL_ORG: "CONTINUE_ORG",
  AI_FIREWALL_REMOTE_CONFIG_SERVER_URL: "CONTINUE_REMOTE_CONFIG_SERVER_URL",
  AI_FIREWALL_CLI_TEST: "CONTINUE_CLI_TEST",
  AI_FIREWALL_CLI_ENABLE_TELEMETRY: "CONTINUE_CLI_ENABLE_TELEMETRY",
  AI_FIREWALL_REMOTE: "CONTINUE_REMOTE",
  AI_FIREWALL_USER_ID: "CONTINUE_USER_ID",
  AI_FIREWALL_CLI_AUTO_UPDATED: "CONTINUE_CLI_AUTO_UPDATED",
};

for (const [newKey, legacyKey] of Object.entries(ENV_MIGRATION_MAP)) {
  if (!process.env[newKey] && process.env[legacyKey]) {
    process.env[newKey] = process.env[legacyKey];
  }
}

export const env = {
  apiBase:
    envWithFallback(BRAND.envVars.apiBase, "CONTINUE_API_BASE") ?? BRAND.apiUrl,
  workOsClientId:
    process.env.WORKOS_CLIENT_ID ?? "client_01J0FW6XN8N2XJAECF7NE0Y65J",
  appUrl: process.env.HUB_URL || BRAND.appUrl,
  continueHome:
    envWithFallback(BRAND.envVars.globalDir, "CONTINUE_GLOBAL_DIR") ||
    path.join(os.homedir(), BRAND.globalDir),
};
