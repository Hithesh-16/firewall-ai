/**
 * Hybrid Reducer (Orchestrator)
 *
 * Combines grep + window + strip into a multi-stage context reduction pipeline.
 * Each stage is independent (SRP) — this module only orchestrates them.
 *
 * Pipeline:
 *   1. grep: Find lines matching query keywords
 *   2. window: Expand matches to N-line context windows
 *   3. strip: Remove comments, blanks, duplicates
 *   4. budget: Trim to maxTokens if specified
 *
 * SOLID:
 * - SRP: Only orchestrates stages. No search/strip logic.
 * - OCP: New stages added to pipeline without changing this module.
 * - DIP: Depends on stage interfaces (grepLines, buildWindows, stripAll), not implementations.
 */

import { grepLineNumbers } from "./grepReducer";
import { buildWindows, extractWindows } from "./windowReducer";
import { stripAll } from "./commentStripper";
import { estimateTokensFallback } from "../gateway/tokenCounter";
import type { ReducerResult, ReducerOptions } from "./types";

const DEFAULT_WINDOW_SIZE = 15;
const DEFAULT_MAX_TOKENS = 4000;

/**
 * Run the full reduction pipeline on content.
 *
 * @param content - Full file/context content
 * @param options - Reduction options (query, maxTokens, windowSize, strip flags)
 * @returns Reduced content with savings metrics
 */
export function reduce(content: string, options: ReducerOptions = {}): ReducerResult {
  const originalTokens = estimateTokensFallback(content);
  const strategies: string[] = [];
  let reduced = content;

  const totalLines = content.split("\n").length;

  // Stage 1: Grep — find relevant regions
  if (options.query && options.query.trim()) {
    const matchedLines = grepLineNumbers(content, options.query);

    if (matchedLines.length > 0) {
      // Stage 2: Window — expand to context
      const windowSize = options.windowSize ?? DEFAULT_WINDOW_SIZE;
      const windows = buildWindows(totalLines, matchedLines, windowSize);
      reduced = extractWindows(content, windows);
      strategies.push(`grep(${matchedLines.length} matches)`);
      strategies.push(`window(±${windowSize} lines, ${windows.length} regions)`);
    } else {
      // No matches — fall through to strip-only (don't return empty)
      strategies.push("grep(0 matches, using full content)");
    }
  }

  // Stage 3: Strip — remove noise
  const shouldStrip =
    options.stripComments !== false ||
    options.stripBlanks !== false ||
    options.stripDuplicates !== false;

  if (shouldStrip) {
    const beforeStrip = reduced;
    reduced = stripAll(reduced, {
      comments: options.stripComments,
      blanks: options.stripBlanks,
      duplicates: options.stripDuplicates,
      language: options.language,
    });

    if (reduced.length < beforeStrip.length) {
      strategies.push("strip(comments+blanks+dupes)");
    }
  }

  // Stage 4: Budget trim — hard limit on tokens
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  const currentTokens = estimateTokensFallback(reduced);

  if (currentTokens > maxTokens) {
    // Trim from the end (keep the most relevant beginning)
    const targetChars = maxTokens * 4; // Rough: 4 chars per token
    reduced = reduced.slice(0, targetChars);

    // Find last complete line
    const lastNewline = reduced.lastIndexOf("\n");
    if (lastNewline > targetChars * 0.8) {
      reduced = reduced.slice(0, lastNewline);
    }
    reduced += "\n... (truncated to fit token budget)";
    strategies.push(`budget(trimmed to ~${maxTokens} tokens)`);
  }

  const reducedTokens = estimateTokensFallback(reduced);
  const linesKept = reduced.split("\n").length;

  return {
    content: reduced,
    originalTokens,
    reducedTokens,
    savingsPercent:
      originalTokens > 0
        ? Math.round(((originalTokens - reducedTokens) / originalTokens) * 100)
        : 0,
    strategies,
    linesKept,
    linesRemoved: totalLines - linesKept,
  };
}
