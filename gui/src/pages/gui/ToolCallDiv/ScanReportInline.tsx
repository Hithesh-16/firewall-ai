import { ContextItem, ToolCallState } from "core";
import { useMemo } from "react";
import StyledMarkdownPreview from "../../../components/StyledMarkdownPreview";

export const SCAN_REPORT_ITEM_NAME = "AI Firewall";

/**
 * Pull the AI Firewall scan report ContextItem (added by the read-file
 * tools and context providers via core/util/scanFileForContext.ts) out
 * of a tool call's output array so the parent renderer can show it as
 * a permanent inline banner and exclude it from the togglable list.
 */
export function getScanReportItem(
  toolCallState: ToolCallState | undefined,
): ContextItem | undefined {
  if (!toolCallState?.output) return undefined;
  return toolCallState.output.find(
    (item) => item.name === SCAN_REPORT_ITEM_NAME,
  );
}

/**
 * Filter the AI Firewall report out of the tool call's visible output
 * items. Use this in renderers that want to keep the "single item ->
 * clickable, multiple -> toggleable" UX without the scan card flipping
 * a tool result with one real item into multi-item mode.
 */
export function filterOutScanReport(
  items: ContextItem[] | undefined,
): ContextItem[] {
  if (!items) return [];
  return items.filter((item) => item.name !== SCAN_REPORT_ITEM_NAME);
}

interface ScanReportInlineProps {
  toolCallState: ToolCallState | undefined;
}

/**
 * Inline scan report banner. Renders the markdown report produced by
 * `formatScanFindingsMarkdown` as a permanent (non-collapsed) panel
 * underneath the tool call header, so file:line:column findings are
 * visible without the user having to expand a dropdown.
 *
 * Returns null when the tool call has no scan report — clean reads
 * stay quiet, only REDACT/BLOCK and non-empty findings show the card.
 */
export function ScanReportInline({ toolCallState }: ScanReportInlineProps) {
  const item = useMemo(() => getScanReportItem(toolCallState), [toolCallState]);
  if (!item) return null;
  return (
    <div className="border-warning/40 bg-warning/5 mx-2 my-1 rounded-md border px-3 py-2">
      <StyledMarkdownPreview
        source={item.content}
        isRenderingInStepContainer={true}
      />
    </div>
  );
}
