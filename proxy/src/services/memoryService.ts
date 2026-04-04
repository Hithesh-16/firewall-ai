/**
 * Memory Service
 *
 * High-level API for memory operations.  Consumed by memory.route.ts.
 * Delegates file I/O to memdir.ts and extraction to memoryExtractor.ts.
 */

import {
  readIndex,
  writeIndex,
  listMemoryFiles,
  readMemoryFile,
  writeMemoryFile,
  deleteMemoryFile,
  addIndexEntry,
  removeIndexEntry,
  generateFileName,
  getMemoryDir,
} from "../memory/memdir";
import { extractAndSave } from "../memory/memoryExtractor";
import type {
  MemoryEntry,
  MemoryFrontmatter,
  MemoryIndex,
  MemoryType,
} from "../memory/memoryTypes";

// ── Index ──────────────────────────────────────────────────────

export function getMemoryIndex(projectPath: string): MemoryIndex {
  return readIndex(projectPath);
}

export function updateMemoryIndex(projectPath: string, content: string): void {
  writeIndex(projectPath, content);
}

// ── List / Read ────────────────────────────────────────────────

export function listMemories(
  projectPath: string,
  typeFilter?: MemoryType,
): MemoryEntry[] {
  const all = listMemoryFiles(projectPath);
  if (!typeFilter) return all;
  return all.filter((e) => e.frontmatter.type === typeFilter);
}

export function getMemory(
  projectPath: string,
  fileName: string,
): MemoryEntry | null {
  return readMemoryFile(projectPath, fileName);
}

// ── Create / Update ────────────────────────────────────────────

export interface SaveMemoryInput {
  readonly name: string;
  readonly description: string;
  readonly type: MemoryType;
  readonly body: string;
  readonly fileName?: string;
}

export function saveMemory(
  projectPath: string,
  input: SaveMemoryInput,
): MemoryEntry {
  const fileName = input.fileName ?? generateFileName(input.name);

  const frontmatter: MemoryFrontmatter = {
    name: input.name,
    description: input.description,
    type: input.type,
  };

  const entry = writeMemoryFile(projectPath, fileName, frontmatter, input.body);

  // Update index
  addIndexEntry(projectPath, {
    title: input.name,
    fileName,
    hook: input.description.slice(0, 120),
  });

  return entry;
}

// ── Delete ─────────────────────────────────────────────────────

export function removeMemory(projectPath: string, fileName: string): boolean {
  const deleted = deleteMemoryFile(projectPath, fileName);
  if (deleted) {
    removeIndexEntry(projectPath, fileName);
  }
  return deleted;
}

// ── Extraction ─────────────────────────────────────────────────

export function extractMemories(
  projectPath: string,
  conversationText: string,
): string[] {
  return extractAndSave(projectPath, conversationText);
}

// ── Utility ────────────────────────────────────────────────────

export function getMemoryDirPath(projectPath: string): string {
  return getMemoryDir(projectPath);
}
