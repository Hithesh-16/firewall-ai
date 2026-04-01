import * as fs from "node:fs";
import * as path from "node:path";
import { ToolImpl } from ".";
import { getStringArg } from "../parseArgs";

const MEMORY_DIR_NAME = ".ai-firewall";
const MEMORY_SUBDIR = "memory";
const INDEX_FILE = "MEMORY.md";

/**
 * Resolves the memory directory for the current workspace.
 * Creates it if it doesn't exist.
 */
function getMemoryDir(workspaceRoot: string): string {
  const memDir = path.join(workspaceRoot, MEMORY_DIR_NAME, MEMORY_SUBDIR);
  if (!fs.existsSync(memDir)) {
    fs.mkdirSync(memDir, { recursive: true });
  }
  return memDir;
}

/**
 * save_memory tool — Saves a memory entry to the project's .ai-firewall/memory/ directory.
 *
 * Parameters:
 *   - name: Short identifier for the memory (used as filename)
 *   - type: "user" | "feedback" | "project" | "reference"
 *   - description: One-line description (used to decide relevance in future sessions)
 *   - content: The memory content
 */
export const saveMemoryImpl: ToolImpl = async (args, extras) => {
  const name = getStringArg(args, "name");
  const type = getStringArg(args, "type");
  const description = getStringArg(args, "description");
  const content = getStringArg(args, "content");

  // Get workspace root
  const workspaceDirs = await extras.ide.getWorkspaceDirs();
  if (workspaceDirs.length === 0) {
    return [
      {
        name: "Error",
        description: "No workspace open",
        content: "Cannot save memory: no workspace directory is open.",
      },
    ];
  }

  const workspaceRoot = workspaceDirs[0];
  // Strip file:// prefix if present
  const rootPath = workspaceRoot.startsWith("file://")
    ? workspaceRoot.slice(7)
    : workspaceRoot;

  const memDir = getMemoryDir(rootPath);
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const filename = `${slug}.md`;
  const filepath = path.join(memDir, filename);

  // Write memory file with frontmatter
  const fileContent = `---
name: ${name}
description: ${description}
type: ${type}
---

${content}
`;

  fs.writeFileSync(filepath, fileContent, "utf-8");

  // Update MEMORY.md index
  const indexPath = path.join(memDir, INDEX_FILE);
  let indexContent = "";
  if (fs.existsSync(indexPath)) {
    indexContent = fs.readFileSync(indexPath, "utf-8");
  }

  // Check if already indexed
  if (!indexContent.includes(filename)) {
    const entry = `- [${name}](${filename}) — ${description} (${type})\n`;
    indexContent += entry;
    fs.writeFileSync(indexPath, indexContent, "utf-8");
  }

  return [
    {
      name: "Memory Saved",
      description: filepath,
      content: `Memory "${name}" saved to ${filepath}`,
    },
  ];
};

/**
 * read_memory tool — Reads all memories or a specific memory from .ai-firewall/memory/.
 *
 * Parameters:
 *   - query: Optional search term to filter memories. If empty, returns the index.
 */
export const readMemoryImpl: ToolImpl = async (args, extras) => {
  const query = (args.query as string) || "";

  const workspaceDirs = await extras.ide.getWorkspaceDirs();
  if (workspaceDirs.length === 0) {
    return [
      {
        name: "No memories",
        description: "No workspace open",
        content: "No workspace directory is open.",
      },
    ];
  }

  const workspaceRoot = workspaceDirs[0];
  const rootPath = workspaceRoot.startsWith("file://")
    ? workspaceRoot.slice(7)
    : workspaceRoot;

  const memDir = path.join(rootPath, MEMORY_DIR_NAME, MEMORY_SUBDIR);

  if (!fs.existsSync(memDir)) {
    return [
      {
        name: "No memories",
        description: "Memory directory not found",
        content:
          "No memories saved yet. Use the save_memory tool to create one.",
      },
    ];
  }

  // If no query, return the index
  if (!query) {
    const indexPath = path.join(memDir, INDEX_FILE);
    if (fs.existsSync(indexPath)) {
      const indexContent = fs.readFileSync(indexPath, "utf-8");
      return [
        {
          name: "Memory Index",
          description: "MEMORY.md",
          content: indexContent || "No memories indexed yet.",
        },
      ];
    }
    return [
      {
        name: "No memories",
        description: "Empty memory index",
        content: "No memories saved yet.",
      },
    ];
  }

  // Search memories by query
  const files = fs.readdirSync(memDir).filter((f) => f.endsWith(".md") && f !== INDEX_FILE);
  const matches: string[] = [];

  for (const file of files) {
    const content = fs.readFileSync(path.join(memDir, file), "utf-8");
    if (
      content.toLowerCase().includes(query.toLowerCase()) ||
      file.toLowerCase().includes(query.toLowerCase())
    ) {
      matches.push(`## ${file}\n${content}`);
    }
  }

  if (matches.length === 0) {
    return [
      {
        name: "No matches",
        description: `No memories matching "${query}"`,
        content: `No memories found matching "${query}".`,
      },
    ];
  }

  return [
    {
      name: "Memory Search Results",
      description: `${matches.length} memories matching "${query}"`,
      content: matches.join("\n\n---\n\n"),
    },
  ];
};

/**
 * Load all memories as context for the system prompt.
 * Called on session start to give the agent persistent memory.
 */
export function loadAllMemories(workspaceRoot: string): string | null {
  const rootPath = workspaceRoot.startsWith("file://")
    ? workspaceRoot.slice(7)
    : workspaceRoot;
  const memDir = path.join(rootPath, MEMORY_DIR_NAME, MEMORY_SUBDIR);

  if (!fs.existsSync(memDir)) {
    return null;
  }

  const indexPath = path.join(memDir, INDEX_FILE);
  if (!fs.existsSync(indexPath)) {
    return null;
  }

  const indexContent = fs.readFileSync(indexPath, "utf-8").trim();
  if (!indexContent) {
    return null;
  }

  // Load all memory files referenced in the index
  const files = fs.readdirSync(memDir).filter((f) => f.endsWith(".md") && f !== INDEX_FILE);
  const memories: string[] = [`# Project Memories\n\n${indexContent}\n`];

  for (const file of files.slice(0, 20)) {
    // Cap at 20 to avoid context bloat
    const content = fs.readFileSync(path.join(memDir, file), "utf-8");
    memories.push(`## ${file}\n${content}`);
  }

  return memories.join("\n\n");
}
