import { useState } from "react";
import {
  FolderOpenIcon,
  PlayIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import { apiClient } from "../../api/client";
import type {
  SecurityAuditResult,
  SecurityAuditFinding,
} from "../../api/types";
import { cn } from "../../utils/cn";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { LoadingSpinner } from "../../components/ui/LoadingSpinner";
import { ErrorBanner } from "../../components/ui/ErrorBanner";
import { RiskGauge } from "../../components/security/RiskGauge";

interface AuditSettings {
  projectPath: string;
  maxFiles: number;
  maxFileSize: number;
  skipDirs: string;
}

const SEVERITY_ORDER = ["critical", "high", "medium", "low", "info"] as const;

const severityVariant: Record<
  string,
  "error" | "warning" | "info" | "default"
> = {
  critical: "error",
  high: "error",
  medium: "warning",
  low: "info",
  info: "default",
};

export function SecurityAuditPage() {
  const [settings, setSettings] = useState<AuditSettings>({
    projectPath: "",
    maxFiles: 500,
    maxFileSize: 1048576,
    skipDirs: "node_modules,.git,dist,build",
  });
  const [result, setResult] = useState<SecurityAuditResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runAudit() {
    if (!settings.projectPath.trim()) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const data = await apiClient.post<SecurityAuditResult>(
        "/api/security-audit",
        {
          projectPath: settings.projectPath.trim(),
          maxFiles: settings.maxFiles,
          maxFileSize: settings.maxFileSize,
          skipDirs: settings.skipDirs
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
        },
      );
      setResult(data);
    } catch (err: unknown) {
      if (err instanceof Error) setError(err.message);
      else setError("Security audit failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-foreground text-2xl font-bold">Security Audit</h1>

      {error && (
        <ErrorBanner message={error} onDismiss={() => setError(null)} />
      )}

      {/* Input Section */}
      <Card>
        <div className="space-y-4">
          <div>
            <label
              htmlFor="projectPath"
              className="text-foreground mb-1 block text-sm font-medium"
            >
              Project Path
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <FolderOpenIcon className="text-description-muted absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
                <input
                  id="projectPath"
                  type="text"
                  value={settings.projectPath}
                  onChange={(e) =>
                    setSettings({ ...settings, projectPath: e.target.value })
                  }
                  placeholder="/path/to/project"
                  className="border-input-border bg-input text-input-foreground placeholder:text-input-placeholder focus:border-border-focus focus:ring-border-focus w-full rounded-md border py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-1"
                />
              </div>
              <Button
                onClick={runAudit}
                disabled={loading || !settings.projectPath.trim()}
              >
                <PlayIcon className="h-4 w-4" />
                Run Audit
              </Button>
            </div>
          </div>

          {/* Optional settings */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label
                htmlFor="maxFiles"
                className="text-description mb-1 block text-xs"
              >
                Max Files
              </label>
              <input
                id="maxFiles"
                type="number"
                value={settings.maxFiles}
                onChange={(e) =>
                  setSettings({ ...settings, maxFiles: Number(e.target.value) })
                }
                className="border-input-border bg-input text-input-foreground focus:border-border-focus focus:ring-border-focus w-full rounded-md border px-3 py-1.5 text-sm focus:outline-none focus:ring-1"
              />
            </div>
            <div>
              <label
                htmlFor="maxFileSize"
                className="text-description mb-1 block text-xs"
              >
                Max File Size (bytes)
              </label>
              <input
                id="maxFileSize"
                type="number"
                value={settings.maxFileSize}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    maxFileSize: Number(e.target.value),
                  })
                }
                className="border-input-border bg-input text-input-foreground focus:border-border-focus focus:ring-border-focus w-full rounded-md border px-3 py-1.5 text-sm focus:outline-none focus:ring-1"
              />
            </div>
            <div>
              <label
                htmlFor="skipDirs"
                className="text-description mb-1 block text-xs"
              >
                Skip Directories (comma-separated)
              </label>
              <input
                id="skipDirs"
                type="text"
                value={settings.skipDirs}
                onChange={(e) =>
                  setSettings({ ...settings, skipDirs: e.target.value })
                }
                className="border-input-border bg-input text-input-foreground focus:border-border-focus focus:ring-border-focus w-full rounded-md border px-3 py-1.5 text-sm focus:outline-none focus:ring-1"
              />
            </div>
          </div>
        </div>
      </Card>

      {/* Loading state */}
      {loading && (
        <Card className="flex flex-col items-center justify-center py-12">
          <LoadingSpinner size="lg" />
          <p className="text-description mt-4 text-sm">
            Scanning project files for security issues...
          </p>
        </Card>
      )}

      {/* Results */}
      {result && <AuditResults result={result} />}
    </div>
  );
}

/* ──────────── Audit Results ──────────── */

