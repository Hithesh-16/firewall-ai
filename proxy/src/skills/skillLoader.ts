/**
 * Skill Loader
 *
 * Discovers and loads skills from bundled, project, and workspace directories.
 * Skills are SKILL.md files with frontmatter + prompt template body.
 */

import fs from "node:fs";
import path from "node:path";
import {
  type SkillDefinition,
  type SkillSource,
  parseSkillFile,
} from "./skillTypes";
import { env } from "../config";

// ── Loader ─────────────────────────────────────────────────────

let cachedSkills: readonly SkillDefinition[] | null = null;

/**
 * Load all skills from all sources (memoized).
 * Call clearSkillCache() to force reload.
 */
export function loadAllSkills(
  projectPath?: string,
): readonly SkillDefinition[] {
  if (cachedSkills) return cachedSkills;

  const skills: SkillDefinition[] = [];
  const seen = new Set<string>();

  // 1. Bundled skills (highest priority)
  const bundledDir = path.resolve(__dirname, "bundled");
  const bundled = loadSkillsFromDirectory(bundledDir, "bundled");
  for (const skill of bundled) {
    if (!seen.has(skill.name)) {
      seen.add(skill.name);
      skills.push(skill);
    }
  }

  // 2. Project skills (~/.ai-firewall/skills/)
  const dataDir = path.dirname(path.resolve(process.cwd(), env.DB_PATH));
  const projectSkillDir = path.join(dataDir, "skills");
  const projectSkills = loadSkillsFromDirectory(projectSkillDir, "project");
  for (const skill of projectSkills) {
    if (!seen.has(skill.name)) {
      seen.add(skill.name);
      skills.push(skill);
    }
  }

  // 3. Workspace skills (.ai-firewall/skills/ in project root)
  if (projectPath) {
    const workspaceSkillDir = path.join(projectPath, ".ai-firewall", "skills");
    const workspaceSkills = loadSkillsFromDirectory(
      workspaceSkillDir,
      "workspace",
    );
    for (const skill of workspaceSkills) {
      if (!seen.has(skill.name)) {
        seen.add(skill.name);
        skills.push(skill);
      }
    }
  }

  // Sort alphabetically
  skills.sort((a, b) => a.name.localeCompare(b.name));

  cachedSkills = skills;
  return skills;
}

export function clearSkillCache(): void {
  cachedSkills = null;
}

// ── Directory loader ───────────────────────────────────────────

function loadSkillsFromDirectory(
  dirPath: string,
  source: SkillSource,
): SkillDefinition[] {
  if (!fs.existsSync(dirPath)) return [];

  const skills: SkillDefinition[] = [];

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      // SKILL.md directly in skills/
      if (entry.isFile() && entry.name === "SKILL.md") {
        const skill = loadSkillFromFile(path.join(dirPath, entry.name), source);
        if (skill) skills.push(skill);
        continue;
      }

      // Subdirectory with SKILL.md inside
      if (entry.isDirectory()) {
        const skillFile = path.join(dirPath, entry.name, "SKILL.md");
        if (fs.existsSync(skillFile)) {
          const skill = loadSkillFromFile(skillFile, source);
          if (skill) skills.push(skill);
        }
      }
    }
  } catch {
    // Directory unreadable — skip silently
  }

  return skills;
}

function loadSkillFromFile(
  filePath: string,
  source: SkillSource,
): SkillDefinition | null {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return parseSkillFile(raw, source, filePath);
  } catch {
    return null;
  }
}

// ── Find skill by name ─────────────────────────────────────────

export function findSkill(
  name: string,
  projectPath?: string,
): SkillDefinition | null {
  const skills = loadAllSkills(projectPath);
  const lower = name.toLowerCase();
  return skills.find((s) => s.name === lower) ?? null;
}

// ── List skills ────────────────────────────────────────────────

export interface SkillListEntry {
  readonly name: string;
  readonly description: string;
  readonly source: SkillSource;
  readonly context: "inline" | "fork";
  readonly trigger?: string;
}

export function listSkills(projectPath?: string): SkillListEntry[] {
  return loadAllSkills(projectPath).map((s) => ({
    name: s.name,
    description: s.description,
    source: s.source,
    context: s.context ?? "inline",
    trigger: s.trigger,
  }));
}
