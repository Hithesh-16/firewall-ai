import * as fs from "node:fs";
import * as path from "node:path";
import { loadAllMemories } from "../tools/implementations/memory";

const INSTRUCTION_FILES = [
  ".aifirewall.md",
  ".ai-firewall.md",
  "AIFIREWALL.md",
];

/**
 * Load project-level instructions from .aifirewall.md (similar to CLAUDE.md).
 * Returns the file content or null if not found.
 */
export function loadProjectInstructions(workspaceRoot: string): string | null {
  const rootPath = workspaceRoot.startsWith("file://")
    ? workspaceRoot.slice(7)
    : workspaceRoot;

  for (const filename of INSTRUCTION_FILES) {
    const filepath = path.join(rootPath, filename);
    if (fs.existsSync(filepath)) {
      try {
        return fs.readFileSync(filepath, "utf-8");
      } catch {
        // Ignore read errors
      }
    }
  }

  return null;
}

/**
 * Load all project context that should be injected into the system prompt:
 * 1. .aifirewall.md project instructions
 * 2. Persistent memories from .ai-firewall/memory/
 *
 * Returns a combined string or null if nothing to inject.
 */
export function loadProjectContext(workspaceRoot: string): string | null {
  const parts: string[] = [];

  const instructions = loadProjectInstructions(workspaceRoot);
  if (instructions) {
    parts.push(`<project-instructions>\n${instructions}\n</project-instructions>`);
  }

  const memories = loadAllMemories(workspaceRoot);
  if (memories) {
    parts.push(`<project-memories>\n${memories}\n</project-memories>`);
  }

  return parts.length > 0 ? parts.join("\n\n") : null;
}
