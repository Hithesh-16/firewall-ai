import * as fs from "node:fs";
import * as path from "node:path";

import { getAuthRootDir } from "./authFile.js";

/**
 * Merge local, purely-personal customisations into a proxy-synced
 * assistant YAML.
 *
 * Architectural contract: account-bound data (models, org rules,
 * org skills) rides through the proxy. Everything else lives as
 * files under `~/.ai-firewall/` and is never uploaded.
 *
 *   ~/.ai-firewall/rules/*.md       → merged into the `rules:` block
 *   ~/.ai-firewall/mcp/*.json       → merged into `mcpServers:` block
 *   ~/.ai-firewall/prompts/*.txt    → first one becomes `systemMessage`
 *                                     (if the proxy YAML doesn't set one)
 *
 * Neither the IDE nor the CLI stores these in the backend; they're
 * read fresh on every sync so users can edit them in any text editor
 * and reload without touching the web dashboard.
 *
 * Files written by the proxy's catalogue-install flow carry the
 * marker `<!-- ai-firewall:managed -->` on line 1 — those are
 * already represented in the proxy YAML's `rules:` block and MUST
 * NOT be re-merged, otherwise every subscribed org rule would
 * double-render. Unmanaged `.md` files (user-authored) merge as
 * expected.
 */

export interface LocalCustomisations {
  personalRules: Array<{ slug: string; body: string }>;
  personalMcpServers: Array<{ name: string; config: Record<string, unknown> }>;
  personalSystemMessage: string | null;
}

const MANAGED_MARKER = "<!-- ai-firewall:managed -->";

function safeReaddir(dir: string): string[] {
  try {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

export function scanLocalCustomisations(
  root: string = getAuthRootDir(),
): LocalCustomisations {
  const rulesDir = path.join(root, "rules");
  const mcpDir = path.join(root, "mcp");
  const promptsDir = path.join(root, "prompts");

  const personalRules: LocalCustomisations["personalRules"] = [];
  for (const entry of safeReaddir(rulesDir)) {
    if (!entry.toLowerCase().endsWith(".md")) continue;
    const full = path.join(rulesDir, entry);
    try {
      const body = fs.readFileSync(full, "utf8");
      // Skip proxy-managed (org-curated) files — those are already
      // in the synthesised YAML via the rules block.
      if (body.slice(0, 200).includes(MANAGED_MARKER)) continue;
      const slug = entry.replace(/\.md$/i, "");
      personalRules.push({ slug, body: body.trim() });
    } catch {
      /* ignore unreadable file */
    }
  }

  const personalMcpServers: LocalCustomisations["personalMcpServers"] = [];
  for (const entry of safeReaddir(mcpDir)) {
    if (!entry.toLowerCase().endsWith(".json")) continue;
    const full = path.join(mcpDir, entry);
    try {
      const parsed = JSON.parse(fs.readFileSync(full, "utf8")) as Record<
        string,
        unknown
      >;
      // Each file is a full MCP server config. Use filename
      // (without .json) as the name if the body doesn't specify one.
      const name =
        typeof parsed.name === "string" && parsed.name.length > 0
          ? parsed.name
          : entry.replace(/\.json$/i, "");
      personalMcpServers.push({ name, config: parsed });
    } catch {
      /* ignore unparseable file */
    }
  }

  let personalSystemMessage: string | null = null;
  const promptFiles = safeReaddir(promptsDir).filter((f) =>
    /\.(txt|md)$/i.test(f),
  );
  // Prefer `default.*` if present; otherwise the first file alphabetically.
  promptFiles.sort((a, b) => {
    if (a.startsWith("default")) return -1;
    if (b.startsWith("default")) return 1;
    return a.localeCompare(b);
  });
  if (promptFiles.length > 0) {
    try {
      personalSystemMessage = fs
        .readFileSync(path.join(promptsDir, promptFiles[0]), "utf8")
        .trim();
    } catch {
      /* ignore */
    }
  }

  return {
    personalRules,
    personalMcpServers,
    personalSystemMessage,
  };
}

/**
 * Layer local customisations onto a proxy-synced YAML.
 *
 * - Personal rules are appended to the existing `rules:` sequence
 *   (as `- name + rule` objects so they look like the managed ones).
 * - MCP servers are appended to any existing `mcpServers:` block.
 *   User-defined names win over identical names in the proxy YAML
 *   (rare but possible with manual edits).
 * - `systemMessage` is set only if the proxy YAML doesn't already
 *   have one — proxy/admin intent wins.
 *
 * Accepts and returns a YAML string. Requires the `yaml` package
 * (already a dependency of both the CLI and the VS Code extension).
 *
 * Pure function — no filesystem writes.
 */
export function mergeLocalIntoAssistantYaml(
  assistantYaml: string,
  local: LocalCustomisations,
  yamlMod: {
    parseDocument: (s: string) => any;
    parse: (s: string) => unknown;
    isSeq: (v: unknown) => boolean;
    isMap: (v: unknown) => boolean;
  },
): string {
  if (
    local.personalRules.length === 0 &&
    local.personalMcpServers.length === 0 &&
    !local.personalSystemMessage
  ) {
    return assistantYaml;
  }

  let doc: ReturnType<typeof yamlMod.parseDocument>;
  try {
    doc = yamlMod.parseDocument(assistantYaml);
  } catch {
    return assistantYaml;
  }

  // ── Rules ─────────────────────────────────────────────────
  if (local.personalRules.length > 0) {
    const rulesDocText =
      "rules:\n" +
      local.personalRules
        .map((r) => {
          const safeName = JSON.stringify(r.slug);
          const indented = r.body
            .split("\n")
            .map((line) => `      ${line}`)
            .join("\n");
          return `  - name: ${safeName}\n    rule: |\n${indented}`;
        })
        .join("\n");
    const extra = yamlMod.parseDocument(rulesDocText);
    const extraSeq = extra.get("rules");
    if (extraSeq && yamlMod.isSeq(extraSeq)) {
      const existing = doc.get("rules");
      if (existing && yamlMod.isSeq(existing)) {
        for (const item of (extraSeq as any).items) {
          (existing as any).add(item);
        }
      } else {
        doc.set("rules", extraSeq);
      }
    }
  }

  // ── MCP servers ───────────────────────────────────────────
  if (local.personalMcpServers.length > 0) {
    const mcpBlock =
      "mcpServers:\n" +
      local.personalMcpServers
        .map((s) => {
          const lines = [`  - name: ${JSON.stringify(s.name)}`];
          for (const [k, v] of Object.entries(s.config)) {
            if (k === "name") continue;
            lines.push(`    ${k}: ${JSON.stringify(v)}`);
          }
          return lines.join("\n");
        })
        .join("\n");
    const extra = yamlMod.parseDocument(mcpBlock);
    const extraSeq = extra.get("mcpServers");
    if (extraSeq && yamlMod.isSeq(extraSeq)) {
      const existing = doc.get("mcpServers");
      if (existing && yamlMod.isSeq(existing)) {
        for (const item of (extraSeq as any).items) {
          (existing as any).add(item);
        }
      } else {
        doc.set("mcpServers", extraSeq);
      }
    }
  }

  // ── System message ───────────────────────────────────────
  if (local.personalSystemMessage && !doc.get("systemMessage")) {
    doc.set("systemMessage", local.personalSystemMessage);
  }

  return doc.toString();
}
