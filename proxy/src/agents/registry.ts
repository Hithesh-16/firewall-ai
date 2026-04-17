/**
 * Declarative Subagent Registry — Phase I.I2
 * (SECURITY_HARDENING_PLAN.md).
 *
 * Reads subagent definitions from YAML files in two locations
 * (project-scoped wins over user-scoped, same precedence pattern as
 * `policy.json` and `.mcp.json`):
 *
 *   1. `<workspace>/.ai-firewall/subagents.yaml`
 *   2. `~/.ai-firewall/subagents.yaml`
 *
 * Each entry describes a named subagent that the LLM can invoke via
 * the `task(name, instructions)` tool. When the registry is non-empty,
 * the chat route injects the `task` tool into the model's tool list
 * so the model can delegate work to child workers.
 *
 * Shape (one entry):
 *
 * ```yaml
 * - name: researcher
 *   description: Searches codebases and summarizes findings
 *   system_prompt: You are a senior code research assistant...
 *   model: anthropic:claude-sonnet-4-6          # optional
 *   tools: [readFile, grepSearch, globSearch]    # optional subset
 *   isolation: worktree                          # optional
 * ```
 *
 * SOLID:
 *   - SRP: YAML read + merge only. No spawn logic (that stays in agentService).
 *   - OCP: new fields added to SubagentDef without changing registry callers.
 *   - DIP: depends on `fs` + `path`; no IDE/proxy coupling.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as YAML from "yaml";

// ── Public types ────────────────────────────────────────────────

export interface SubagentDef {
  /** Unique name the LLM uses in `task(name, instructions)`. */
  readonly name: string;
  /** One-line human-readable purpose (injected into the model's tool description). */
  readonly description: string;
  /** System prompt prepended to the subagent's context. */
  readonly system_prompt?: string;
  /** Optional model override (supports `provider:model-id` format from I1). */
  readonly model?: string;
  /** Optional tool whitelist. If absent, subagent gets all tools. */
  readonly tools?: readonly string[];
  /** Isolation mode. Defaults to `"none"`. */
  readonly isolation?: "worktree" | "none";
}

// ── Loading ─────────────────────────────────────────────────────

function userSubagentsPath(): string {
  return path.join(os.homedir(), ".ai-firewall", "subagents.yaml");
}

function projectSubagentsPath(projectPath: string): string {
  return path.join(projectPath, ".ai-firewall", "subagents.yaml");
}

function loadYamlArray(filePath: string): SubagentDef[] {
  if (!fs.existsSync(filePath)) return [];
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = YAML.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry: unknown) =>
        entry &&
        typeof entry === "object" &&
        typeof (entry as { name?: unknown }).name === "string",
    ) as SubagentDef[];
  } catch {
    return [];
  }
}

/**
 * Load and merge subagent definitions. Project-scoped entries
 * override user-scoped entries with the same `name`.
 */
export function loadSubagentRegistry(projectPath: string): SubagentDef[] {
  const userDefs = loadYamlArray(userSubagentsPath());
  const projectDefs = loadYamlArray(projectSubagentsPath(projectPath));

  // Merge: project wins.
  const merged = new Map<string, SubagentDef>();
  for (const def of userDefs) merged.set(def.name, def);
  for (const def of projectDefs) merged.set(def.name, def);

  return Array.from(merged.values());
}

/**
 * List just the names + descriptions — cheap summary for `/agents`
 * slash command and GUI AgentRegistryPage.
 */
export function listSubagentNames(
  projectPath: string,
): Array<{ name: string; description: string }> {
  return loadSubagentRegistry(projectPath).map((d) => ({
    name: d.name,
    description: d.description,
  }));
}

/**
 * Look up a specific subagent by name. Returns `undefined` if not
 * registered.
 */
export function getSubagentDef(
  projectPath: string,
  name: string,
): SubagentDef | undefined {
  return loadSubagentRegistry(projectPath).find((d) => d.name === name);
}

// ── Tool injection ──────────────────────────────────────────────

/**
 * Build the OpenAI-shaped `task` tool definition the LLM receives
 * when the registry is non-empty. The tool description dynamically
 * lists the available subagent names + descriptions so the model
 * knows what it can delegate to.
 */
export function buildTaskToolDefinition(registry: SubagentDef[]): {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
} | null {
  if (registry.length === 0) return null;

  const agentList = registry
    .map((d) => `  - ${d.name}: ${d.description}`)
    .join("\n");

  return {
    type: "function",
    function: {
      name: "task",
      description:
        "Delegate a subtask to a specialized subagent. Pick the name " +
        "from the list below and provide clear instructions. The " +
        "subagent runs in an isolated context and returns only the " +
        "final result.\n\nAvailable subagents:\n" +
        agentList,
      parameters: {
        type: "object",
        required: ["name", "instructions"],
        properties: {
          name: {
            type: "string",
            description:
              "Name of the subagent to invoke (must match one of the registered names above).",
            enum: registry.map((d) => d.name),
          },
          instructions: {
            type: "string",
            description:
              "Clear, self-contained instructions for the subagent. Include all context it needs — it cannot read the parent conversation.",
          },
        },
      },
    },
  };
}

// ── Test affordance ─────────────────────────────────────────────

export const _internal = {
  userSubagentsPath,
  projectSubagentsPath,
};
