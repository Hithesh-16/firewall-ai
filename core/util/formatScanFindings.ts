/**
 * Format AI Firewall scan findings as a markdown block suitable for
 * embedding into a tool result `ContextItem`. The chat UI renders this
 * inline next to the file content, replacing the old VS Code toast.
 *
 * Single Responsibility: pure formatting. No I/O, no scanning.
 */

import type { FileScanFinding } from "./fileScanProxy.js";

const ACTION_LABELS: Record<string, string> = {
  ALLOW: "Allowed",
  REDACT: "Redacted",
  BLOCK: "Blocked",
};

/**
 * Render a markdown summary that always begins with a one-line header
 * (action + risk + count) followed by a per-finding bullet list.
 *
 * Bullets (not tables) so the output stays readable across every
 * VS Code theme — markdown tables look broken in some dark themes.
 *
 * Output is intentionally compact: one line per finding, monospace
 * file:line:col chip, plain-text type, masked value in backticks.
 */
export function formatScanFindingsMarkdown(
  filePath: string,
  action: "ALLOW" | "BLOCK" | "REDACT",
  riskScore: number,
  findings: FileScanFinding[],
): string {
  const label = ACTION_LABELS[action] ?? action;
  const count = findings.length;
  const noun = count === 1 ? "finding" : "findings";
  const header = `**AI Firewall — ${label}** · risk ${riskScore} · ${count} ${noun}`;
  const subheader = `\`${filePath}\``;

  if (count === 0) {
    return `${header}\n${subheader}`;
  }

  // Show up to 20 findings inline; collapse the rest behind a count.
  // 20 keeps the tool card readable while still surfacing typical
  // bursts of entropy hits.
  const MAX_ROWS = 20;
  const rows = findings.slice(0, MAX_ROWS).map((f) => {
    const loc = `\`${baseName(filePath)}:${f.line}:${f.column}\``;
    const sev = `\`${f.severity.toUpperCase()}\``;
    const type = f.type;
    const value = f.masked ? ` \`${f.masked}\`` : "";
    return `- ${loc} ${sev} ${type}${value}`;
  });

  const overflow =
    findings.length > MAX_ROWS
      ? `\n- _… and ${findings.length - MAX_ROWS} more_`
      : "";

  return `${header}\n${subheader}\n\n${rows.join("\n")}${overflow}`;
}

/**
 * Compact one-line description for the tool card collapsed header.
 * E.g. `Redacted 5 findings — HIGH_ENTROPY×5`
 */
export function formatScanFindingsSummary(
  action: "ALLOW" | "BLOCK" | "REDACT",
  findings: FileScanFinding[],
): string {
  const label = ACTION_LABELS[action] ?? action;
  if (findings.length === 0) return label;

  const counts = new Map<string, number>();
  for (const f of findings) {
    counts.set(f.type, (counts.get(f.type) ?? 0) + 1);
  }
  const topTypes = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([t, n]) => (n > 1 ? `${t}×${n}` : t))
    .join(", ");

  const noun = findings.length === 1 ? "finding" : "findings";
  return `${label} ${findings.length} ${noun} — ${topTypes}`;
}

function baseName(filePath: string): string {
  const idx = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  return idx >= 0 ? filePath.slice(idx + 1) : filePath;
}