function AuditResults({ result }: { result: SecurityAuditResult }) {
  const { summary, findings, techStack } = result;

  return (
    <div className="space-y-6">
      {/* Header row */}
      <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
        <Card className="flex items-center gap-6">
          <RiskGauge
            score={summary.riskScore}
            grade={summary.grade}
            size={100}
          />
          <div>
            <p className="text-description text-sm">Risk Score</p>
            <p className="text-foreground text-2xl font-bold">
              {summary.riskScore}
            </p>
          </div>
        </Card>

        <div className="grid flex-1 grid-cols-2 gap-4 sm:grid-cols-3">
          <Card>
            <p className="text-description text-xs">Files Scanned</p>
            <p className="text-foreground text-lg font-semibold">
              {result.filesScanned}
            </p>
          </Card>
          <Card>
            <p className="text-description text-xs">Total Findings</p>
            <p className="text-foreground text-lg font-semibold">
              {summary.totalFindings}
            </p>
          </Card>
          <Card>
            <p className="text-description text-xs">Duration</p>
            <p className="text-foreground text-lg font-semibold">
              {(result.scanDuration / 1000).toFixed(1)}s
            </p>
          </Card>
        </div>
      </div>

      {/* Tech stack chips */}
      {techStack.length > 0 && (
        <Card>
          <h3 className="text-foreground mb-2 text-sm font-semibold">
            Detected Technologies
          </h3>
          <div className="flex flex-wrap gap-2">
            {techStack.map((tech) => (
              <Badge key={tech} variant="info">
                {tech}
              </Badge>
            ))}
          </div>
        </Card>
      )}

      {/* Summary by category */}
      {Object.keys(summary.byCategory).length > 0 && (
        <Card>
          <h3 className="text-foreground mb-3 text-sm font-semibold">
            Findings by Category
          </h3>
          <div className="space-y-2">
            {Object.entries(summary.byCategory)
              .sort(([, a], [, b]) => b - a)
              .map(([category, count]) => {
                const maxCount = Math.max(...Object.values(summary.byCategory));
                const pct = maxCount > 0 ? (count / maxCount) * 100 : 0;

                return (
                  <div key={category}>
                    <div className="mb-1 flex justify-between text-xs">
                      <span className="text-foreground">{category}</span>
                      <span className="text-description">{count}</span>
                    </div>
                    <div className="bg-secondary h-2 w-full overflow-hidden rounded-full">
                      <div
                        className="bg-primary h-full rounded-full transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
          </div>
        </Card>
      )}

      {/* Findings by severity */}
      {SEVERITY_ORDER.map((severity) => {
        const sevFindings = findings.filter((f) => f.severity === severity);
        if (sevFindings.length === 0) return null;
        return (
          <FindingSeverityGroup
            key={severity}
            severity={severity}
            findings={sevFindings}
          />
        );
      })}
    </div>
  );
}

/* ──────────── Severity group ──────────── */

function FindingSeverityGroup({
  severity,
  findings,
}: {
  severity: string;
  findings: readonly SecurityAuditFinding[];
}) {
  const [expanded, setExpanded] = useState(
    severity === "critical" || severity === "high",
  );

  return (
    <Card padding={false}>
      <button
        onClick={() => setExpanded((p) => !p)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        {expanded ? (
          <ChevronDownIcon className="text-description h-4 w-4" />
        ) : (
          <ChevronRightIcon className="text-description h-4 w-4" />
        )}
        <Badge variant={severityVariant[severity] ?? "default"}>
          {severity.toUpperCase()}
        </Badge>
        <span className="text-foreground text-sm font-medium">
          {findings.length} finding{findings.length !== 1 ? "s" : ""}
        </span>
      </button>

      {expanded && (
        <div className="divide-border border-border divide-y border-t">
          {findings.map((f, i) => (
            <FindingItem
              key={`${f.filePath}-${f.lineNumber}-${i}`}
              finding={f}
            />
          ))}
        </div>
      )}
    </Card>
  );
}

/* ──────────── Single finding ──────────── */

function FindingItem({ finding }: { finding: SecurityAuditFinding }) {
  return (
    <div className="px-4 py-3">
      <div className="flex items-start gap-3">
        <ExclamationTriangleIcon
          className={cn(
            "mt-0.5 h-4 w-4 shrink-0",
            finding.severity === "critical" || finding.severity === "high"
              ? "text-error"
              : finding.severity === "medium"
                ? "text-warning"
                : "text-info",
          )}
        />
        <div className="min-w-0 flex-1">
          <p className="text-foreground text-sm font-medium">{finding.title}</p>
          <p className="text-description mt-0.5 text-xs">
            {finding.filePath}
            {finding.lineNumber != null && `:${finding.lineNumber}`}
          </p>
          <p className="text-description mt-1 text-xs">{finding.description}</p>
          {finding.cweName && (
            <p className="text-info mt-1 text-xs">{finding.cweName}</p>
          )}
          {finding.recommendation && (
            <p className="bg-success/5 text-success mt-2 rounded px-2 py-1 text-xs">
              {finding.recommendation}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
