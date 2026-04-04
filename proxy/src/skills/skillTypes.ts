/**
 * Skill Type System
 *
 * Skills are prompt-based mini-agents: each has a SKILL.md file with
 * frontmatter (name, description, trigger patterns) and a markdown body
 * that becomes the prompt template.
 *
 * Skills are loaded from:
 *   1. Bundled (proxy/src/skills/bundled/) — shipped with AI Firewall
 *   2. Project directory (~/.ai-firewall/skills/) — user-created
 *   3. Workspace directory (.ai-firewall/skills/) — project-scoped
 */

// ── Types ──────────────────────────────────────────────────────

export interface SkillDefinition {
  readonly name: string;
  readonly description: string;
  readonly trigger?: string;
  /** File glob patterns that activate this skill */
  readonly paths?: readonly string[];
  /** Model override for this skill */
  readonly model?: string;
  /** Execution context: inline (expand in conversation) or fork (sub-agent) */
  readonly context?: "inline" | "fork";
  /** The prompt template (from SKILL.md body) */
  readonly promptTemplate: string;
  /** Source location */
  readonly source: SkillSource;
  readonly filePath: string;
}

export type SkillSource = "bundled" | "project" | "workspace" | "plugin";

// ── SKILL.md frontmatter ───────────────────────────────────────

export interface SkillFrontmatter {
  readonly name: string;
  readonly description: string;
  readonly trigger?: string;
  readonly paths?: string;
  readonly model?: string;
  readonly context?: "inline" | "fork";
}

const SKILL_FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

export function parseSkillFile(
  raw: string,
  source: SkillSource,
  filePath: string,
): SkillDefinition | null {
  const match = raw.match(SKILL_FRONTMATTER_RE);
  if (!match) return null;

  const [, yamlBlock, body] = match;
  const fields: Record<string, string> = {};

  for (const line of yamlBlock.split("\n")) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    fields[key] = value;
  }

  const name = fields.name;
  const description = fields.description;
  if (!name || !description) return null;

  return {
    name: name.toLowerCase(),
    description,
    trigger: fields.trigger,
    paths: fields.paths?.split(",").map((p) => p.trim()),
    model: fields.model,
    context: (fields.context as "inline" | "fork") ?? "inline",
    promptTemplate: body.trim(),
    source,
    filePath,
  };
}

// ── Prompt expansion ───────────────────────────────────────────

/**
 * Expand a skill's prompt template with user arguments.
 * Template variables: {{args}}, {{file}}, {{selection}}, {{cwd}}
 */
export function expandSkillPrompt(
  template: string,
  args: string,
  context?: { file?: string; selection?: string; cwd?: string },
): string {
  return template
    .replace(/\{\{args\}\}/g, args)
    .replace(/\{\{file\}\}/g, context?.file ?? "")
    .replace(/\{\{selection\}\}/g, context?.selection ?? "")
    .replace(/\{\{cwd\}\}/g, context?.cwd ?? process.cwd());
}
