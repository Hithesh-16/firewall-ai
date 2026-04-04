/**
 * Memory Extractor
 *
 * Analyses conversation text and extracts important information into typed
 * memory files.  This is called after significant conversations to persist
 * learnings for future sessions.
 *
 * Extraction rules (matching claude-code's taxonomy):
 *   - user:      role, preferences, knowledge level
 *   - feedback:  corrections ("don't do X") and confirmations ("yes, that works")
 *   - project:   goals, deadlines, initiatives (relative dates → absolute)
 *   - reference: pointers to external systems (Linear, Slack, Grafana, etc.)
 *
 * Content that should NOT be saved:
 *   - Code patterns derivable from reading the project
 *   - Git history or recent changes
 *   - Debugging solutions (the fix is in the code)
 *   - Ephemeral task details
 */

import {
  type MemoryType,
  type MemoryFrontmatter,
  MEMORY_TYPES,
} from "./memoryTypes";
import {
  readIndex,
  listMemoryFiles,
  writeMemoryFile,
  addIndexEntry,
  generateFileName,
} from "./memdir";

// ── Extraction hints ───────────────────────────────────────────

interface ExtractionCandidate {
  readonly type: MemoryType;
  readonly name: string;
  readonly description: string;
  readonly body: string;
}

/**
 * Keyword-based extraction heuristic.
 *
 * This is a simple rule-based extractor.  A more sophisticated version would
 * use an LLM call (forked agent pattern from claude-code), but this gives us
 * a working baseline without extra token spend.
 */
export function extractCandidates(
  conversationText: string,
  existingMemoryNames: readonly string[],
): ExtractionCandidate[] {
  const candidates: ExtractionCandidate[] = [];
  const lines = conversationText.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length < 10) continue;

    const candidate = matchCandidate(trimmed);
    if (!candidate) continue;

    // Skip if a memory with a similar name already exists (bidirectional check)
    const candidateLower = candidate.name.toLowerCase();
    const isDuplicate = existingMemoryNames.some((name) => {
      const existingLower = name.toLowerCase();
      return (
        existingLower.includes(candidateLower) ||
        candidateLower.includes(existingLower)
      );
    });
    if (isDuplicate) continue;

    candidates.push(candidate);
  }

  return candidates;
}

function matchCandidate(text: string): ExtractionCandidate | null {
  const lower = text.toLowerCase();

  // Feedback patterns
  if (matchesFeedbackPattern(lower)) {
    return {
      type: "feedback",
      name: extractShortName(text, 60),
      description: text.slice(0, 120),
      body: buildFeedbackBody(text),
    };
  }

  // User role patterns
  if (matchesUserPattern(lower)) {
    return {
      type: "user",
      name: extractShortName(text, 60),
      description: text.slice(0, 120),
      body: text,
    };
  }

  // Project patterns
  if (matchesProjectPattern(lower)) {
    return {
      type: "project",
      name: extractShortName(text, 60),
      description: text.slice(0, 120),
      body: text,
    };
  }

  // Reference patterns
  if (matchesReferencePattern(lower)) {
    return {
      type: "reference",
      name: extractShortName(text, 60),
      description: text.slice(0, 120),
      body: text,
    };
  }

  return null;
}

// ── Pattern matchers ───────────────────────────────────────────

const FEEDBACK_PATTERNS = [
  /don'?t\s+(do|use|add|make|create|put)/,
  /stop\s+(doing|adding|using)/,
  /never\s+(do|use|add)/,
  /always\s+(use|prefer|do)/,
  /no,?\s+not\s+that/,
  /please\s+don'?t/,
  /instead\s+of\s+that/,
  /that'?s?\s+(correct|right|perfect|exactly|great)/,
  /yes,?\s+(exactly|perfect|that'?s?\s+it)/,
  /keep\s+doing\s+(that|this)/,
];

function matchesFeedbackPattern(text: string): boolean {
  return FEEDBACK_PATTERNS.some((re) => re.test(text));
}

const USER_PATTERNS = [
  /i'?m\s+a\s+(senior|junior|staff|lead|principal)?\s*(developer|engineer|designer|scientist|manager)/,
  /i\s+(work|specialize)\s+(on|in|with)\s/,
  /my\s+(role|job|responsibility)\s+(is|involves)/,
  /i\s+prefer\s+(to|using|working)/,
  /i'?ve\s+been\s+(writing|using|working)/,
];

function matchesUserPattern(text: string): boolean {
  return USER_PATTERNS.some((re) => re.test(text));
}

const PROJECT_PATTERNS = [
  /deadline\s+(is|by|on)\s/,
  /freeze\s+(starts?|begins?|after)/,
  /release\s+(is|on|by|cutting)/,
  /sprint\s+(ends?|starts?|goal)/,
  /we'?re\s+(migrating|ripping|replacing|removing|adding|building)/,
  /the\s+reason\s+(we'?re|for|behind)/,
];

function matchesProjectPattern(text: string): boolean {
  return PROJECT_PATTERNS.some((re) => re.test(text));
}

const REFERENCE_PATTERNS = [
  /tracked\s+in\s+(linear|jira|notion|github|gitlab|trello)/,
  /grafana\s+(board|dashboard|at)/,
  /slack\s+(channel|#)/,
  /confluence\s+(page|at)/,
  /(wiki|docs)\s+(at|is|are)\s/,
  /check\s+(the|our)\s+\w+\s+(board|dashboard|project|channel)/,
];

function matchesReferencePattern(text: string): boolean {
  return REFERENCE_PATTERNS.some((re) => re.test(text));
}

// ── Helpers ────────────────────────────────────────────────────

function extractShortName(text: string, maxLen: number): string {
  const cleaned = text
    .replace(/[^\w\s-]/g, "")
    .trim()
    .slice(0, maxLen);
  return cleaned || "untitled";
}

function buildFeedbackBody(text: string): string {
  return `${text}\n\n**Why:** (extracted from conversation)\n**How to apply:** (follow this guidance in future sessions)`;
}

// ── High-level save function ───────────────────────────────────

export function saveExtractedMemory(
  projectPath: string,
  candidate: ExtractionCandidate,
): string {
  const fileName = generateFileName(candidate.name);

  const frontmatter: MemoryFrontmatter = {
    name: candidate.name,
    description: candidate.description,
    type: candidate.type,
  };

  writeMemoryFile(projectPath, fileName, frontmatter, candidate.body);

  addIndexEntry(projectPath, {
    title: candidate.name,
    fileName,
    hook: candidate.description.slice(0, 120),
  });

  return fileName;
}

/**
 * Run extraction on conversation text and persist any new memories.
 * Returns the list of newly created file names.
 */
export function extractAndSave(
  projectPath: string,
  conversationText: string,
): string[] {
  const existingFiles = listMemoryFiles(projectPath);
  const existingNames = existingFiles.map((f) => f.frontmatter.name);

  const candidates = extractCandidates(conversationText, existingNames);
  const saved: string[] = [];

  for (const candidate of candidates) {
    const fileName = saveExtractedMemory(projectPath, candidate);
    saved.push(fileName);
  }

  return saved;
}
