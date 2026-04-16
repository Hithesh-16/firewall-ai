/**
 * Memory tool for the CLI agent — Phase J.J4 (SECURITY_HARDENING_PLAN.md).
 *
 * Mirrors `core/tools/implementations/memory.ts` so the CLI agent has
 * the same persistent memory primitives the IDE side already exposes.
 * Reads/writes the project's `.ai-firewall/memory/` directory plus
 * the `MEMORY.md` index file.
 *
 * Two operations on one tool surface (kept under one Tool name so the
 * model only learns one concept):
 *   - "save"  — persist a new memory entry with frontmatter + index
 *   - "read"  — return either the index or files matching a query
 *
 * Why not two separate tools: deepagents' equivalent (`MemoryMiddleware`)
 * uses `read_file`/`write_file`/`edit_file` against a virtual `/memories`
 * filesystem. Our memory schema is richer (4 typed kinds + index), so
 * a single typed tool reads cleaner than three generic file ops the
 * model has to know to namespace correctly.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import type { Tool } from "./types.js";

const MEMORY_DIR_NAME = ".ai-firewall";
const MEMORY_SUBDIR = "memory";
const INDEX_FILE = "MEMORY.md";

function getMemoryDir(workspaceRoot: string): string {
  const memDir = path.join(workspaceRoot, MEMORY_DIR_NAME, MEMORY_SUBDIR);
  if (!fs.existsSync(memDir)) {
    fs.mkdirSync(memDir, { recursive: true });
  }
  return memDir;
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

interface SaveArgs {
  operation: "save";
  name: string;
  type: "user" | "feedback" | "project" | "reference";
  description: string;
  content: string;
}

interface ReadArgs {
  operation: "read";
  query?: string;
}

type MemoryArgs = SaveArgs | ReadArgs;

function saveMemory(args: SaveArgs, cwd: string): string {
  const memDir = getMemoryDir(cwd);
  const filename = `${slugify(args.name)}.md`;
  const filepath = path.join(memDir, filename);

  const fileContent =
    `---\n` +
    `name: ${args.name}\n` +
    `description: ${args.description}\n` +
    `type: ${args.type}\n` +
    `---\n\n` +
    `${args.content}\n`;

  fs.writeFileSync(filepath, fileContent, "utf-8");

  // Append to MEMORY.md index if not already there.
  const indexPath = path.join(memDir, INDEX_FILE);
  let indexContent = fs.existsSync(indexPath)
    ? fs.readFileSync(indexPath, "utf-8")
    : "";
  if (!indexContent.includes(filename)) {
    indexContent += `- [${args.name}](${filename}) — ${args.description} (${args.type})\n`;
    fs.writeFileSync(indexPath, indexContent, "utf-8");
  }

  return `Saved memory "${args.name}" → ${filepath}`;
}

function readMemory(args: ReadArgs, cwd: string): string {
  const memDir = path.join(cwd, MEMORY_DIR_NAME, MEMORY_SUBDIR);
  if (!fs.existsSync(memDir)) {
    return "No memories saved yet. Use `Memory` with operation:'save' to create one.";
  }

  // No query → return the index.
  if (!args.query) {
    const indexPath = path.join(memDir, INDEX_FILE);
    if (!fs.existsSync(indexPath)) return "No memories indexed yet.";
    const indexContent = fs.readFileSync(indexPath, "utf-8").trim();
    return indexContent || "No memories indexed yet.";
  }

  // Query → naive substring match against filenames + content.
  const q = args.query.toLowerCase();
  const files = fs
    .readdirSync(memDir)
    .filter((f) => f.endsWith(".md") && f !== INDEX_FILE);

  const matches: string[] = [];
  for (const file of files) {
    const content = fs.readFileSync(path.join(memDir, file), "utf-8");
    if (content.toLowerCase().includes(q) || file.toLowerCase().includes(q)) {
      matches.push(`## ${file}\n${content}`);
    }
  }

  if (matches.length === 0) return `No memories matched "${args.query}".`;
  return matches.join("\n\n---\n\n");
}

export const memoryTool: Tool = {
  name: "Memory",
  displayName: "Memory",
  description:
    "Persist or recall project-scoped memories from .ai-firewall/memory/. " +
    "Use operation:'save' to store a new entry (with name + type + description + content) " +
    "and operation:'read' to retrieve the index or search by query. " +
    "Memories survive across sessions and feed back into future agent context.",
  readonly: false,
  isBuiltIn: true,
  parameters: {
    type: "object",
    required: ["operation"],
    properties: {
      operation: {
        type: "string",
        description:
          "Either 'save' to write a new memory or 'read' to retrieve memories.",
      },
      name: {
        type: "string",
        description:
          "(save) Short identifier for the memory; used as the filename slug.",
      },
      type: {
        type: "string",
        description:
          "(save) One of 'user' | 'feedback' | 'project' | 'reference'.",
      },
      description: {
        type: "string",
        description:
          "(save) One-line summary; helps future you decide if this memory is relevant.",
      },
      content: {
        type: "string",
        description: "(save) The memory body in markdown.",
      },
      query: {
        type: "string",
        description:
          "(read) Optional substring to match against memory contents and filenames. " +
          "Omit to receive the MEMORY.md index instead.",
      },
    },
  },
  preprocess: async (args: MemoryArgs) => {
    if (args.operation === "save") {
      return {
        args,
        preview: [
          {
            type: "text",
            content: `Will save memory "${args.name}" (type: ${args.type})`,
          },
        ],
      };
    }
    return {
      args,
      preview: [
        {
          type: "text",
          content: args.query
            ? `Will search memories for "${args.query}"`
            : "Will read the MEMORY.md index",
        },
      ],
    };
  },
  run: async (args: MemoryArgs) => {
    const cwd = process.cwd();
    if (args.operation === "save") {
      return saveMemory(args, cwd);
    }
    if (args.operation === "read") {
      return readMemory(args, cwd);
    }
    return `Unknown operation. Use 'save' or 'read'.`;
  },
};
