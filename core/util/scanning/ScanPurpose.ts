/**
 * ScanPurpose tags every file read/write going through the scanning
 * chokepoint (`ScanningIde` decorator + CLI `ScanningFileIo` shim).
 *
 * The purpose drives:
 *   - whether a proxy round-trip is allowed (hot paths cannot afford it)
 *   - whether a BLOCK can throw (indexing must not abort)
 *   - whether REDACT content is substituted (diffs need byte-exact data)
 *   - whether a report is published to the chat history
 *
 * The default is intentionally `"llm"` so a caller that forgets to
 * tag itself gets the strongest protection.
 */
export type ScanPurpose =
  | "llm"
  | "indexing"
  | "autocomplete"
  | "config"
  | "raw";

export const DEFAULT_SCAN_PURPOSE: ScanPurpose = "llm";

/** True when the purpose should surface a report card in the chat. */
export function shouldEmitReport(purpose: ScanPurpose): boolean {
  return purpose === "llm";
}

/** True when the purpose can tolerate a synchronous proxy round-trip. */
export function allowsSyncProxy(purpose: ScanPurpose): boolean {
  return purpose === "llm" || purpose === "indexing";
}

/** True when the purpose bypasses scanning entirely (config / raw). */
export function bypassesScan(purpose: ScanPurpose): boolean {
  return purpose === "config" || purpose === "raw";
}
