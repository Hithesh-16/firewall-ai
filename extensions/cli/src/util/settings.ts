import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * User-scoped CLI settings stored at `~/.ai-firewall/settings.json`.
 *
 * Mirrors Claude Code's pattern where the TUI reads a JSON file for
 * lightweight preferences (statusLine, theme, etc.) separate from the
 * main config.yaml which drives models and tools.
 *
 * All fields are optional; callers merge against safe defaults.
 */
export interface CliSettings {
  statusLine?: StatusLineSettings;
}

export type StatusLineSettings =
  | { type: "default"; enabled?: boolean }
  | {
      type: "command";
      enabled?: boolean;
      /** Absolute path to a shell script that prints one line on stdout. */
      command: string;
      /** Refresh cadence. Defaults to 2000 ms. */
      updateIntervalMs?: number;
    };

const SETTINGS_FILE = path.join(os.homedir(), ".ai-firewall", "settings.json");

function ensureDir(): void {
  const dir = path.dirname(SETTINGS_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function loadCliSettings(): CliSettings {
  try {
    if (!fs.existsSync(SETTINGS_FILE)) return {};
    const raw = fs.readFileSync(SETTINGS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return parsed as CliSettings;
    return {};
  } catch {
    return {};
  }
}

export function saveCliSettings(settings: CliSettings): void {
  ensureDir();
  fs.writeFileSync(
    SETTINGS_FILE,
    JSON.stringify(settings, null, 2) + "\n",
    "utf8",
  );
}

export function updateStatusLineSettings(
  updater: (
    current: StatusLineSettings | undefined,
  ) => StatusLineSettings | undefined,
): CliSettings {
  const settings = loadCliSettings();
  const next = updater(settings.statusLine);
  const merged: CliSettings = {
    ...settings,
    statusLine: next,
  };
  if (next === undefined) {
    delete merged.statusLine;
  }
  saveCliSettings(merged);
  return merged;
}

export function settingsFilePath(): string {
  return SETTINGS_FILE;
}
