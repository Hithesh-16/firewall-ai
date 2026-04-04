/**
 * Memory Type System
 *
 * Typed memories following claude-code's 4-type taxonomy:
 *   - user:      role, goals, preferences, knowledge
 *   - feedback:  corrections + confirmed approaches
 *   - project:   ongoing work, goals, deadlines
 *   - reference: pointers to external systems
 *
 * Each memory is a markdown file with YAML frontmatter, stored in a
 * project-scoped directory.  MEMORY.md is a hand-maintained index.
 */

// ── Core types ─────────────────────────────────────────────────

export type MemoryType = "user" | "feedback" | "project" | "reference";

export interface MemoryFrontmatter {
  readonly name: string;
  readonly description: string;
  readonly type: MemoryType;
}

export interface MemoryEntry {
  readonly fileName: string;
  readonly filePath: string;
  readonly frontmatter: MemoryFrontmatter;
  readonly body: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly sizeBytes: number;
}

export interface MemoryIndex {
  readonly content: string;
  readonly lineCount: number;
  readonly byteCount: number;
  readonly wasTruncated: boolean;
  readonly entries: readonly MemoryIndexEntry[];
}

export interface MemoryIndexEntry {
  readonly title: string;
  readonly fileName: string;
  readonly hook: string;
}

// ── Constants ──────────────────────────────────────────────────

export const ENTRYPOINT_NAME = "MEMORY.md";
export const MAX_ENTRYPOINT_LINES = 200;
export const MAX_ENTRYPOINT_BYTES = 25_000;
export const MAX_MEMORY_FILE_BYTES = 50_000;

export const MEMORY_TYPES: readonly MemoryType[] = [
  "user",
  "feedback",
  "project",
  "reference",
];

export const MEMORY_TYPE_DESCRIPTIONS: Record<MemoryType, string> = {
  user: "Information about the user's role, goals, responsibilities, and knowledge",
  feedback:
    "Guidance on how to approach work — corrections and confirmed approaches",
  project: "Ongoing work, goals, initiatives, deadlines within the project",
  reference: "Pointers to where information can be found in external systems",
};

// ── Frontmatter parsing ────────────────────────────────────────

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

export function parseFrontmatter(
  raw: string,
): { frontmatter: MemoryFrontmatter; body: string } | null {
  const match = raw.match(FRONTMATTER_RE);
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
  const type = fields.type as MemoryType;

  if (!name || !description || !type) return null;
  if (!MEMORY_TYPES.includes(type)) return null;

  return {
    frontmatter: { name, description, type },
    body: body.trim(),
  };
}

export function serializeFrontmatter(
  frontmatter: MemoryFrontmatter,
  body: string,
): string {
  return [
    "---",
    `name: ${frontmatter.name}`,
    `description: ${frontmatter.description}`,
    `type: ${frontmatter.type}`,
    "---",
    "",
    body,
    "",
  ].join("\n");
}

// ── Index entry parsing ────────────────────────────────────────

const INDEX_LINE_RE = /^- \[([^\]]+)\]\(([^)]+)\)\s*[—–-]\s*(.+)$/;

export function parseIndexLine(line: string): MemoryIndexEntry | null {
  const match = line.match(INDEX_LINE_RE);
  if (!match) return null;
  return {
    title: match[1],
    fileName: match[2],
    hook: match[3].trim(),
  };
}

export function formatIndexLine(entry: MemoryIndexEntry): string {
  return `- [${entry.title}](${entry.fileName}) — ${entry.hook}`;
}

// ── Truncation ─────────────────────────────────────────────────

export interface TruncationResult {
  readonly content: string;
  readonly lineCount: number;
  readonly byteCount: number;
  readonly wasLineTruncated: boolean;
  readonly wasByteTruncated: boolean;
}

export function truncateEntrypoint(raw: string): TruncationResult {
  const lines = raw.split("\n");
  let wasLineTruncated = false;
  let wasByteTruncated = false;

  let truncatedLines = lines;
  if (lines.length > MAX_ENTRYPOINT_LINES) {
    truncatedLines = lines.slice(0, MAX_ENTRYPOINT_LINES);
    wasLineTruncated = true;
  }

  let content = truncatedLines.join("\n");

  if (Buffer.byteLength(content, "utf8") > MAX_ENTRYPOINT_BYTES) {
    // Byte-truncate at last newline boundary
    const buf = Buffer.from(content, "utf8");
    const slice = buf.subarray(0, MAX_ENTRYPOINT_BYTES);
    const str = slice.toString("utf8");
    const lastNewline = str.lastIndexOf("\n");
    content = lastNewline > 0 ? str.slice(0, lastNewline) : str;
    wasByteTruncated = true;
  }

  return {
    content,
    lineCount: content.split("\n").length,
    byteCount: Buffer.byteLength(content, "utf8"),
    wasLineTruncated,
    wasByteTruncated,
  };
}
