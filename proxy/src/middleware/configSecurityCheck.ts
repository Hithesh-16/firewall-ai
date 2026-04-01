/**
 * Config Security Check
 *
 * Detects plaintext API keys in config.yaml and warns.
 * Runs on proxy startup. Does NOT auto-modify — informs only.
 *
 * SOLID:
 * - SRP: Only detects and warns. No migration, no vault operations.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const CONFIG_PATHS = [
  path.join(os.homedir(), ".ai-firewall", "config.yaml"),
  path.join(os.homedir(), ".ai-firewall", "config.json"),
  path.join(os.homedir(), ".continue", "config.yaml"),
  path.join(os.homedir(), ".continue", "config.json"),
];

const API_KEY_PATTERNS = [
  /apiKey\s*:\s*["']?sk-[A-Za-z0-9\-_]{20,}/,     // OpenAI
  /apiKey\s*:\s*["']?sk-ant-[A-Za-z0-9\-_]{20,}/,  // Anthropic
  /apiKey\s*:\s*["']?gsk_[A-Za-z0-9\-_]{20,}/,     // Groq
  /apiKey\s*:\s*["']?AIza[A-Za-z0-9\-_]{30,}/,     // Google
  /apiKey\s*:\s*["']?[A-Za-z0-9\-_]{32,}/,         // Generic long key
];

export interface ConfigSecurityWarning {
  file: string;
  line: number;
  message: string;
}

/**
 * Scan config files for plaintext API keys.
 * Returns warnings — does NOT modify files.
 */
export function checkConfigSecurity(): ConfigSecurityWarning[] {
  const warnings: ConfigSecurityWarning[] = [];

  for (const configPath of CONFIG_PATHS) {
    if (!fs.existsSync(configPath)) continue;

    try {
      const content = fs.readFileSync(configPath, "utf-8");
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Skip lines that use vault references (these are safe)
        if (line.includes("apiKeyRef") || line.includes("vault://")) continue;

        // Skip commented lines
        if (line.trim().startsWith("#")) continue;

        // Check for plaintext API keys
        for (const pattern of API_KEY_PATTERNS) {
          if (pattern.test(line)) {
            warnings.push({
              file: configPath,
              line: i + 1,
              message: `Plaintext API key detected. Use vault storage instead: set apiKeyRef: "vault://provider/model" and add the key via the Model Settings UI.`,
            });
            break;
          }
        }
      }
    } catch {
      // Can't read file — skip
    }
  }

  return warnings;
}

/**
 * Log config security warnings on proxy startup.
 */
export function logConfigSecurityWarnings(): void {
  const warnings = checkConfigSecurity();

  if (warnings.length === 0) return;

  console.warn("\n╔══════════════════════════════════════════════════════════════╗");
  console.warn("║  AI FIREWALL: Plaintext API keys detected in config files   ║");
  console.warn("╠══════════════════════════════════════════════════════════════╣");

  for (const w of warnings) {
    console.warn(`║  ${w.file}:${w.line}`);
    console.warn(`║  → ${w.message}`);
  }

  console.warn("╠══════════════════════════════════════════════════════════════╣");
  console.warn("║  To fix: Use Model Settings UI to add providers.            ║");
  console.warn("║  API keys will be stored in the encrypted vault.            ║");
  console.warn("╚══════════════════════════════════════════════════════════════╝\n");
}
