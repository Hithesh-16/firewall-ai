import { useMemo } from "react";

/**
 * Line-numbered unified diff (kilocode-parity).
 *
 * Accepts before/after strings (the natural shape produced by edit
 * tools) and renders a sequence of added / removed / context lines
 * with old+new line numbers in a sticky gutter. Uses the new
 * diff-add / diff-del / diff-gutter tokens from src/styles/tokens.css
 * so colors track the editor theme.
 *
 * Performance:
 *   - `content-visibility: auto` on the scroll region lets the browser
 *     skip layout for off-screen lines — dramatic on 1000+ line diffs
 *     without actually virtualizing.
 *   - `contain-intrinsic-size` hint keeps the scrollbar stable while
 *     off-screen content is skipped.
 */

export interface UnifiedDiffProps {
  before: string;
  after: string;
  maxHeight?: string;
}

type DiffLine =
  | { kind: "context"; text: string; oldNo: number; newNo: number }
  | { kind: "add"; text: string; newNo: number }
  | { kind: "del"; text: string; oldNo: number };

export function UnifiedDiff({
  before,
  after,
  maxHeight = "480px",
}: UnifiedDiffProps) {
  const lines = useMemo(() => computeUnified(before, after), [before, after]);

  if (lines.length === 0) {
    return (
      <div className="text-description-muted p-3 text-xs italic">
        No changes
      </div>
    );
  }

  return (
    <div
      className="overflow-auto font-mono text-[11px] leading-[1.5]"
      style={{
        maxHeight,
        contentVisibility: "auto" as any,
        containIntrinsicSize: "800px" as any,
      }}
    >
      {lines.map((line, i) => (
        <DiffRow key={i} line={line} />
      ))}
    </div>
  );
}

function DiffRow({ line }: { line: DiffLine }) {
  const bg =
    line.kind === "add"
      ? "bg-diff-add"
      : line.kind === "del"
        ? "bg-diff-del"
        : "";
  const textCol =
    line.kind === "add"
      ? "text-success"
      : line.kind === "del"
        ? "text-error"
        : "text-foreground";

  return (
    <div className={`flex ${bg}`}>
      {/* Sticky gutter — old line number */}
      <span
        className="bg-diff-gutter text-description-muted shrink-0 select-none px-2 text-right tabular-nums"
        style={{ position: "sticky", left: 0, width: "3.5em" }}
      >
        {line.kind === "context" || line.kind === "del" ? line.oldNo : ""}
      </span>
      {/* Sticky gutter — new line number */}
      <span
        className="bg-diff-gutter text-description-muted shrink-0 select-none px-2 text-right tabular-nums"
        style={{ position: "sticky", left: "3.5em", width: "3.5em" }}
      >
        {line.kind === "context" || line.kind === "add" ? line.newNo : ""}
      </span>
      {/* Change marker */}
      <span
        className={`shrink-0 select-none px-1 ${textCol}`}
        style={{ width: "1.5em" }}
        aria-hidden
      >
        {line.kind === "add" ? "+" : line.kind === "del" ? "−" : " "}
      </span>
      <span className={`whitespace-pre pr-4 ${textCol}`}>{line.text}</span>
    </div>
  );
}

/**
 * Compute a unified diff from two buffers.
 *
 * Implementation: naive longest-common-subsequence with O(n·m) dp.
 * Adequate for edit-tool outputs (rarely >2K lines on either side).
 * For very large diffs a Myers / patience implementation would win,
 * but the `content-visibility: auto` in the renderer already makes
 * the render side cheap.
 */
function computeUnified(before: string, after: string): DiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");
  const m = a.length;
  const n = b.length;

  // LCS table
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0),
  );
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (a[i] === b[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
      else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  let oldNo = 1;
  let newNo = 1;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      out.push({ kind: "context", text: a[i], oldNo, newNo });
      i++;
      j++;
      oldNo++;
      newNo++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ kind: "del", text: a[i], oldNo });
      i++;
      oldNo++;
    } else {
      out.push({ kind: "add", text: b[j], newNo });
      j++;
      newNo++;
    }
  }
  while (i < m) {
    out.push({ kind: "del", text: a[i], oldNo });
    i++;
    oldNo++;
  }
  while (j < n) {
    out.push({ kind: "add", text: b[j], newNo });
    j++;
    newNo++;
  }

  return out;
}

/**
 * Count additions + deletions for a before/after pair.
 * Exported so the MultiFileDiffPanel can derive per-file stats from
 * raw strings without building the whole DiffLine array twice.
 */
export function countChanges(
  before: string,
  after: string,
): { additions: number; deletions: number } {
  const lines = computeUnified(before, after);
  let additions = 0;
  let deletions = 0;
  for (const line of lines) {
    if (line.kind === "add") additions++;
    else if (line.kind === "del") deletions++;
  }
  return { additions, deletions };
}
