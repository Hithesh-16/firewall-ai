/**
 * PDF Compliance Report Generator
 *
 * Generates formatted compliance reports as PDF buffers.
 * Uses the existing generateComplianceSummary() for data,
 * then renders it as a structured PDF document.
 *
 * No external PDF library dependency — generates a minimal HTML-to-text
 * format that can be served as application/pdf via a lightweight renderer,
 * or as a rich HTML report that browsers can "Print to PDF".
 */

import { generateComplianceSummary } from "./exportService";
import { ExportFilter } from "../types";
import { getUsageSummary } from "../gateway/usageService";

interface PdfReportData {
  title: string;
  generatedAt: string;
  period: { start: string; end: string };
  summary: Record<string, unknown>;
  compliance: Record<string, unknown>;
  usage: Record<string, unknown>;
}

/**
 * Generate a compliance report as a printable HTML document.
 * Clients can render this in an iframe and use window.print() for PDF output,
 * or the proxy can pipe it through a headless renderer if available.
 */
export function generateComplianceReportHtml(filter: ExportFilter): string {
  const report = generateComplianceSummary(filter) as any;
  const usage = getUsageSummary(undefined, filter.startDate, filter.endDate);

  const startDate = filter.startDate
    ? new Date(filter.startDate).toISOString().split("T")[0]
    : "all time";
  const endDate = filter.endDate
    ? new Date(filter.endDate).toISOString().split("T")[0]
    : "now";

  const summary = report.summary ?? {};
  const compliance = report.compliance ?? {};

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>AI Firewall Compliance Report</title>
  <style>
    @media print { body { margin: 0; } .no-print { display: none; } }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #1a1a2e; background: #fff; padding: 40px; line-height: 1.6; }
    .header { display: flex; align-items: center; gap: 16px; margin-bottom: 32px; padding-bottom: 16px; border-bottom: 2px solid #e2e8f0; }
    .logo { width: 48px; height: 48px; background: #059669; border-radius: 12px; display: flex; align-items: center; justify-content: center; color: #fff; font-weight: bold; font-size: 18px; }
    .title { font-size: 24px; font-weight: 700; }
    .subtitle { font-size: 13px; color: #64748b; }
    .section { margin-bottom: 28px; }
    .section-title { font-size: 16px; font-weight: 600; margin-bottom: 12px; padding-bottom: 6px; border-bottom: 1px solid #f1f5f9; }
    .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 16px; }
    .card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 14px; }
    .card-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #64748b; margin-bottom: 4px; }
    .card-value { font-size: 22px; font-weight: 600; }
    .card-value.green { color: #059669; }
    .card-value.red { color: #dc2626; }
    .card-value.yellow { color: #d97706; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { text-align: left; padding: 8px 12px; background: #f1f5f9; border-bottom: 1px solid #e2e8f0; font-weight: 600; }
    td { padding: 8px 12px; border-bottom: 1px solid #f1f5f9; }
    .check { color: #059669; } .cross { color: #dc2626; }
    .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #94a3b8; text-align: center; }
    .print-btn { position: fixed; top: 16px; right: 16px; padding: 8px 16px; background: #059669; color: #fff; border: none; border-radius: 6px; cursor: pointer; font-size: 13px; }
  </style>
</head>
<body>
  <button class="print-btn no-print" onclick="window.print()">Download PDF</button>

  <div class="header">
    <div class="logo">AF</div>
    <div>
      <div class="title">AI Firewall Compliance Report</div>
      <div class="subtitle">Period: ${startDate} to ${endDate} &mdash; Generated: ${new Date().toISOString().split("T")[0]}</div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Security Summary</div>
    <div class="grid">
      <div class="card">
        <div class="card-label">Total Requests</div>
        <div class="card-value">${summary.totalRequests ?? 0}</div>
      </div>
      <div class="card">
        <div class="card-label">Blocked</div>
        <div class="card-value red">${summary.blocked ?? 0}</div>
      </div>
      <div class="card">
        <div class="card-label">Redacted</div>
        <div class="card-value yellow">${summary.redacted ?? 0}</div>
      </div>
      <div class="card">
        <div class="card-label">Allowed</div>
        <div class="card-value green">${summary.allowed ?? 0}</div>
      </div>
    </div>
    <div class="grid">
      <div class="card">
        <div class="card-label">Block Rate</div>
        <div class="card-value">${summary.blockRate ?? "0%"}</div>
      </div>
      <div class="card">
        <div class="card-label">Avg Risk Score</div>
        <div class="card-value">${summary.averageRiskScore ?? 0}</div>
      </div>
      <div class="card">
        <div class="card-label">Secrets Detected</div>
        <div class="card-value red">${summary.totalSecretsDetected ?? 0}</div>
      </div>
      <div class="card">
        <div class="card-label">PII Detected</div>
        <div class="card-value yellow">${summary.totalPiiDetected ?? 0}</div>
      </div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Compliance Checks</div>
    <table>
      <tr><th>Check</th><th>Status</th></tr>
      <tr><td>No raw secrets stored in database</td><td class="${compliance.noRawSecretsStored ? "check" : "cross"}">${compliance.noRawSecretsStored ? "PASS" : "FAIL"}</td></tr>
      <tr><td>All requests logged with audit trail</td><td class="${compliance.allRequestsLogged ? "check" : "cross"}">${compliance.allRequestsLogged ? "PASS" : "FAIL"}</td></tr>
      <tr><td>File scope enforcement active</td><td class="${compliance.fileScopeEnforced ? "check" : "cross"}">${compliance.fileScopeEnforced ? "PASS" : "FAIL"}</td></tr>
    </table>
  </div>

  <div class="section">
    <div class="section-title">Usage by Model</div>
    <table>
      <tr><th>Model</th><th>Requests</th><th>Tokens</th><th>Cost</th></tr>
      ${usage.byModel.map((m) => `
      <tr>
        <td>${m.modelName}</td>
        <td>${m.requests}</td>
        <td>${m.tokens.toLocaleString()}</td>
        <td>$${m.cost.toFixed(4)}</td>
      </tr>`).join("")}
      ${usage.byModel.length === 0 ? "<tr><td colspan=\"4\" style=\"text-align:center;color:#94a3b8;\">No usage data for this period</td></tr>" : ""}
    </table>
  </div>

  <div class="section">
    <div class="section-title">Daily Trend (last 30 days)</div>
    <table>
      <tr><th>Date</th><th>Requests</th><th>Tokens</th><th>Cost</th></tr>
      ${usage.byDay.slice(0, 30).map((d) => `
      <tr>
        <td>${d.date}</td>
        <td>${d.requests}</td>
        <td>${d.tokens.toLocaleString()}</td>
        <td>$${d.cost.toFixed(4)}</td>
      </tr>`).join("")}
      ${usage.byDay.length === 0 ? "<tr><td colspan=\"4\" style=\"text-align:center;color:#94a3b8;\">No daily data</td></tr>" : ""}
    </table>
  </div>

  <div class="footer">
    AI Firewall Compliance Report &mdash; Generated automatically &mdash; ${new Date().toISOString()}
  </div>
</body>
</html>`;
}
