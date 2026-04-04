/**
 * Memory System Tests
 *
 * Tests frontmatter parsing/serialization, index line parsing, truncation,
 * memory file CRUD, index management, memory extractor patterns, duplicate
 * detection, extractAndSave end-to-end, and edge cases.
 *
 * Uses temporary directories to avoid polluting the real data directory.
 */

import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  parseFrontmatter,
  serializeFrontmatter,
  parseIndexLine,
  formatIndexLine,
  truncateEntrypoint,
  ENTRYPOINT_NAME,
  MAX_ENTRYPOINT_LINES,
  MAX_ENTRYPOINT_BYTES,
  MAX_MEMORY_FILE_BYTES,
  type MemoryFrontmatter,
  type MemoryIndexEntry,
  type MemoryType,
  MEMORY_TYPES,
} from "../memory/memoryTypes";
import {
  getMemoryDir,
  readIndex,
  writeIndex,
  addIndexEntry,
  removeIndexEntry,
  listMemoryFiles,
  readMemoryFile,
  writeMemoryFile,
  deleteMemoryFile,
  generateFileName,
} from "../memory/memdir";
import {
  extractCandidates,
  saveExtractedMemory,
  extractAndSave,
} from "../memory/memoryExtractor";
import {
  listMemories,
  saveMemory,
  removeMemory,
  getMemoryIndex,
  getMemory,
  extractMemories,
} from "../services/memoryService";

// ── Helpers ───────────────────────────────────────────────────

let tmpDirs: string[] = [];

/**
 * Create a unique temp directory and return a fake "project path" that
 * will deterministically map to a subdirectory under it.
 * We monkey-patch getMemoryDir only for the duration of the test by
 * using a unique project path prefix that we control.
 */
function createTempProjectPath(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "af-mem-test-"));
  tmpDirs.push(dir);
  return dir;
}

