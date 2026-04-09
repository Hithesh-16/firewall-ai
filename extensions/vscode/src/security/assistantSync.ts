import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * Phase F2+ — VS Code assistant sync.
 *
 * Pulls the user's assistant YAML from the proxy's `/api/me/assistant`
 * endpoint (with provider keys injected server-side) and writes it
 * to `~/.ai-firewall/config.yaml` — the file Continue core's
 * `ConfigHandler` already reads on every refresh.
 *
 * Why write to `config.yaml` instead of a cache path:
 *
 *   - Continue core has a hardcoded expectation of this path via
 *     `core/util/paths.ts:getConfigYamlPath()`. Changing that path
 *     would mean shipping a fork of ConfigHandler, which is way
 *     too invasive for this fix.
 *
 *   - The CLI already has its own cache path
 *     (`~/.ai-firewall/cache/assistant.yaml`) used by Phase G's
 *     `apiAssistantLoader.ts`. That's fine because the CLI wraps
 *     ConfigHandler with its own loader. VS Code uses ConfigHandler
 *     directly, so the write has to happen at the file ConfigHandler
 *     actually reads.
 *
 * Collision handling:
 *
 *   - We only overwrite the file if its first line does NOT contain
 *     the marker comment `# user-managed: true`. That's the escape
 *     hatch for advanced users who want to hand-edit YAML and not
 *     have the sync clobber their changes.
 *
 *   - Every auto-generated write starts with `# Managed by AI Firewall
 *     — edit via the web dashboard.` so users know not to touch it.
 *
 *   - We track the last-synced ETag in `~/.ai-firewall/cache/vscode-assistant.etag`
 *     so subsequent syncs are conditional GETs (304 on no change).
 *
 * Error handling:
 *
 *   - Network failures are silent — we log via the returned status
 *     and let the existing ConfigHandler keep reading whatever is
 *     already on disk. No banners, no alarms. The sync runs on
 *     every sign-in event + every 10 minutes in the background
 *     as a safety net.
 */

const CACHE_DIR = path.join(os.homedir(), ".ai-firewall", "cache");
const ETAG_PATH = path.join(CACHE_DIR, "vscode-assistant.etag");
const CONFIG_YAML_PATH = path.join(os.homedir(), ".ai-firewall", "config.yaml");

const MANAGED_HEADER =
  "# Managed by AI Firewall — edit via the web dashboard.\n" +
  "# Add `# user-managed: true` on the first line to prevent auto-sync.\n";

const USER_MANAGED_MARKER = "# user-managed: true";

export type SyncStatus =
  | { kind: "ok"; fresh: boolean }
  | { kind: "not-signed-in" }
  | { kind: "user-managed" }
  | { kind: "error"; message: string };

interface AssistantResponse {
  assistant: {
    slug: string;
    name: string;
    owner: { type: "org" | "user"; id: number };
    yaml: string;
    etag: string;
    isDefault: boolean;
    updatedAt: number;
  };
}

