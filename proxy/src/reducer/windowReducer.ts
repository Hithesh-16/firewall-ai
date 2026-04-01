/**
 * Window Reducer
 *
 * Expands a set of line numbers into context windows (N lines before/after each match).
 * Merges overlapping windows to avoid duplication.
 *
 * SOLID:
 * - SRP: Only builds windows around line numbers. No searching, no trimming.
 * - OCP: Window size configurable without code changes.
 */

const DEFAULT_WINDOW_SIZE = 15; // 15 lines above + below each match

export interface WindowRange {
  start: number;
  end: number;
}

/**
 * Build context windows around matched lines, merging overlaps.
 *
 * @param totalLines - Total number of lines in the file
 * @param matchedLineNumbers - Sorted array of line numbers where matches occurred
 * @param windowSize - Number of lines to include above and below each match
 * @returns Merged, non-overlapping ranges
 */
export function buildWindows(
  totalLines: number,
  matchedLineNumbers: number[],
  windowSize: number = DEFAULT_WINDOW_SIZE
): WindowRange[] {
  if (matchedLineNumbers.length === 0) return [];

  const sorted = [...matchedLineNumbers].sort((a, b) => a - b);
  const ranges: WindowRange[] = [];

  for (const lineNum of sorted) {
    const start = Math.max(0, lineNum - windowSize);
    const end = Math.min(totalLines - 1, lineNum + windowSize);

    // Merge with previous range if overlapping
    if (ranges.length > 0 && start <= ranges[ranges.length - 1].end + 1) {
      ranges[ranges.length - 1].end = Math.max(ranges[ranges.length - 1].end, end);
    } else {
      ranges.push({ start, end });
    }
  }

  return ranges;
}

/**
 * Extract lines from content using window ranges.
 * Inserts "..." separator between non-adjacent windows.
 *
 * @param content - Full file content
 * @param ranges - Merged window ranges from buildWindows()
 * @returns Extracted text with window separators
 */
export function extractWindows(content: string, ranges: WindowRange[]): string {
  if (ranges.length === 0) return "";

  const lines = content.split("\n");
  const parts: string[] = [];

  for (let i = 0; i < ranges.length; i++) {
    const { start, end } = ranges[i];
    const windowLines = lines.slice(start, end + 1);

    // Add line numbers for context
    const numbered = windowLines.map(
      (line, idx) => `${start + idx + 1}| ${line}`
    );

    if (i > 0) {
      parts.push("..."); // Separator between non-adjacent windows
    }
    parts.push(numbered.join("\n"));
  }

  return parts.join("\n");
}
