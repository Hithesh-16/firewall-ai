import * as fs from "fs";
import * as path from "path";

import {
  AssistantUnrolled,
  PackageIdentifier,
  RegistryClient,
  unrollAssistantFromContent,
} from "@ai-firewall/config-yaml";
import { DefaultApiInterface } from "@ai-firewall/sdk/dist/api/dist/index.js";
import { loadAuthFile } from "@ai-firewall/shared-auth";
import chalk from "chalk";

import { CLIPlatformClient } from "./CLIPlatformClient.js";
import { env } from "./env.js";
import { logger } from "./util/logger.js";

/**
 * Phase G — API-sourced assistant loader.
 *
 * Replaces the legacy `~/.ai-firewall/config.yaml` loader with a
 * fetch against the proxy's `/api/me/assistant` endpoint. The
 * proxy is the source of truth; the CLI holds a read-only ETag
 * cache at `~/.ai-firewall/cache/assistant.yaml` so subsequent
 * boots are fast and work offline.
 *
 * Gated behind `AI_FIREWALL_USE_API_ASSISTANT=1`. When the flag
 * is not set, `configLoader.ts` falls back to the legacy
 * `local-config-yaml` source and prints a deprecation warning.
 *
 * Three modes:
 *
 *   1. Online + fresh cache: GET with `If-None-Match` →
 *      304 Not Modified → use cache as-is.
 *   2. Online + stale/missing cache: GET returns 200 + YAML →
 *      write `assistant.yaml` + `assistant.etag` → use fresh
 *      content.
 *   3. Offline: GET fails → fall back to cached copy with a
 *      "using cached assistant from <date>" banner.
 *
 * First-boot migration (see `syncLocalConfigYamlToApi`): if the
 * proxy returns 404 (no assistant configured) AND the legacy
 * `~/.ai-firewall/config.yaml` exists, we try to import it as a
 * personal user assistant via `PUT /api/me/assistants/default`.
 * This is the one place the legacy file is still touched —
 * purely as a one-shot migration.
 */

const CACHE_DIR = path.join(env.continueHome, "cache");
const CACHE_YAML_PATH = path.join(CACHE_DIR, "assistant.yaml");
const CACHE_ETAG_PATH = path.join(CACHE_DIR, "assistant.etag");
const CACHE_META_PATH = path.join(CACHE_DIR, "assistant.meta.json");

/**
 * Feature gate — set `AI_FIREWALL_USE_API_ASSISTANT=1` to opt in.
 * Off by default so this ships without breaking anyone's current
 * `~/.ai-firewall/config.yaml` workflow. The default will flip in
 * a follow-up release once this path is battle-tested.
 */
export function isApiAssistantEnabled(): boolean {
  const flag = process.env.AI_FIREWALL_USE_API_ASSISTANT;
  return flag === "1" || flag === "true";
}

interface CachedMeta {
  savedAt: number;
  etag: string;
  proxyUrl: string;
}

