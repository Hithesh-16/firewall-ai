/**
 * Helper used by every "include this file in chat context" code path —
 * @file, @open, @currentFile, etc. — to route the file through the
 * AI Firewall proxy scan and produce the inline "AI Firewall" report
 * ContextItem the chat renders next to the file content.
 *
 * Centralised here so context providers and tools share the exact
 * same scan UX. Don't duplicate the scan/format logic in providers.
 */

import type { ContextItem } from "../index.js";
import { scanFileViaProxy } from "./fileScanProxy.js";
import {
  formatScanFindingsMarkdown,
  formatScanFindingsSummary,
} from "./formatScanFindings.js";

export interface ContextScanResult {
  /**
   * Content the caller should embed in the LLM context. Falls back to
   * the original content when the proxy is unreachable or the scan is
   * ALLOW with no findings.
   */
  content: string;
  /**
   * Optional second context item carrying the human-readable scan
   * report. Undefined when the scan was silent (ALLOW + no findings).
   */
  reportItem?: ContextItem;
  /**
   * The raw decision so callers can short-circuit on BLOCK if they
   * want to (most context providers prefer to render the report
   * inline rather than throw, since a thrown error breaks the chat).
   */
  action: "ALLOW" | "BLOCK" | "REDACT";
}

/**
 * Scan a file via the proxy and produce the matching report card.
 *
 * On BLOCK we return a stub message so the LLM never sees the file
 * content, plus the report card with file/line breakdowns.
 * On REDACT we substitute the proxy's sanitized content and append
 * the report card.
 * On ALLOW we return the original content; the report card is only
 * attached when there are non-blocking findings worth surfacing.
 */
export async function scanFileForContext(
  filePath: string,
  rawContent: string,
  fetchFn: typeof fetch | undefined,
): Promise<ContextScanResult> {
  const decision = await scanFileViaProxy(filePath, fetchFn);
  const findings = decision.findings ?? [];

  if (decision.action === "BLOCK") {
    return {
      content: `[AI Firewall blocked this file — risk ${decision.riskScore}: ${decision.reasons.join("; ")}]`,
      reportItem: buildReport(filePath, "BLOCK", decision.riskScore, findings),
      action: "BLOCK",
    };
  }

  const content =
    decision.action === "REDACT" && decision.redactedContent
      ? decision.redactedContent
      : rawContent;

  if (decision.action === "ALLOW" && findings.length === 0) {
    return { content, action: "ALLOW" };
  }

  return {
    content,
    reportItem: buildReport(
      filePath,
      decision.action,
      decision.riskScore,
      findings,
    ),
    action: decision.action,
  };
}

function buildReport(
  filePath: string,
  action: "ALLOW" | "BLOCK" | "REDACT",
  riskScore: number,
  findings: NonNullable<
    Awaited<ReturnType<typeof scanFileViaProxy>>["findings"]
  >,
): ContextItem {
  return {
    name: "AI Firewall",
    description: formatScanFindingsSummary(action, findings),
    content: formatScanFindingsMarkdown(filePath, action, riskScore, findings),
    icon: "shield",
  };
}
