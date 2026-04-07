import { useEffect, useState } from "react";
import { ClipboardDocumentListIcon, ArrowDownTrayIcon } from "@heroicons/react/24/outline";
import { apiClient } from "../../../api/client";
import { cn } from "../../../utils/cn";
import type { AuditLog } from "../../../api/types";
import { Card } from "../../../components/ui/Card";
import { Button } from "../../../components/ui/Button";
import { Badge } from "../../../components/ui/Badge";
import { LoadingSpinner } from "../../../components/ui/LoadingSpinner";
import { ErrorBanner } from "../../../components/ui/ErrorBanner";
import { EmptyState } from "../../../components/ui/EmptyState";

export function AuditTab() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const [offset, setOffset] = useState(0);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const limit = 25;

  useEffect(() => {
    loadLogs();
  }, [offset, filter]);

  async function loadLogs() {
    setLoading(true);
    setError(null);
    try {
      const actionParam = filter !== "all" ? `&action=${filter}` : "";
      const data = await apiClient.get<{ logs: AuditLog[] }>(
        `/api/logs?limit=${limit}&offset=${offset}${actionParam}`,
      );
      setLogs(data.logs ?? []);
    } catch (err: unknown) {
      if (err instanceof Error) setError(err.message);
      else setError("Failed to load audit logs");
    } finally {
      setLoading(false);
    }
  }

  const actionVariant: Record<string, "success" | "warning" | "error"> = {
    ALLOW: "success",
    REDACT: "warning",
    BLOCK: "error",
  };

  async function handleExport(format: "json" | "csv") {
    try {
      const blob = await apiClient.download(`/api/export/${format}`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `audit-export.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      /* export unavailable */
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {["all", "BLOCK", "REDACT", "ALLOW"].map((f) => (
          <button
            key={f}
            onClick={() => {
              setFilter(f);
              setOffset(0);
            }}
            className={cn(
              "rounded-md px-3 py-1 text-xs font-medium transition-colors",
              filter === f
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-secondary-foreground hover:bg-secondary-hover",
            )}
          >
            {f === "all" ? "All" : f}
          </button>
        ))}
        <div className="ml-auto flex gap-2">
          <Button variant="outline" size="sm" onClick={() => handleExport("json")}>
            <ArrowDownTrayIcon className="h-3.5 w-3.5" />
            JSON
          </Button>
          <Button variant="outline" size="sm" onClick={() => handleExport("csv")}>
            <ArrowDownTrayIcon className="h-3.5 w-3.5" />
            CSV
          </Button>
        </div>
      </div>

      {error && <ErrorBanner message={error} />}

      {loading ? (
        <div className="flex h-32 items-center justify-center">
          <LoadingSpinner />
        </div>
      ) : logs.length === 0 ? (
        <EmptyState
          icon={<ClipboardDocumentListIcon className="h-12 w-12" />}
          title="No audit logs"
          description="Audit entries will appear here after scan activity."
        />
      ) : (
        <div className="space-y-1">
          {logs.map((log) => (
            <Card key={log.id} padding={false} className="cursor-pointer">
              <button
                className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm"
                onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
              >
                <span className="text-description-muted shrink-0 font-mono text-xs">
                  {new Date(log.timestamp).toLocaleString()}
                </span>
                <span className="text-description truncate">{log.model}</span>
                <Badge variant={actionVariant[log.action] ?? "default"}>{log.action}</Badge>
                <span className="text-description ml-auto text-xs">Risk: {log.riskScore}</span>
              </button>
              {expandedId === log.id && (
                <div className="border-border text-description border-t px-4 py-2 text-xs">
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <span className="text-description-muted">Secrets: </span>
                      {log.secretsFound}
                    </div>
                    <div>
                      <span className="text-description-muted">PII: </span>
                      {log.piiFound}
                    </div>
                    <div>
                      <span className="text-description-muted">Risk: </span>
                      {log.riskScore}
                    </div>
                  </div>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          size="sm"
          disabled={offset === 0}
          onClick={() => setOffset(Math.max(0, offset - limit))}
        >
          Previous
        </Button>
        <span className="text-description text-xs">
          Showing {offset + 1} - {offset + logs.length}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={logs.length < limit}
          onClick={() => setOffset(offset + limit)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