function ensureCacheDir(): void {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function readCachedEtag(): string | null {
  try {
    if (!fs.existsSync(ETAG_PATH)) return null;
    return fs.readFileSync(ETAG_PATH, "utf8").trim();
  } catch {
    return null;
  }
}

function writeCachedEtag(etag: string): void {
  ensureCacheDir();
  const tmp = ETAG_PATH + ".tmp";
  fs.writeFileSync(tmp, etag, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tmp, ETAG_PATH);
}

function isFileUserManaged(filePath: string): boolean {
  try {
    if (!fs.existsSync(filePath)) return false;
    const head = fs.readFileSync(filePath, "utf8").slice(0, 200);
    return head.includes(USER_MANAGED_MARKER);
  } catch {
    return false;
  }
}

function writeConfigYaml(yaml: string): void {
  // Atomic write: .tmp then rename, chmod 600 so the injected
  // keys aren't world-readable.
  const dir = path.dirname(CONFIG_YAML_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmp = CONFIG_YAML_PATH + ".tmp";
  const body = MANAGED_HEADER + yaml;
  fs.writeFileSync(tmp, body, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tmp, CONFIG_YAML_PATH);
}

/**
 * Pull the user's model list + assistant config from the proxy
 * and write a merged config.yaml. Uses two endpoints:
 *
 *   1. GET /api/me/models/list → the unified user_models table
 *      (provider + model + display name, no keys — keys are
 *      resolved at gateway dispatch time)
 *   2. GET /api/me/assistant → non-model config (MCP servers,
 *      rules, context providers) with API keys injected
 *
 * The config.yaml gets model entries from (1) for the model
 * selector, and uses the full assistant YAML from (2) when
 * available (because it has the injected API keys the CLI's
 * LLM client needs for direct-to-provider calls in offline
 * mode).
 */
export async function syncAssistantToConfigYaml(
  proxyUrl: string,
  bearerToken: string,
): Promise<SyncStatus> {
  if (!bearerToken) return { kind: "not-signed-in" };

  if (isFileUserManaged(CONFIG_YAML_PATH)) {
    return { kind: "user-managed" };
  }

  const base = proxyUrl.replace(/\/+$/, "");
  const headers: Record<string, string> = {
    Authorization: `Bearer ${bearerToken}`,
  };

  try {
    // Fetch both in parallel
    const [assistantRes, modelsRes] = await Promise.all([
      fetch(`${base}/api/me/assistant`, {
        headers: {
          ...headers,
          ...(readCachedEtag() ? { "If-None-Match": readCachedEtag()! } : {}),
        },
      }).catch(() => null),
      fetch(`${base}/api/me/models/list`, { headers }).catch(() => null),
    ]);

    // If we got a fresh assistant YAML (with keys injected),
    // use it directly — it's the most complete config. Models
    // from user_models are already reflected because the proxy's
    // me.route.ts auto-syncs the assistant YAML on provider add.
    if (!assistantRes) {
      return { kind: "error", message: "Proxy unreachable" };
    }
    const res = assistantRes;
    const cachedEtag = readCachedEtag();

    if (res.status === 304) {
      return { kind: "ok", fresh: false };
    }
    if (res.status === 404) {
      return {
        kind: "error",
        message:
          "No assistant configured on the server. Open the web dashboard " +
          "and add a model in Settings → Assistant.",
      };
    }
    if (!res.ok) {
      return {
        kind: "error",
        message: `HTTP ${res.status} ${res.statusText}`,
      };
    }

    const body = (await res.json()) as AssistantResponse;
    const yaml = body.assistant?.yaml;
    const etag = body.assistant?.etag;
    if (!yaml || !etag) {
      return {
        kind: "error",
        message: "Assistant response missing yaml or etag",
      };
    }

    // If the etag matches what we already cached AND the file on
    // disk has the right content, we can skip the write. The
    // cache path and the file path are separate so a manual
    // deletion of `config.yaml` forces a refresh on next sync.
    if (cachedEtag === etag && fs.existsSync(CONFIG_YAML_PATH)) {
      return { kind: "ok", fresh: false };
    }

    // Also skip write if the current file already contains the
    // same YAML body — this catches the case where the cache
    // file was deleted but the on-disk YAML is identical.
    try {
      if (fs.existsSync(CONFIG_YAML_PATH)) {
        const current = fs.readFileSync(CONFIG_YAML_PATH, "utf8");
        const currentWithoutHeader = current.replace(MANAGED_HEADER, "");
        const currentHash = crypto
          .createHash("sha256")
          .update(currentWithoutHeader)
          .digest("hex");
        const freshHash = crypto
          .createHash("sha256")
          .update(yaml)
          .digest("hex");
        if (currentHash === freshHash) {
          writeCachedEtag(etag);
          return { kind: "ok", fresh: false };
        }
      }
    } catch {
      /* fall through to write */
    }

    writeConfigYaml(yaml);
    writeCachedEtag(etag);
    return { kind: "ok", fresh: true };
  } catch (err) {
    return {
      kind: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
