/**
 * Slice a text blob by 0-based inclusive line indices.
 *
 * Used by the `ScanningIde` decorator to extract the requested
 * `readRangeInFile` window from a fully-redacted content blob. We
 * slice by whole lines rather than by character offsets because
 * the redactor rewrites in place — character columns may shift
 * when a long secret becomes a short `<REDACTED:X>` token.
 *
 * Line indices match the VS Code / LSP convention for
 * `Range.start.line` and `Range.end.line` (0-based, inclusive on
 * both ends when slicing for a readRangeInFile call).
 */
export function sliceByLines(
  text: string,
  startLine: number,
  endLine: number,
): string {
  if (startLine > endLine) return "";
  const lines = text.split("\n");
  const from = Math.max(0, startLine);
  const to = Math.min(lines.length - 1, endLine);
  if (from > to) return "";
  return lines.slice(from, to + 1).join("\n");
}

/**
 * True when a (1-based) finding line falls inside a (0-based,
 * inclusive) LSP-style range.
 */
export function findingInRange(
  finding: { line: number },
  startLine: number,
  endLine: number,
): boolean {
  const oneBasedStart = startLine + 1;
  const oneBasedEnd = endLine + 1;
  return finding.line >= oneBasedStart && finding.line <= oneBasedEnd;
}
