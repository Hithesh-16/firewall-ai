import { useEffect, useState } from "react";
import {
  ClipboardDocumentListIcon,
  ArrowDownTrayIcon,
  FunnelIcon,
} from "@heroicons/react/24/outline";
import { apiClient } from "../../../api/client";
import { ENDPOINTS } from "../../../api/endpoints";
import { cn } from "../../../utils/cn";
import { Card } from "../../../components/ui/Card";
import { Button } from "../../../components/ui/Button";
import { Badge } from "../../../components/ui/Badge";
import { LoadingSpinner } from "../../../components/ui/LoadingSpinner";
import { ErrorBanner } from "../../../components/ui/ErrorBanner";
import { EmptyState } from "../../../components/ui/EmptyState";

interface AuditLogEntry {
  id: number;
  timestamp: number;
  model: string;
  provider: string;
  action: "ALLOW" | "BLOCK" | "REDACT";
  riskScore: number;
  secretsFound: number;
  piiFound: number;
  entropyFound: number;
  filesBlocked: number;
  responseTimeMs: number;
  reasons: string | null;
  userId: number | null;
  teamId: number | null;
}

export function AuditTab() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const [modelFilter, setModelFilter] = useState("");
  const [offset, setOffset] = useState(0);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const limit = 25;

  useEffect(() => {
    loadLogs();
  }, [offset, filter, modelFilter]);

  async function loadLogs() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("limit", String(limit));
      params.set("offset", String(offset));
      if (filter !== "all") params.set("action", filter);
      if (modelFilter.trim()) params.set("model", modelFilter.trim());

      const data = await apiClient.get<{ logs: AuditLogEntry[]; total: number }>(
        `${ENDPOINTS.logs}?${params.toString()}`,
      );
      setLogs(data.logs ?? []);
      setTotal(data.total ?? 0);
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
      const blob = await apiClient.download(ENDPOINTS.privacy.export(format));
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

  function parseReasons(reasons: string | null): string[] {
    if (!reasons) return [];
    try {
      return JSON.parse(reasons) as string[];
    } catch {
      return [];
    }
  }

  const totalPages = Math.ceil(total / limit);
  const currentPage = Math.floor(offset / limit) + 1;

  return (
    <div className="space-y-4">
      {/* Filters row */}
      <div className="flex flex-wrap items-center gap-2">
        {["all", "BLOCK", "REDACT", "ALLOW"].map((f) => (
          <button
            key={f}
            onClick={() => {
              setFilter(f);
              setOffset(0);
            }}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              filter === f
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-secondary-foreground hover:bg-secondary-hover",
            )}
          >
            {f === "all" ? "All" : f}
          </button>
        ))}

        {/* Model filter */}
        <div className="relative ml-2">
          <FunnelIcon className="text-description-muted absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Filter by model..."
            value={modelFilter}
            onChange={(e) => {
              setModelFilter(e.target.value);
              setOffset(0);
            }}
            className="border-input-border bg-input text-input-foreground placeholder:text-input-placeholder focus:border-border-focus w-44 rounded-md border py-1.5 pl-7 pr-2 text-xs focus:outline-none focus:ring-1 focus:ring-border-focus"
          />
        </div>

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
          description={
            filter !== "all" || modelFilter
              ? "No logs match the current filters."
              : "Audit entries will appear here after scan activity."
          }
        />
      ) : (
        <div className="space-y-1">
          {logs.map((log) => {
            const reasons = parseReasons(log.reasons);
            const isExpanded = expandedId === log.id;

            return (
              <Card key={log.id} padding={false}>
                <button
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm"
                  onClick={() => setExpandedId(isExpanded ? null : log.id)}
                >
                  <span className="text-description-muted shrink-0 font-mono text-[11px]">
                    {new Date(log.timestamp).toLocaleString()}
                  </span>
                  <Badge variant={actionVariant[log.action] ?? "default"}>{log.action}</Badge>
                  <span className="text-foreground truncate text-xs font-medium">{log.model}</span>
                  <span className="text-description-muted truncate text-xs">
                    via {log.provider}
                  </span>

                  {/* Inline finding counts */}
                  {log.secretsFound > 0 && (
                    <span className="text-error shrink-0 text-xs">
                      {log.secretsFound} secret{log.secretsFound > 1 ? "s" : ""}
                    </span>
                  )}
                  {log.piiFound > 0 && (
                    <span className="text-warning shrink-0 text-xs">{log.piiFound} PII</span>
                  )}

                  <span className="text-description ml-auto shrink-0 text-xs">
                    Risk: {log.riskScore}
                  </span>
                </button>

                {isExpanded && (
                  <div className="border-border border-t px-4 py-3 text-xs">
                    <div className="grid grid-cols-2 gap-x-6 gap-y-2 lg:grid-cols-4">
                      <div>
                        <span className="text-description-muted">Provider</span>
                        <p className="text-foreground font-medium">{log.provider}</p>
                      </div>
                      <div>
                        <span className="text-description-muted">Model</span>
                        <p className="text-foreground font-medium">{log.model}</p>
                      </div>
                      <div>
                        <span className="text-description-muted">Latency</span>
                        <p className="text-foreground font-medium">{log.responseTimeMs}ms</p>
                      </div>
                      <div>
                        <span className="text-description-muted">Risk Score</span>
                        <p className="text-foreground font-medium">{log.riskScore}</p>
                      </div>
                      <div>
                        <span className="text-description-muted">Secrets</span>
                        <p
                          className={cn(
                            "font-medium",
                            log.secretsFound > 0 ? "text-error" : "text-foreground",
                          )}
                        >
                          {log.secretsFound}
                        </p>
                      </div>
                      <div>
                        <span className="text-description-muted">PII</span>
                        <p
                          className={cn(
                            "font-medium",
                            log.piiFound > 0 ? "text-warning" : "text-foreground",
                          )}
                        >
                          {log.piiFound}
                        </p>
                      </div>
                      <div>
                        <span className="text-description-muted">Entropy</span>
                        <p className="text-foreground font-medium">{log.entropyFound}</p>
                      </div>
                      <div>
                        <span className="text-description-muted">Files Blocked</span>
                        <p className="text-foreground font-medium">{log.filesBlocked}</p>
                      </div>
                    </div>

                    {reasons.length > 0 && (
                      <div className="mt-3">
                        <span className="text-description-muted">Reasons</span>
                        <div className="mt-1 flex flex-wrap gap-1">
                          {reasons.map((r, i) => (
                            <span
                              key={i}
                              className="bg-secondary text-secondary-foreground rounded px-2 py-0.5 text-[11px]"
                            >
                              {r}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {log.userId != null && (
                      <div className="mt-2">
                        <span className="text-description-muted">User ID: </span>
                        <span className="text-foreground">{log.userId}</span>
                      </div>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
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
          Page {currentPage} of {totalPages || 1} ({total} total)
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
