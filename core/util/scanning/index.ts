/**
 * Barrel for the central file-scanning chokepoint.
 *
 * The `ScanningIde` decorator (coming in Step 2) and the CLI
 * `ScanningFileIo` shim (Step 8) both import from here. Callers
 * should never reach into individual files — keeps the module
 * surface area small and swappable.
 */
export {
  DEFAULT_SCAN_PURPOSE,
  allowsSyncProxy,
  bypassesScan,
  shouldEmitReport,
  type ScanPurpose,
} from "./ScanPurpose.js";

export {
  FileBlockedByScanError,
  isFileBlockedByScanError,
  type ScanReport,
} from "./FileBlockedByScanError.js";

export {
  currentCorrelationId,
  dedupeReports,
  publishScanReport,
  runInScanContext,
  runInScanContextSync,
  subscribeScanReports,
  _resetScanReportChannel,
} from "./scanReportChannel.js";

export {
  getCachedDecision,
  invalidateCachedDecision,
  setCachedDecision,
  _cacheSize,
  _resetScanDecisionCache,
} from "./scanDecisionCache.js";

export {
  wrapWithScanner,
  isScanningIde,
  readFileWith,
  readRangeInFileWith,
  type ScanningIde,
  type ScanningIdeExtras,
} from "./ScanningIde.js";

export { findingInRange, sliceByLines } from "./sliceByLines.js";

export { reportToContextItem } from "./reportToContextItem.js";
