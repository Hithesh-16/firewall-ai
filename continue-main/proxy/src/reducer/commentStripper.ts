/**
 * Comment Stripper
 *
 * Removes comments, blank lines, and duplicate lines from code.
 * Reduces token count without changing code semantics.
 *
 * SOLID:
 * - SRP: Only strips noise. No searching, no windowing.
 * - OCP: New language patterns added to COMMENT_PATTERNS without changing strip logic.
 */

// ── Comment Patterns by Language ───────────────────────────────────────────

interface CommentPattern {
  singleLine: RegExp;
  multiLineStart: RegExp;
  multiLineEnd: RegExp;
}

const COMMENT_PATTERNS: Record<string, CommentPattern> = {
  // C-family: JS, TS, Java, C, C++, C#, Go, Rust, Swift, Kotlin
  default: {
    singleLine: /^\s*\/\//,
    multiLineStart: /\/\*/,
    multiLineEnd: /\*\//,
  },
  python: {
    singleLine: /^\s*#/,
    multiLineStart: /^\s*"""/,
    multiLineEnd: /"""/,
  },
  ruby: {
    singleLine: /^\s*#/,
    multiLineStart: /^=begin/,
    multiLineEnd: /^=end/,
  },
  html: {
    singleLine: /(?!)/, // No single-line comments in HTML
    multiLineStart: /<!--/,
    multiLineEnd: /-->/,
  },
};

/**
 * Detect language from file extension or content hints.
 */
export function detectLanguage(filenameOrHint?: string): string {
  if (!filenameOrHint) return "default";
  const lower = filenameOrHint.toLowerCase();
  if (lower.endsWith(".py") || lower === "python") return "python";
  if (lower.endsWith(".rb") || lower === "ruby") return "ruby";
  if (lower.endsWith(".html") || lower.endsWith(".xml") || lower === "html") return "html";
  return "default";
}

// ── Strip Functions ────────────────────────────────────────────────────────

/**
 * Strip single-line and multi-line comments from code.
 */
export function stripComments(content: string, language?: string): string {
  const lang = detectLanguage(language);
  const patterns = COMMENT_PATTERNS[lang] ?? COMMENT_PATTERNS.default;
  const lines = content.split("\n");
  const result: string[] = [];
  let inMultiLine = false;

  for (const line of lines) {
    if (inMultiLine) {
      if (patterns.multiLineEnd.test(line)) {
        inMultiLine = false;
      }
      continue; // Skip all lines inside multi-line comment
    }

    if (patterns.multiLineStart.test(line)) {
      // Check if multi-line starts and ends on same line
      if (patterns.multiLineEnd.test(line.slice(line.search(patterns.multiLineStart) + 2))) {
        continue; // Single-line block comment like /* ... */
      }
      inMultiLine = true;
      continue;
    }

    if (patterns.singleLine.test(line)) {
      continue; // Skip single-line comment
    }

    result.push(line);
  }

  return result.join("\n");
}

/**
 * Remove blank/whitespace-only lines.
 */
export function stripBlankLines(content: string): string {
  return content
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .join("\n");
}

/**
 * Remove consecutive duplicate lines (keeps first occurrence).
 */
export function stripDuplicateLines(content: string): string {
  const lines = content.split("\n");
  const result: string[] = [];
  let prev = "";

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === prev && trimmed.length > 0) continue;
    result.push(line);
    prev = trimmed;
  }

  return result.join("\n");
}

/**
 * Apply all strip operations.
 */
export function stripAll(
  content: string,
  options: {
    comments?: boolean;
    blanks?: boolean;
    duplicates?: boolean;
    language?: string;
  } = {}
): string {
  let result = content;

  if (options.comments !== false) {
    result = stripComments(result, options.language);
  }
  if (options.blanks !== false) {
    result = stripBlankLines(result);
  }
  if (options.duplicates !== false) {
    result = stripDuplicateLines(result);
  }

  return result;
}
