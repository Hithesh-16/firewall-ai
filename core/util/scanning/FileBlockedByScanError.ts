import type { FileScanFinding } from "../fileScanProxy.js";

/**
 * Typed error thrown by `ScanningIde` when a file read resolves to
 * `BLOCK` under an enforcement-grade `ScanPurpose` (currently only
 * `"llm"`). The chat layer catches this and either:
 *   - converts to a `ContinueError` with the report inlined (today), or
 *   - triggers the consent-on-BLOCK flow (follow-up PR) that pops a
 *     modal asking "send anyway?" and retries with a `"raw"` override.
 *
 * The decorator never throws for `"indexing"` / `"autocomplete"` /
 * `"config"` — those degrade to empty content or bypass entirely.
 */
export interface ScanReport {
  readonly filePath: string;
  readonly action: "ALLOW" | "REDACT" | "BLOCK";
  readonly riskScore: number;
  readonly reasons: readonly string[];
  readonly findings: readonly FileScanFinding[];
}

export class FileBlockedByScanError extends Error {
  readonly report: ScanReport;

  constructor(report: ScanReport) {
    const summary =
      report.reasons.length > 0
        ? report.reasons.join("; ")
        : `risk ${report.riskScore}`;
    super(`AI Firewall blocked ${report.filePath}: ${summary}`);
    this.name = "FileBlockedByScanError";
    this.report = report;
  }
}

export function isFileBlockedByScanError(
  e: unknown,
): e is FileBlockedByScanError {
  return e instanceof Error && e.name === "FileBlockedByScanError";
}
