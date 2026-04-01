import { generateComplianceSummary, exportAsJson } from "./exportService";
import { fireWebhooks } from "../routes/webhook.route";

let reportInterval: NodeJS.Timeout | null = null;

/**
 * Start the scheduled compliance report generator.
 * Runs weekly by default (configurable via REPORT_INTERVAL_HOURS env var).
 */
export function startScheduledReports(): void {
  const intervalHours = parseInt(
    process.env.REPORT_INTERVAL_HOURS || "168", // 168 hours = 1 week
    10,
  );

  if (intervalHours <= 0) return;

  const intervalMs = intervalHours * 60 * 60 * 1000;

  console.log(
    `[ScheduledReports] Starting with interval: ${intervalHours}h`,
  );

  reportInterval = setInterval(async () => {
    try {
      const oneWeekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const report = generateComplianceSummary({
        startDate: oneWeekAgo,
        endDate: Date.now(),
      }) as any;

      console.log(
        `[ScheduledReports] Generated weekly report: ${report?.summary?.totalRequests ?? 0} requests, ${report?.summary?.blockRate ?? 0} block rate`,
      );

      // Fire webhook with the report
      await fireWebhooks("policy_violation", {
        type: "scheduled_compliance_report",
        period: {
          start: new Date(oneWeekAgo).toISOString(),
          end: new Date().toISOString(),
        },
        summary: report.summary,
        compliance: report.compliance,
      });
    } catch (err) {
      console.error("[ScheduledReports] Error generating report:", err);
    }
  }, intervalMs);
}

/**
 * Stop the scheduled report generator.
 */
export function stopScheduledReports(): void {
  if (reportInterval) {
    clearInterval(reportInterval);
    reportInterval = null;
  }
}
