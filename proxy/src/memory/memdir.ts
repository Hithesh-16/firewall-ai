/**
 * Memory Directory (memdir)
 *
 * File-based persistent memory system.  Each project gets a memory directory
 * at `<dataDir>/projects/<slug>/memory/`.  Inside that directory:
 *
 *   MEMORY.md           — index file (one line per memory, max 200 lines)
 *   user_role.md        — individual memory file with frontmatter
 *   feedback_testing.md — another memory file
 *   ...
 *
 * The proxy exposes CRUD via memoryService.ts → memory.route.ts.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {
  ENTRYPOINT_NAME,
  MAX_MEMORY_FILE_BYTES,
  type MemoryEntry,
  type MemoryFrontmatter,
  type MemoryIndex,
  type MemoryIndexEntry,
  parseFrontmatter,
  serializeFrontmatter,
  parseIndexLine,
  formatIndexLine,
  truncateEntrypoint,
} from "./memoryTypes";
import { env } from "../config";

// ── Path resolution ────────────────────────────────────────────

function sanitizeSlug(projectPath: string): string {
  return projectPath
    .replace(/[^a-zA-Z0-9_\-./]/g, "-")
    .replace(/\//g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100);
}

export function getMemoryDir(projectPath: string): string {
  // Derive data directory from DB_PATH (e.g. ./data/firewall.db → ./data/)
  const dataDir = path.dirname(path.resolve(process.cwd(), env.DB_PATH));
  const slug = sanitizeSlug(projectPath);
  return path.join(dataDir, "projects", slug, "memory");
}

function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

// ── Index (MEMORY.md) ──────────────────────────────────────────

export function readIndex(projectPath: string): MemoryIndex {
  const dir = getMemoryDir(projectPath);
  const indexPath = path.join(dir, ENTRYPOINT_NAME);

  if (!fs.existsSync(indexPath)) {
    return {
      content: "",
      lineCount: 0,
      byteCount: 0,
      wasTruncated: false,
      entries: [],
    };
  }

  const raw = fs.readFileSync(indexPath, "utf8");
  const truncated = truncateEntrypoint(raw);
  const entries: MemoryIndexEntry[] = [];

  for (const line of truncated.content.split("\n")) {
    const entry = parseIndexLine(line);
    if (entry) entries.push(entry);
  }

  return {
    content: truncated.content,
    lineCount: truncated.lineCount,
    byteCount: truncated.byteCount,
    wasTruncated: truncated.wasLineTruncated || truncated.wasByteTruncated,
    entries,
  };
}

export function writeIndex(projectPath: string, content: string): void {
  const dir = getMemoryDir(projectPath);
  ensureDir(dir);
  fs.writeFileSync(path.join(dir, ENTRYPOINT_NAME), content, "utf8");
}

export function addIndexEntry(
  projectPath: string,
  entry: MemoryIndexEntry,
): void {
  const index = readIndex(projectPath);
  // Avoid duplicate filenames
  const existing = index.entries.find((e) => e.fileName === entry.fileName);
  if (existing) {
    // Replace the line
    const lines = index.content.split("\n").map((line) => {
      const parsed = parseIndexLine(line);
      if (parsed && parsed.fileName === entry.fileName) {
        return formatIndexLine(entry);
      }
      return line;
    });
    writeIndex(projectPath, lines.join("\n"));
  } else {
    const newLine = formatIndexLine(entry);
    const newContent = index.content ? `${index.content}\n${newLine}` : newLine;
    writeIndex(projectPath, newContent);
  }
}

export function removeIndexEntry(projectPath: string, fileName: string): void {
  const index = readIndex(projectPath);
  const lines = index.content.split("\n").filter((line) => {
    const parsed = parseIndexLine(line);
    return !parsed || parsed.fileName !== fileName;
  });
  writeIndex(projectPath, lines.join("\n"));
}

// ── Memory files ───────────────────────────────────────────────

export function listMemoryFiles(projectPath: string): MemoryEntry[] {
  const dir = getMemoryDir(projectPath);
  if (!fs.existsSync(dir)) return [];

  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md") && f !== ENTRYPOINT_NAME);

  const entries: MemoryEntry[] = [];
  for (const fileName of files) {
    const entry = readMemoryFile(projectPath, fileName);
    if (entry) entries.push(entry);
  }

  return entries.sort((a, b) => b.updatedAt - a.updatedAt);
}

export function readMemoryFile(
  projectPath: string,
  fileName: string,
): MemoryEntry | null {
  const dir = getMemoryDir(projectPath);
  const filePath = path.join(dir, fileName);

  if (!fs.existsSync(filePath)) return null;

  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = parseFrontmatter(raw);
  if (!parsed) return null;

  const stat = fs.statSync(filePath);

  return {
    fileName,
    filePath,
    frontmatter: parsed.frontmatter,
    body: parsed.body,
    createdAt: stat.birthtimeMs,
    updatedAt: stat.mtimeMs,
    sizeBytes: stat.size,
  };
}

export function writeMemoryFile(
  projectPath: string,
  fileName: string,
  frontmatter: MemoryFrontmatter,
  body: string,
): MemoryEntry {
  const dir = getMemoryDir(projectPath);
  ensureDir(dir);

  const content = serializeFrontmatter(frontmatter, body);
  const sizeBytes = Buffer.byteLength(content, "utf8");

  if (sizeBytes > MAX_MEMORY_FILE_BYTES) {
    throw new Error(
      `Memory file too large: ${sizeBytes} bytes (max ${MAX_MEMORY_FILE_BYTES})`,
    );
  }

  const filePath = path.join(dir, fileName);
  fs.writeFileSync(filePath, content, "utf8");

  const stat = fs.statSync(filePath);

  return {
    fileName,
    filePath,
    frontmatter,
    body,
    createdAt: stat.birthtimeMs,
    updatedAt: stat.mtimeMs,
    sizeBytes: stat.size,
  };
}

export function deleteMemoryFile(
  projectPath: string,
  fileName: string,
): boolean {
  const dir = getMemoryDir(projectPath);
  const filePath = path.join(dir, fileName);

  if (!fs.existsSync(filePath)) return false;
  if (fileName === ENTRYPOINT_NAME) return false; // Never delete index

  fs.unlinkSync(filePath);
  return true;
}

// ── Filename generation ────────────────────────────────────────

export function generateFileName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 60);

  const suffix = crypto.randomBytes(3).toString("hex");
  return `${slug}_${suffix}.md`;
}