function cleanupAllTempDirs(): void {
  for (const dir of tmpDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
  tmpDirs = [];
}

/**
 * Write a memory file directly to a temp directory (bypass memdir)
 * for testing read operations.
 */
function writeRawMemoryFile(
  memDir: string,
  fileName: string,
  content: string,
): void {
  fs.mkdirSync(memDir, { recursive: true });
  fs.writeFileSync(path.join(memDir, fileName), content, "utf8");
}

// ── Frontmatter Parsing ──────────────────────────────────────

export function testParseFrontmatterValid() {
  const raw = `---
name: User Role
description: Senior engineer working on backend
type: user
---

I am a senior backend engineer.`;

  const result = parseFrontmatter(raw);
  assert.ok(result !== null, "Should parse valid frontmatter");
  assert.strictEqual(result!.frontmatter.name, "User Role");
  assert.strictEqual(
    result!.frontmatter.description,
    "Senior engineer working on backend",
  );
  assert.strictEqual(result!.frontmatter.type, "user");
  assert.strictEqual(result!.body, "I am a senior backend engineer.");
}

export function testParseFrontmatterAllTypes() {
  for (const type of MEMORY_TYPES) {
    const raw = `---
name: Test ${type}
description: Testing ${type} type
type: ${type}
---

Body for ${type}.`;

    const result = parseFrontmatter(raw);
    assert.ok(result !== null, `Should parse frontmatter for type '${type}'`);
    assert.strictEqual(result!.frontmatter.type, type);
  }
}

export function testParseFrontmatterMissingName() {
  const raw = `---
description: No name here
type: user
---

Body text.`;

  const result = parseFrontmatter(raw);
  assert.strictEqual(result, null, "Should return null when name is missing");
}

export function testParseFrontmatterMissingDescription() {
  const raw = `---
name: Missing Desc
type: feedback
---

Body text.`;

  const result = parseFrontmatter(raw);
  assert.strictEqual(
    result,
    null,
    "Should return null when description is missing",
  );
}

export function testParseFrontmatterMissingType() {
  const raw = `---
name: Missing Type
description: No type field
---

Body text.`;

  const result = parseFrontmatter(raw);
  assert.strictEqual(result, null, "Should return null when type is missing");
}

export function testParseFrontmatterInvalidType() {
  const raw = `---
name: Bad Type
description: Invalid type value
type: unknown_category
---

Body text.`;

  const result = parseFrontmatter(raw);
  assert.strictEqual(result, null, "Should return null for invalid type");
}

export function testParseFrontmatterNoFrontmatter() {
  const raw = "Just plain text without any frontmatter delimiters.";
  const result = parseFrontmatter(raw);
  assert.strictEqual(
    result,
    null,
    "Should return null when no frontmatter exists",
  );
}

export function testParseFrontmatterEmptyBody() {
  const raw = `---
name: Empty Body
description: Has no body content
type: reference
---
`;

  const result = parseFrontmatter(raw);
  assert.ok(result !== null, "Should parse with empty body");
  assert.strictEqual(result!.body, "", "Body should be empty string");
}

// ── Frontmatter Serialization (round-trip) ────────────────────

export function testSerializeFrontmatter() {
  const frontmatter: MemoryFrontmatter = {
    name: "Test Memory",
    description: "A test memory entry",
    type: "feedback",
  };

  const serialized = serializeFrontmatter(frontmatter, "This is the body.");
  assert.ok(
    serialized.startsWith("---\n"),
    "Should start with frontmatter delimiter",
  );
  assert.ok(serialized.includes("name: Test Memory"), "Should contain name");
  assert.ok(serialized.includes("type: feedback"), "Should contain type");
  assert.ok(serialized.includes("This is the body."), "Should contain body");
}

export function testFrontmatterRoundTrip() {
  const original: MemoryFrontmatter = {
    name: "Round Trip Test",
    description: "Testing parse-serialize-parse cycle",
    type: "project",
  };
  const originalBody = "We are migrating from PostgreSQL to CockroachDB.";

  const serialized = serializeFrontmatter(original, originalBody);
  const parsed = parseFrontmatter(serialized);

  assert.ok(parsed !== null, "Round-trip parse should succeed");
  assert.strictEqual(parsed!.frontmatter.name, original.name);
  assert.strictEqual(parsed!.frontmatter.description, original.description);
  assert.strictEqual(parsed!.frontmatter.type, original.type);
  assert.strictEqual(parsed!.body, originalBody);
}

export function testFrontmatterRoundTripMultilineBody() {
  const original: MemoryFrontmatter = {
    name: "Multiline Body",
    description: "Body has multiple lines",
    type: "user",
  };
  const originalBody = "Line one.\n\nLine three.\n\n- Bullet 1\n- Bullet 2";

  const serialized = serializeFrontmatter(original, originalBody);
  const parsed = parseFrontmatter(serialized);

  assert.ok(parsed !== null);
  assert.strictEqual(parsed!.body, originalBody);
}

// ── Index Line Parsing ────────────────────────────────────────

export function testParseIndexLineValid() {
  const line = "- [User Role](user_role_abc123.md) — Senior backend engineer";
  const entry = parseIndexLine(line);

  assert.ok(entry !== null, "Should parse valid index line");
  assert.strictEqual(entry!.title, "User Role");
  assert.strictEqual(entry!.fileName, "user_role_abc123.md");
  assert.strictEqual(entry!.hook, "Senior backend engineer");
}

export function testParseIndexLineWithDash() {
  // The regex supports em-dash, en-dash, and regular dash
  const line = "- [Project Deadline](deadline_ff0011.md) - Release by April";
  const entry = parseIndexLine(line);

  assert.ok(entry !== null, "Should parse with regular dash separator");
  assert.strictEqual(entry!.title, "Project Deadline");
  assert.strictEqual(entry!.hook, "Release by April");
}

export function testParseIndexLineWithEnDash() {
  const line = "- [Testing](test_aabbcc.md) \u2013 Always use vitest";
  const entry = parseIndexLine(line);

  assert.ok(entry !== null, "Should parse with en-dash separator");
  assert.strictEqual(entry!.hook, "Always use vitest");
}

export function testParseIndexLineMalformed() {
  const malformed = [
    "Not a list item",
    "- No brackets here",
    "- [Title only]",
    "- [Title](file.md)", // missing dash + hook
    "[Title](file.md) — hook", // missing leading "- "
    "",
  ];

  for (const line of malformed) {
    const entry = parseIndexLine(line);
    assert.strictEqual(
      entry,
      null,
      `Should return null for malformed: '${line}'`,
    );
  }
}

export function testFormatIndexLine() {
  const entry: MemoryIndexEntry = {
    title: "Coding Style",
    fileName: "feedback_style_abc123.md",
    hook: "Always use immutable updates",
  };

  const formatted = formatIndexLine(entry);
  assert.strictEqual(
    formatted,
    "- [Coding Style](feedback_style_abc123.md) \u2014 Always use immutable updates",
  );
}

export function testFormatAndParseRoundTrip() {
  const entry: MemoryIndexEntry = {
    title: "Database Migration",
    fileName: "project_migration_ff0011.md",
    hook: "Moving from SQLite to PostgreSQL by Q2",
  };

  const formatted = formatIndexLine(entry);
  const parsed = parseIndexLine(formatted);

  assert.ok(parsed !== null);
  assert.strictEqual(parsed!.title, entry.title);
  assert.strictEqual(parsed!.fileName, entry.fileName);
  assert.strictEqual(parsed!.hook, entry.hook);
}

// ── Truncation ────────────────────────────────────────────────

export function testTruncationUnderLimits() {
  const content = "Line 1\nLine 2\nLine 3";
  const result = truncateEntrypoint(content);

  assert.strictEqual(result.wasLineTruncated, false);
  assert.strictEqual(result.wasByteTruncated, false);
  assert.strictEqual(result.lineCount, 3);
  assert.strictEqual(result.content, content);
}

export function testTruncationOverLineLimit() {
  const lines: string[] = [];
  for (let i = 0; i < MAX_ENTRYPOINT_LINES + 50; i++) {
    lines.push(`Line ${i}`);
  }
  const content = lines.join("\n");
  const result = truncateEntrypoint(content);

  assert.strictEqual(result.wasLineTruncated, true);
  assert.strictEqual(result.lineCount, MAX_ENTRYPOINT_LINES);
  assert.ok(result.content.split("\n").length <= MAX_ENTRYPOINT_LINES);
}

export function testTruncationOverByteLimit() {
  // Create content with lines that are within line limit but exceed byte limit
  // Each line is ~200 bytes; 150 lines = 30KB > 25KB limit
  const lines: string[] = [];
  for (let i = 0; i < 150; i++) {
    lines.push("A".repeat(200));
  }
  const content = lines.join("\n");
  assert.ok(
    Buffer.byteLength(content, "utf8") > MAX_ENTRYPOINT_BYTES,
    "Setup: content should exceed byte limit",
  );
  assert.ok(
    lines.length <= MAX_ENTRYPOINT_LINES,
    "Setup: content should be within line limit",
  );

  const result = truncateEntrypoint(content);

  assert.strictEqual(result.wasByteTruncated, true);
  assert.ok(
    result.byteCount <= MAX_ENTRYPOINT_BYTES,
    "Should not exceed byte limit",
  );
}

export function testTruncationEmptyContent() {
  const result = truncateEntrypoint("");
  assert.strictEqual(result.wasLineTruncated, false);
  assert.strictEqual(result.wasByteTruncated, false);
  assert.strictEqual(result.lineCount, 1); // empty string splits to [""]
  assert.strictEqual(result.content, "");
}

// ── Memory file write and read (using memdir directly) ────────

export function testWriteAndReadMemoryFile() {
  const projectPath = createTempProjectPath();
  // Override memory dir to use our temp dir
  const origGetDir = getMemoryDir;

  const frontmatter: MemoryFrontmatter = {
    name: "Test Write Read",
    description: "Testing write and read roundtrip",
    type: "feedback",
  };

  const entry = writeMemoryFile(
    projectPath,
    "test_write_read.md",
    frontmatter,
    "Body content here.",
  );

  assert.strictEqual(entry.fileName, "test_write_read.md");
  assert.strictEqual(entry.frontmatter.name, "Test Write Read");
  assert.strictEqual(entry.frontmatter.type, "feedback");
  assert.strictEqual(entry.body, "Body content here.");
  assert.ok(entry.sizeBytes > 0);

  // Read back
  const read = readMemoryFile(projectPath, "test_write_read.md");
  assert.ok(read !== null, "Should read back the written file");
  assert.strictEqual(read!.frontmatter.name, "Test Write Read");
  assert.strictEqual(read!.body, "Body content here.");
}

export function testReadMemoryFileNotFound() {
  const projectPath = createTempProjectPath();
  const result = readMemoryFile(projectPath, "nonexistent_file.md");
  assert.strictEqual(result, null, "Should return null for nonexistent file");
}

export function testWriteMemoryFileTooLarge() {
  const projectPath = createTempProjectPath();
  const frontmatter: MemoryFrontmatter = {
    name: "Too Large",
    description: "This file is too large",
    type: "user",
  };

  // Body larger than MAX_MEMORY_FILE_BYTES
  const largeBody = "X".repeat(MAX_MEMORY_FILE_BYTES + 1000);

  try {
    writeMemoryFile(projectPath, "too_large.md", frontmatter, largeBody);
    assert.fail("Should throw for oversized file");
  } catch (err: unknown) {
    assert.ok(err instanceof Error);
    assert.ok(
      err.message.includes("too large"),
      `Error should mention 'too large', got: ${err.message}`,
    );
  }
}

// ── Memory file listing with type filter ──────────────────────

export function testListMemoryFilesWithTypeFilter() {
  const projectPath = createTempProjectPath();

  writeMemoryFile(
    projectPath,
    "user_role.md",
    {
      name: "User Role",
      description: "Developer role",
      type: "user",
    },
    "I am a developer.",
  );

  writeMemoryFile(
    projectPath,
    "feedback_style.md",
    {
      name: "Coding Style",
      description: "Use immutable updates",
      type: "feedback",
    },
    "Always use spread.",
  );

  writeMemoryFile(
    projectPath,
    "project_migration.md",
    {
      name: "Migration",
      description: "DB migration",
      type: "project",
    },
    "Migrating to PG.",
  );

  const all = listMemoryFiles(projectPath);
  assert.strictEqual(all.length, 3, "Should list all 3 memory files");

  // Use service layer for type filtering
  const feedbackOnly = listMemories(projectPath, "feedback");
  assert.strictEqual(feedbackOnly.length, 1);
  assert.strictEqual(feedbackOnly[0].frontmatter.type, "feedback");

  const userOnly = listMemories(projectPath, "user");
  assert.strictEqual(userOnly.length, 1);
  assert.strictEqual(userOnly[0].frontmatter.type, "user");
}

export function testListMemoryFilesEmptyDir() {
  const projectPath = createTempProjectPath();
  const files = listMemoryFiles(projectPath);
  assert.strictEqual(
    files.length,
    0,
    "Should return empty array for empty directory",
  );
}

// ── Memory file deletion ──────────────────────────────────────

export function testDeleteMemoryFileExists() {
  const projectPath = createTempProjectPath();

  writeMemoryFile(
    projectPath,
    "to_delete.md",
    {
      name: "Delete Me",
      description: "Will be deleted",
      type: "reference",
    },
    "Temporary content.",
  );

  const deleted = deleteMemoryFile(projectPath, "to_delete.md");
  assert.strictEqual(
    deleted,
    true,
    "Should return true for successful deletion",
  );

  const afterDelete = readMemoryFile(projectPath, "to_delete.md");
  assert.strictEqual(afterDelete, null, "File should no longer exist");
}

export function testDeleteMemoryFileNotFound() {
  const projectPath = createTempProjectPath();
  const deleted = deleteMemoryFile(projectPath, "does_not_exist.md");
  assert.strictEqual(
    deleted,
    false,
    "Should return false for nonexistent file",
  );
}

export function testCannotDeleteMemoryIndex() {
  const projectPath = createTempProjectPath();
  // Write the index file
  writeIndex(projectPath, "- [Test](test.md) \u2014 test hook");

  const deleted = deleteMemoryFile(projectPath, ENTRYPOINT_NAME);
  assert.strictEqual(deleted, false, "Should not allow deleting MEMORY.md");

  const index = readIndex(projectPath);
  assert.ok(index.content.length > 0, "MEMORY.md should still exist");
}

// ── Index management ──────────────────────────────────────────

export function testAddIndexEntry() {
  const projectPath = createTempProjectPath();

  addIndexEntry(projectPath, {
    title: "First Entry",
    fileName: "first_abc123.md",
    hook: "The first memory",
  });

  const index = readIndex(projectPath);
  assert.strictEqual(index.entries.length, 1);
  assert.strictEqual(index.entries[0].title, "First Entry");
  assert.strictEqual(index.entries[0].fileName, "first_abc123.md");
}

export function testAddIndexEntryMultiple() {
  const projectPath = createTempProjectPath();

  addIndexEntry(projectPath, {
    title: "Entry One",
    fileName: "one.md",
    hook: "First",
  });

  addIndexEntry(projectPath, {
    title: "Entry Two",
    fileName: "two.md",
    hook: "Second",
  });

  const index = readIndex(projectPath);
  assert.strictEqual(index.entries.length, 2);
}

export function testUpdateExistingIndexEntry() {
  const projectPath = createTempProjectPath();

  addIndexEntry(projectPath, {
    title: "Original",
    fileName: "entry.md",
    hook: "Original hook",
  });

  // Update the same filename
  addIndexEntry(projectPath, {
    title: "Updated",
    fileName: "entry.md",
    hook: "Updated hook",
  });

  const index = readIndex(projectPath);
  assert.strictEqual(
    index.entries.length,
    1,
    "Should not duplicate, should update",
  );
  assert.strictEqual(index.entries[0].title, "Updated");
  assert.strictEqual(index.entries[0].hook, "Updated hook");
}

export function testRemoveIndexEntry() {
  const projectPath = createTempProjectPath();

  addIndexEntry(projectPath, {
    title: "Keep",
    fileName: "keep.md",
    hook: "Stays",
  });

  addIndexEntry(projectPath, {
    title: "Remove",
    fileName: "remove.md",
    hook: "Goes away",
  });

  removeIndexEntry(projectPath, "remove.md");

  const index = readIndex(projectPath);
  assert.strictEqual(index.entries.length, 1);
  assert.strictEqual(index.entries[0].fileName, "keep.md");
}

export function testReadIndexEmptyProject() {
  const projectPath = createTempProjectPath();
  const index = readIndex(projectPath);

  assert.strictEqual(index.content, "");
  assert.strictEqual(index.lineCount, 0);
  assert.strictEqual(index.entries.length, 0);
  assert.strictEqual(index.wasTruncated, false);
}

// ── Memory Extractor: Feedback patterns ───────────────────────

export function testExtractorFeedbackCorrection() {
  const candidates = extractCandidates(
    "Don't use console.log in production code, use the structured logger instead.",
    [],
  );

  assert.ok(
    candidates.length >= 1,
    "Should extract feedback from correction pattern",
  );
  assert.strictEqual(candidates[0].type, "feedback");
}

export function testExtractorFeedbackNever() {
  const candidates = extractCandidates(
    "Never add any types without justification, use unknown and narrow instead.",
    [],
  );

  assert.ok(
    candidates.length >= 1,
    "Should extract feedback from 'never' pattern",
  );
  assert.strictEqual(candidates[0].type, "feedback");
}

export function testExtractorFeedbackAlways() {
  const candidates = extractCandidates(
    "Always use spread operators for immutable updates in this project.",
    [],
  );

  assert.ok(
    candidates.length >= 1,
    "Should extract feedback from 'always' pattern",
  );
  assert.strictEqual(candidates[0].type, "feedback");
}

export function testExtractorFeedbackConfirmation() {
  const candidates = extractCandidates(
    "That's correct, the proxy should never truncate content automatically.",
    [],
  );

  assert.ok(
    candidates.length >= 1,
    "Should extract feedback from confirmation pattern",
  );
  assert.strictEqual(candidates[0].type, "feedback");
}

export function testExtractorFeedbackKeepDoing() {
  const candidates = extractCandidates(
    "Keep doing that approach with the Zod schemas for validation.",
    [],
  );

  assert.ok(
    candidates.length >= 1,
    "Should extract feedback from 'keep doing' pattern",
  );
  assert.strictEqual(candidates[0].type, "feedback");
}

// ── Memory Extractor: User patterns ───────────────────────────

export function testExtractorUserRoleDetection() {
  const candidates = extractCandidates(
    "I'm a senior engineer working on the backend infrastructure team.",
    [],
  );

  assert.ok(
    candidates.length >= 1,
    "Should extract user info from role declaration",
  );
  assert.strictEqual(candidates[0].type, "user");
}

export function testExtractorUserSpecialization() {
  const candidates = extractCandidates(
    "I work on distributed systems and message queuing infrastructure.",
    [],
  );

  assert.ok(
    candidates.length >= 1,
    "Should extract user info from specialization",
  );
  assert.strictEqual(candidates[0].type, "user");
}

export function testExtractorUserPreference() {
  const candidates = extractCandidates(
    "I prefer using functional programming patterns in my TypeScript code.",
    [],
  );

  assert.ok(candidates.length >= 1, "Should extract user preference");
  assert.strictEqual(candidates[0].type, "user");
}

// ── Memory Extractor: Project patterns ────────────────────────

export function testExtractorProjectDeadline() {
  const candidates = extractCandidates(
    "The deadline is by end of Q2 2026 for the full migration to be complete.",
    [],
  );

  assert.ok(
    candidates.length >= 1,
    "Should extract project info from deadline",
  );
  assert.strictEqual(candidates[0].type, "project");
}

export function testExtractorProjectMigration() {
  const candidates = extractCandidates(
    "We're migrating from Heroku to Kubernetes over the next two months.",
    [],
  );

  assert.ok(
    candidates.length >= 1,
    "Should extract project info from migration",
  );
  assert.strictEqual(candidates[0].type, "project");
}

export function testExtractorProjectRelease() {
  const candidates = extractCandidates(
    "The release is cutting on Friday and we need the security fixes in.",
    [],
  );

  assert.ok(candidates.length >= 1, "Should extract project info from release");
  assert.strictEqual(candidates[0].type, "project");
}

// ── Memory Extractor: Reference patterns ──────────────────────

export function testExtractorReferenceLinear() {
  const candidates = extractCandidates(
    "The feature work is tracked in Linear under the Security epic.",
    [],
  );

  assert.ok(
    candidates.length >= 1,
    "Should extract reference from Linear mention",
  );
  assert.strictEqual(candidates[0].type, "reference");
}

export function testExtractorReferenceSlack() {
  const candidates = extractCandidates(
    "Questions go to Slack channel #backend-team for the migration.",
    [],
  );

  assert.ok(
    candidates.length >= 1,
    "Should extract reference from Slack channel",
  );
  assert.strictEqual(candidates[0].type, "reference");
}

export function testExtractorReferenceGrafana() {
  const candidates = extractCandidates(
    "The Grafana dashboard at grafana.internal shows the latency metrics.",
    [],
  );

  assert.ok(candidates.length >= 1, "Should extract reference from Grafana");
  assert.strictEqual(candidates[0].type, "reference");
}

// ── Memory Extractor: No match ────────────────────────────────

export function testExtractorNoMatchBenignText() {
  const candidates = extractCandidates(
    "Write a function to sort an array.\nThis is just normal code discussion.\nNothing special here.",
    [],
  );

  assert.strictEqual(
    candidates.length,
    0,
    "Benign text should not produce any candidates",
  );
}

export function testExtractorNoMatchShortLines() {
  const candidates = extractCandidates("ok\nyes\nno\nsure\nthanks", []);

  assert.strictEqual(
    candidates.length,
    0,
    "Short lines (<10 chars) should be skipped",
  );
}

// ── Memory Extractor: Duplicate detection ─────────────────────

export function testExtractorSkipsDuplicates() {
  // extractShortName strips non-word chars: "I'm a senior engineer..." → "Im a senior engineer..."
  // Duplicate check: existingName.toLowerCase().includes(candidate.name.toLowerCase())
  // So the existing name must contain the candidate's cleaned name
  const candidates1 = extractCandidates(
    "I'm a senior engineer working on the backend infrastructure.",
    [],
  );
  assert.ok(
    candidates1.length >= 1,
    "Should find at least one candidate without existing names",
  );

  // Now use the actual extracted name as the existing name
  const existingNames = [candidates1[0].name];

  const candidates2 = extractCandidates(
    "I'm a senior engineer working on the backend infrastructure.",
    existingNames,
  );

  assert.strictEqual(
    candidates2.length,
    0,
    "Should skip extraction when an identical name already exists",
  );
}

export function testExtractorAllowsNonDuplicate() {
  const existingNames = ["Database Configuration"];

  const candidates = extractCandidates(
    "I'm a senior developer working on frontend components.",
    existingNames,
  );

  assert.ok(
    candidates.length >= 1,
    "Should extract when existing names are not similar",
  );
}

// ── extractAndSave end-to-end ─────────────────────────────────

export function testExtractAndSaveEndToEnd() {
  const projectPath = createTempProjectPath();

  const conversationText = [
    "Don't use any types without justification, use unknown and narrow instead.",
    "The deadline is by June for the v3 release.",
    "Our monitoring is in Grafana dashboard at monitoring.internal.",
  ].join("\n");

  const savedFiles = extractAndSave(projectPath, conversationText);
  assert.ok(
    savedFiles.length >= 2,
    `Should save at least 2 memories, got ${savedFiles.length}`,
  );

  // Verify files exist and have correct frontmatter
  for (const fileName of savedFiles) {
    const entry = readMemoryFile(projectPath, fileName);
    assert.ok(entry !== null, `Saved file ${fileName} should be readable`);
    assert.ok(
      MEMORY_TYPES.includes(entry!.frontmatter.type),
      `Type should be valid: ${entry!.frontmatter.type}`,
    );
    assert.ok(entry!.frontmatter.name.length > 0, "Name should not be empty");
    assert.ok(entry!.body.length > 0, "Body should not be empty");
  }

  // Verify index was updated
  const index = readIndex(projectPath);
  assert.ok(
    index.entries.length >= 2,
    "Index should have entries for saved memories",
  );
}

export function testExtractAndSaveNoDuplicatesOnSecondRun() {
  const projectPath = createTempProjectPath();

  // Use a text that matches exactly one pattern to make the test deterministic
  const text =
    "Always use spread operators for immutable updates in our codebase.";

  const first = extractAndSave(projectPath, text);
  assert.ok(first.length >= 1, "First run should extract at least one memory");

  // Second run with same text: the saved name should match the candidate name
  const second = extractAndSave(projectPath, text);
  assert.strictEqual(
    second.length,
    0,
    "Second run should skip duplicates because name matches",
  );
}

// ── File name generation ──────────────────────────────────────

export function testGenerateFileNameSlugFormat() {
  const fileName = generateFileName("User Role Information");
  assert.ok(fileName.endsWith(".md"), "Should end with .md");
  assert.ok(
    fileName.startsWith("user_role_information_"),
    "Should be slugified",
  );
  assert.ok(!fileName.includes(" "), "Should not contain spaces");
  assert.ok(!fileName.includes("--"), "Should not have double dashes");
}

export function testGenerateFileNameUniqueness() {
  const names = new Set<string>();
  for (let i = 0; i < 50; i++) {
    names.add(generateFileName("Same Name"));
  }
  assert.strictEqual(
    names.size,
    50,
    "50 generated filenames for same input should all be unique",
  );
}

export function testGenerateFileNameSpecialCharacters() {
  const fileName = generateFileName("Don't use ANY (bad) types! @#$%");
  assert.ok(fileName.endsWith(".md"));
  // Should strip special characters and create a valid slug
  assert.ok(!fileName.includes("@"), "Should strip @");
  assert.ok(!fileName.includes("#"), "Should strip #");
  assert.ok(!fileName.includes("!"), "Should strip !");
}

export function testGenerateFileNameLongInput() {
  const longName = "A".repeat(200);
  const fileName = generateFileName(longName);
  // slug is capped at 60 chars, then _<6 hex>.md = 60 + 1 + 6 + 3 = 70
  assert.ok(
    fileName.length <= 75,
    `Filename should be reasonably bounded, got ${fileName.length}`,
  );
}

export function testGenerateFileNameEmptyInput() {
  const fileName = generateFileName("");
  // Empty slug becomes empty, but suffix is appended
  assert.ok(fileName.endsWith(".md"));
  assert.ok(
    fileName.length > 3,
    "Should still generate a filename with suffix",
  );
}

// ── Service layer: saveMemory ─────────────────────────────────

export function testServiceSaveMemory() {
  const projectPath = createTempProjectPath();

  const entry = saveMemory(projectPath, {
    name: "Service Save Test",
    description: "Testing the service layer save",
    type: "user",
    body: "I am a staff engineer.",
  });

  assert.ok(entry.fileName.endsWith(".md"));
  assert.strictEqual(entry.frontmatter.name, "Service Save Test");
  assert.strictEqual(entry.frontmatter.type, "user");
  assert.strictEqual(entry.body, "I am a staff engineer.");

  // Verify index was updated
  const index = getMemoryIndex(projectPath);
  assert.ok(index.entries.length >= 1, "Index should have the new entry");
  assert.ok(
    index.entries.some((e) => e.title === "Service Save Test"),
    "Index should contain the saved entry's title",
  );
}

export function testServiceSaveMemoryWithExplicitFileName() {
  const projectPath = createTempProjectPath();

  const entry = saveMemory(projectPath, {
    name: "Explicit Name",
    description: "Using a specific filename",
    type: "reference",
    body: "Check Jira board.",
    fileName: "custom_filename.md",
  });

  assert.strictEqual(entry.fileName, "custom_filename.md");

  const read = getMemory(projectPath, "custom_filename.md");
  assert.ok(read !== null);
  assert.strictEqual(read!.frontmatter.name, "Explicit Name");
}

// ── Service layer: removeMemory ───────────────────────────────

export function testServiceRemoveMemory() {
  const projectPath = createTempProjectPath();

  const entry = saveMemory(projectPath, {
    name: "To Remove",
    description: "Will be removed",
    type: "feedback",
    body: "Temporary.",
  });

  const removed = removeMemory(projectPath, entry.fileName);
  assert.strictEqual(removed, true);

  const afterRemove = getMemory(projectPath, entry.fileName);
  assert.strictEqual(afterRemove, null);

  // Index should also be cleaned
  const index = getMemoryIndex(projectPath);
  assert.ok(
    !index.entries.some((e) => e.fileName === entry.fileName),
    "Index should no longer contain the removed entry",
  );
}

// ── Cleanup ───────────────────────────────────────────────────

export function cleanupMemoryTests() {
  cleanupAllTempDirs();

  // Also clean up memory files that memdir.ts wrote to proxy/data/projects/
  // (memdir resolves paths via DB_PATH, not the temp dir)
  try {
    const dataDir = path.dirname(
      path.resolve(process.cwd(), "./data/firewall.db"),
    );
    const projectsDir = path.join(dataDir, "projects");
    if (fs.existsSync(projectsDir)) {
      const entries = fs.readdirSync(projectsDir);
      for (const entry of entries) {
        // Only clean test-generated dirs (var-folders-* pattern)
        if (entry.startsWith("var-folders-")) {
          fs.rmSync(path.join(projectsDir, entry), {
            recursive: true,
            force: true,
          });
        }
      }
    }
  } catch {
    // ignore
  }
}
