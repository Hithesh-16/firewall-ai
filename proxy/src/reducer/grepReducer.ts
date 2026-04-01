/**
 * Grep Reducer
 *
 * Finds lines matching keywords/patterns in content.
 * Returns line numbers of matches for the window reducer to expand.
 *
 * SOLID:
 * - SRP: Only finds matching line numbers. No extraction, no trimming.
 * - OCP: New match strategies (regex, fuzzy) added without changing interface.
 */

export interface GrepMatch {
  lineNumber: number;
  line: string;
  keyword: string;
}

/**
 * Find all lines containing any of the query keywords.
 * Splits query on whitespace and commas. Case-insensitive.
 *
 * @param content - Full file content
 * @param query - Space/comma separated keywords (e.g. "login auth password")
 * @returns Array of matching lines with their line numbers
 */
export function grepLines(content: string, query: string): GrepMatch[] {
  if (!query || !query.trim()) return [];

  const keywords = query
    .split(/[\s,]+/)
    .map((k) => k.trim().toLowerCase())
    .filter((k) => k.length > 0);

  if (keywords.length === 0) return [];

  const lines = content.split("\n");
  const matches: GrepMatch[] = [];
  const seen = new Set<number>();

  for (let i = 0; i < lines.length; i++) {
    const lower = lines[i].toLowerCase();
    for (const keyword of keywords) {
      if (lower.includes(keyword) && !seen.has(i)) {
        matches.push({
          lineNumber: i,
          line: lines[i],
          keyword,
        });
        seen.add(i);
        break; // One match per line is enough
      }
    }
  }

  return matches;
}

/**
 * Extract unique matching line numbers (sorted).
 */
export function grepLineNumbers(content: string, query: string): number[] {
  return grepLines(content, query).map((m) => m.lineNumber);
}