function ensureCacheDir(): void {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function readCachedYaml(): string | null {
  try {
    if (!fs.existsSync(CACHE_YAML_PATH)) return null;
    return fs.readFileSync(CACHE_YAML_PATH, "utf8");
  } catch {
    return null;
  }
}

function readCachedEtag(): string | null {
  try {
    if (!fs.existsSync(CACHE_ETAG_PATH)) return null;
    return fs.readFileSync(CACHE_ETAG_PATH, "utf8").trim();
  } catch {
    return null;
  }
}

function readCachedMeta(): CachedMeta | null {
  try {
    if (!fs.existsSync(CACHE_META_PATH)) return null;
    return JSON.parse(fs.readFileSync(CACHE_META_PATH, "utf8")) as CachedMeta;
  } catch {
    return null;
  }
}

function writeCache(yaml: string, etag: string, proxyUrl: string): void {
  ensureCacheDir();
  // Atomic writes: .tmp then rename.
  const tmpYaml = CACHE_YAML_PATH + ".tmp";
  const tmpEtag = CACHE_ETAG_PATH + ".tmp";
  const tmpMeta = CACHE_META_PATH + ".tmp";
  fs.writeFileSync(tmpYaml, yaml, { encoding: "utf8", mode: 0o600 });
  fs.writeFileSync(tmpEtag, etag, { encoding: "utf8", mode: 0o600 });
  fs.writeFileSync(
    tmpMeta,
    JSON.stringify({
      savedAt: Date.now(),
      etag,
      proxyUrl,
    } satisfies CachedMeta),
    { encoding: "utf8", mode: 0o600 },
  );
  fs.renameSync(tmpYaml, CACHE_YAML_PATH);
  fs.renameSync(tmpEtag, CACHE_ETAG_PATH);
  fs.renameSync(tmpMeta, CACHE_META_PATH);
}

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

/**
 * Hit `/api/me/assistant` with ETag. Returns:
 *   - null          → the proxy has no assistant for this user (404)
 *   - "not-modified"→ cache is fresh, caller should read from disk
 *   - { yaml, etag }→ fresh content to write + use
 */
async function fetchAssistant(
  proxyUrl: string,
  bearer: string,
  currentEtag: string | null,
): Promise<
  | { kind: "not-modified" }
  | { kind: "fresh"; yaml: string; etag: string }
  | { kind: "missing" }
  | { kind: "error"; message: string }
> {
  try {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${bearer}`,
    };
    if (currentEtag) {
      headers["If-None-Match"] = currentEtag;
    }
    const res = await fetch(
      `${proxyUrl.replace(/\/+$/, "")}/api/me/assistant`,
      {
        headers,
      },
    );
    if (res.status === 304) {
      return { kind: "not-modified" };
    }
    if (res.status === 404) {
      return { kind: "missing" };
    }
    if (!res.ok) {
      return {
        kind: "error",
        message: `HTTP ${res.status} ${res.statusText}`,
      };
    }
    const body = (await res.json()) as AssistantResponse;
    return {
      kind: "fresh",
      yaml: body.assistant.yaml,
      etag: body.assistant.etag,
    };
  } catch (err) {
    return {
      kind: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * One-shot migration: if the proxy has no assistant for the signed-in
 * user AND the legacy `~/.ai-firewall/config.yaml` exists, import
 * it as a personal user assistant via `PUT /api/me/assistants/default`.
 *
 * This is the ONLY code path that still reads the legacy YAML file
 * in Phase G. Once the import succeeds, subsequent boots of the
 * CLI will load from `/api/me/assistant` and never touch the file
 * again. The file is left on disk as a backup — we never delete
 * user data.
 */
export async function syncLocalConfigYamlToApi(
  proxyUrl: string,
  bearer: string,
): Promise<boolean> {
  const legacyPath = path.join(env.continueHome, "config.yaml");
  if (!fs.existsSync(legacyPath)) {
    return false;
  }
  let yaml: string;
  try {
    yaml = fs.readFileSync(legacyPath, "utf8");
  } catch (err) {
    logger.warn(
      "Could not read legacy config.yaml for migration",
      err instanceof Error ? err : new Error(String(err)),
    );
    return false;
  }

  try {
    const res = await fetch(
      `${proxyUrl.replace(/\/+$/, "")}/api/me/assistants/default`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${bearer}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "Imported from config.yaml",
          yaml,
          isDefault: true,
        }),
      },
    );
    if (!res.ok) {
      logger.warn(`config.yaml migration failed: HTTP ${res.status}`);
      return false;
    }
    console.info(
      chalk.green(
        "✓ Imported your legacy ~/.ai-firewall/config.yaml into the proxy " +
          "as a personal assistant. Future boots will load it via the API.",
      ),
    );
    return true;
  } catch (err) {
    logger.warn(
      "config.yaml migration failed",
      err instanceof Error ? err : new Error(String(err)),
    );
    return false;
  }
}

/**
 * Load an assistant YAML via the API, with ETag cache and offline
 * fallback. Returns the raw YAML string — the caller is responsible
 * for handing it to `unrollAssistantFromContent`.
 *
 * Throws only when:
 *   - The user is not signed in (no shared-auth file)
 *   - Both the API fetch AND the cache read fail
 * In every other case (offline + cached, ETag match, etc.) this
 * returns a usable YAML string with a message printed to stdout.
 */
export async function loadAssistantYamlFromApi(): Promise<string> {
  const authFile = loadAuthFile();
  if (!authFile || !authFile.accessToken) {
    throw new Error(
      "Not signed in to AI Firewall. Run `cn login` to fetch your assistant.",
    );
  }
  const proxyUrl = authFile.proxyUrl || "http://localhost:8080";
  const bearer = authFile.accessToken;

  const cachedEtag = readCachedEtag();
  const cachedYaml = readCachedYaml();

  const result = await fetchAssistant(proxyUrl, bearer, cachedEtag);

  switch (result.kind) {
    case "not-modified":
      if (cachedYaml) return cachedYaml;
      // Cache was supposed to be there but isn't — refetch without etag.
      logger.warn("Assistant cache missing despite 304 — refetching");
      return loadAssistantYamlFromApiForceFresh(proxyUrl, bearer);

    case "fresh":
      writeCache(result.yaml, result.etag, proxyUrl);
      return result.yaml;

    case "missing": {
      // Try the one-shot config.yaml migration before giving up.
      const imported = await syncLocalConfigYamlToApi(proxyUrl, bearer);
      if (imported) {
        // Re-fetch after the import so the cache is populated.
        const retry = await fetchAssistant(proxyUrl, bearer, null);
        if (retry.kind === "fresh") {
          writeCache(retry.yaml, retry.etag, proxyUrl);
          return retry.yaml;
        }
      }
      throw new Error(
        "No assistant configured for your user or org. " +
          "Ask an admin to provision one, or create one in the web dashboard.",
      );
    }

    case "error":
      // Network / proxy error — fall back to cache if available.
      if (cachedYaml) {
        const meta = readCachedMeta();
        const when = meta
          ? new Date(meta.savedAt).toLocaleString()
          : "unknown date";
        console.warn(
          chalk.yellow(
            `Could not reach AI Firewall proxy (${result.message}). ` +
              `Using cached assistant from ${when}.`,
          ),
        );
        return cachedYaml;
      }
      throw new Error(
        `Could not fetch assistant and no local cache exists: ${result.message}`,
      );
  }
}

async function loadAssistantYamlFromApiForceFresh(
  proxyUrl: string,
  bearer: string,
): Promise<string> {
  const result = await fetchAssistant(proxyUrl, bearer, null);
  if (result.kind === "fresh") {
    writeCache(result.yaml, result.etag, proxyUrl);
    return result.yaml;
  }
  throw new Error(
    result.kind === "error"
      ? `Failed to fetch assistant: ${result.message}`
      : `Failed to fetch assistant: kind=${result.kind}`,
  );
}

/**
 * Full pipeline: fetch YAML from the API, then hand it to the
 * Continue config-yaml unroller (same function the legacy
 * `loadLocalConfigYaml` path uses) so the returned
 * `AssistantUnrolled` object is drop-in compatible with every
 * downstream consumer.
 */
export async function loadAssistantFromApi(
  accessToken: string | null,
  organizationId: string | null,
  apiClient: DefaultApiInterface,
  injectBlocks: PackageIdentifier[],
): Promise<AssistantUnrolled> {
  const yaml = await loadAssistantYamlFromApi();

  const unrollResult = await unrollAssistantFromContent(
    { uriType: "file", fileUri: "" },
    yaml,
    new RegistryClient({
      accessToken: accessToken ?? undefined,
      apiBase: env.apiBase,
      rootPath: undefined,
    }),
    {
      currentUserSlug: "",
      onPremProxyUrl: null,
      orgScopeId: organizationId,
      platformClient: new CLIPlatformClient(organizationId, apiClient),
      renderSecrets: true,
      injectBlocks,
    },
  );
  if (unrollResult.errors) {
    const fatal = unrollResult.errors.find((e) => e.fatal);
    if (fatal) {
      throw new Error(`Failed to load API assistant: ${fatal.message}`);
    }
  }
  if (!unrollResult.config) {
    throw new Error("API assistant unroll returned no config");
  }
  return unrollResult.config;
}
