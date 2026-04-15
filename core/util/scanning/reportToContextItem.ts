/**
 * Convert a scan report into the "AI Firewall" ContextItem the chat
 * renders next to file content.
 *
 * Kept separate from the decorator so the core turn handler can
 * subscribe, dedupe, and format without the decorator having to
 * know about ContextItem — strict DIP.
 */

import type { ContextItem } from "../../index.js";
import {
  formatScanFindingsMarkdown,
  formatScanFindingsSummary,
} from "../formatScanFindings.js";
import type { ScanReport } from "./FileBlockedByScanError.js";

export function reportToContextItem(report: ScanReport): ContextItem {
  return {
    name: "AI Firewall",
    description: formatScanFindingsSummary(report.action, [...report.findings]),
    content: formatScanFindingsMarkdown(
      report.filePath,
      report.action,
      report.riskScore,
      [...report.findings],
    ),
    icon: "shield",
  };
}
