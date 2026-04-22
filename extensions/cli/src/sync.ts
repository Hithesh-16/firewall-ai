import type { SharedAuthFile } from "@ai-firewall/shared-auth";
import chalk from "chalk";

import { loadAssistantYamlFromApi } from "./apiAssistantLoader.js";
import { reloadService, SERVICE_NAMES } from "./services/index.js";

/**
 * Shared "pull user config from proxy" implementation. Used by:
 *   - the interactive `/sync` slash command (reloads services afterwards)
 *   - the `cn login` command (fires a sync immediately after saving the
 *     shared auth file so a fresh install sees the user's web-added
 *     models on first run, without the user having to remember /sync)
 *
 * The function writes `~/.ai-firewall/config.yaml` atomically (chmod 600),
 * then returns a structured summary the caller can render however it wants.
 * Errors in any single step are captured in the returned summary — the
 * function never throws, so the login flow can best-effort sync without
 * blocking auth.
 */
export interface SyncFromProxyOptions {
  /** Reload in-memory services (CONFIG / MODEL / MCP) after writing config.yaml.
   *  Safe to leave false in contexts where the services aren't running yet
   *  (e.g. `cn login` before the TUI boots). */
  reloadServices?: boolean;
}

export interface SyncFromProxyResult {
  modelCount: number;
  modelsOk: boolean;
  policyOk: boolean;
  servicesReloaded: boolean;
  /** Human-readable status lines — one per step. The slash-command handler
   *  joins these with \n to render inline; the login command logs them
   *  with a "Synced" header. */
  lines: string[];
}

export async function syncFromProxy(
  auth: SharedAuthFile,
  proxyUrl: string,
  options: SyncFromProxyOptions = {},
): Promise<SyncFromProxyResult> {
  const { reloadServices = true } = options;
  const lines: string[] = [];
  const result: SyncFromProxyResult = {
    modelCount: 0,
    modelsOk: false,
    policyOk: false,
    servicesReloaded: false,
    lines,
  };

  // ── 1. Sync models from user_models table ───────────────────────────────
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

    let assistantYaml = "";
    try {
      assistantYaml = await loadAssistantYamlFromApi(true);
    } catch {
      /* no assistant — fine, models can stand alone */
    }

    let nonModelFields = "";
    if (assistantYaml) {
      try {
        const yamlMod = await import("yaml");
        const parsed = yamlMod.parse(assistantYaml) as Record<string, unknown>;
        delete parsed.models;
        nonModelFields = yamlMod.stringify(parsed);
      } catch {
        nonModelFields = "";
      }
    }

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

    const header =
      "# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n" +
      "# Managed by AI Firewall — synced from your account.\n" +
      "#\n" +
      "#   MODELS       → Settings → Models in the web dashboard\n" +
      "#                  (stored per-user; shared across CLI + IDEs)\n" +
      "#   RULES / MCP  → Settings → Assistant in the web dashboard,\n" +
      "#                  or edit the matching keys below.\n" +
      "#   SYSTEM MSG   → Settings → Assistant, or `systemMessage:`\n" +
      "#                  below.\n" +
      "#\n" +
      "# Put `# user-managed: true` on the first line to opt out of\n" +
      "# auto-sync and hand-manage everything.\n" +
      "# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n";

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

    const fs = await import("fs");
    const pathMod = await import("path");
    const os = await import("os");
    const configPath = pathMod.join(
      os.homedir(),
      ".ai-firewall",
      "config.yaml",
    );

    // Choose which YAML body to write. When the proxy returns an
    // assistant YAML use it; otherwise build a minimal doc from the
    // models list. Either way, layer local customisations (personal
    // rules, MCP servers, prompt file) before writing.
    const baseYaml = assistantYaml || yamlContent;
    let finalYaml = baseYaml;
    try {
      const yamlMod = await import("yaml");
      const { mergeLocalIntoAssistantYaml, scanLocalCustomisations } =
        await import("@ai-firewall/shared-auth");
      const local = scanLocalCustomisations();
      finalYaml = mergeLocalIntoAssistantYaml(baseYaml, local, {
        parseDocument: yamlMod.parseDocument,
        parse: yamlMod.parse,
        isSeq: yamlMod.isSeq,
        isMap: yamlMod.isMap,
      });
    } catch {
      /* merge failure is non-fatal — fall back to unmerged */
    }
    fs.writeFileSync(configPath, header + finalYaml, {
      encoding: "utf8",
      mode: 0o600,
    });

    result.modelCount = modelsBody.models.length;
    result.modelsOk = true;
    lines.push(
      chalk.green(
        `✓ Models synced (${result.modelCount} model${result.modelCount === 1 ? "" : "s"})`,
      ),
    );
    lines.push(
      chalk.dim(
        "  Models come from your account — manage them at Settings → Models " +
          "in the web dashboard.",
      ),
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    lines.push(chalk.red(`✗ Model sync failed: ${msg}`));
  }

  // ── 2. Sync effective policy ─────────────────────────────────────────────
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
      result.policyOk = true;
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

  // ── 3. Reload services (optional — callers pre-TUI should skip) ──────────
  if (reloadServices) {
    try {
      await reloadService(SERVICE_NAMES.CONFIG);
      await reloadService(SERVICE_NAMES.MODEL);
      await reloadService(SERVICE_NAMES.MCP);
      result.servicesReloaded = true;
      lines.push(chalk.green("✓ Config, model, and MCP services reloaded"));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      lines.push(chalk.yellow(`⚠ Service reload failed: ${msg}`));
    }
  }

  return result;
}
