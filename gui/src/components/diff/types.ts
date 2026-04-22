/**
 * Shared types for the multi-file diff UI.
 *
 * A FileDiff represents a single file-level change produced by an
 * edit tool. `before` / `after` are the full file contents; the
 * UnifiedDiff/SideBySideDiff renderers compute per-line deltas.
 *
 * `additions` / `deletions` are precomputed so the tree + summary
 * header can render counts without paying the LCS cost twice.
 */
export interface FileDiff {
  /** Repo-relative path (e.g. "src/foo.ts"). */
  path: string;
  /** File contents before the edit. Empty string when the file is
   *  newly created. */
  before: string;
  /** File contents after the edit. Empty string when the file is
   *  deleted. */
  after: string;
  /** Number of added lines in this diff. */
  additions: number;
  /** Number of deleted lines in this diff. */
  deletions: number;
}

export type DiffStyle = "unified" | "split";
