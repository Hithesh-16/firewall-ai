import { useCallback, useEffect, useState } from "react";
import { useProxyApi } from "../../hooks/useProxyApi";

interface LogEntry {
  id: number;
  timestamp: number;
  model: string;
  provider: string;
  action: string;
  risk_score: number;
  secrets_found: number;
  pii_found: number;
  files_blocked: number;
  response_time_ms: number;
  reasons: string;
  sanitized_text: string;
}

interface LogsResponse {
  logs: LogEntry[];
  total: number;
  limit: number;
  offset: number;
}

const ACTION_COLORS: Record<string, string> = {
  BLOCK: "bg-error/15 text-error",
  REDACT: "bg-warning/15 text-warning",
  ALLOW: "bg-success/15 text-success",
};

export function AuditTab() {
  const api = useProxyApi();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [filter, setFilter] = useState("all");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const limit = 25;

  const fetchLogs = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        limit: String(limit),
        offset: String(page * limit),
      });
      const data = await api.get<LogsResponse>(`/api/logs?${params}`);
      setLogs(data.logs ?? []);
      setTotal(data.total ?? 0);
    } catch {
      setError("Could not reach AI Firewall proxy");
    } finally {
      setLoading(false);
    }
  }, [api, page]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const filteredLogs =
    filter === "all" ? logs : logs.filter((l) => l.action === filter);

  const handleExportJson = async () => {
    setExporting(true);
    try {
      const data = await api.get<string>("/api/export/json");
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ai-firewall-audit-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("Failed to export audit logs as JSON");
    } finally {
      setExporting(false);
    }
  };

  const handleExportCsv = async () => {
    setExporting(true);
    try {
      const res = await fetch("http://localhost:8080/api/export/csv");
      const text = await res.text();
      const blob = new Blob([text], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ai-firewall-audit-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("Failed to export audit logs as CSV");
    } finally {
      setExporting(false);
    }
  };

  const totalPages = Math.ceil(total / limit);

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <div className="bg-error/5 border border-error/30 rounded-lg px-3 py-2 text-sm text-error">
          {error}
        </div>
      )}

      {/* Controls */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex gap-1">
          {["all", "BLOCK", "REDACT", "ALLOW"].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-2 py-1 rounded text-xs transition-colors focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:outline-none ${
                filter === f
                  ? "bg-primary-background text-primary-foreground"
                  : "text-description hover:text-foreground bg-secondary-background"
              }`}
            >
              {f === "all" ? "All" : f}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <button
          onClick={handleExportJson}
          disabled={exporting}
          className="text-xs text-link hover:underline focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:outline-none"
        >
          Export JSON
        </button>
        <button
          onClick={handleExportCsv}
          disabled={exporting}
          className="text-xs text-link hover:underline focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:outline-none"
        >
          Export CSV
        </button>
      </div>

      {/* Log entries */}
      {loading ? (
        <p className="text-sm text-description text-center py-6">Loading audit logs...</p>
      ) : filteredLogs.length === 0 ? (
        <p className="text-sm text-description text-center py-6">
          No audit entries found.
        </p>
      ) : (
        filteredLogs.map((log) => (
          <div key={log.id}>
            <button
              onClick={() =>
                setExpandedId(expandedId === log.id ? null : log.id)
              }
              className="w-full flex items-center gap-3 bg-secondary-background rounded-lg px-3 py-2 hover:bg-list-hover transition-colors text-left focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:outline-none"
            >
              <span
                className={`px-2 py-0.5 rounded text-xs font-medium ${ACTION_COLORS[log.action] ?? "bg-secondary text-description-muted"}`}
              >
                {log.action}
              </span>
              <span className="text-sm text-foreground truncate flex-1">
                {log.model}
              </span>
              <span className="text-xs text-description">
                Risk: {log.risk_score}
              </span>
              <span className="text-xs text-description whitespace-nowrap">
                {new Date(log.timestamp).toLocaleString()}
              </span>
            </button>

            {expandedId === log.id && (
              <div className="ml-4 mt-1 bg-background rounded-lg p-3 text-xs space-y-1 border border-border">
                <p>
                  <strong className="text-foreground">Provider:</strong>{" "}
                  <span className="text-description">{log.provider}</span>
                </p>
                <p>
                  <strong className="text-foreground">Secrets:</strong>{" "}
                  <span className="text-description">{log.secrets_found}</span>
                  {" \u00B7 "}
                  <strong className="text-foreground">PII:</strong>{" "}
                  <span className="text-description">{log.pii_found}</span>
                  {" \u00B7 "}
                  <strong className="text-foreground">Files blocked:</strong>{" "}
                  <span className="text-description">{log.files_blocked}</span>
                </p>
                <p>
                  <strong className="text-foreground">Latency:</strong>{" "}
                  <span className="text-description">
                    {log.response_time_ms}ms
                  </span>
                </p>
                {log.reasons && (
                  <p>
                    <strong className="text-foreground">Reasons:</strong>{" "}
                    <span className="text-description">{log.reasons}</span>
                  </p>
                )}
              </div>
            )}
          </div>
        ))
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3 pt-2">
          <button
            onClick={() => setPage(Math.max(0, page - 1))}
            disabled={page === 0}
            className="text-xs text-link hover:underline disabled:text-description disabled:no-underline focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:outline-none"
          >
            Previous
          </button>
          <span className="text-xs text-description">
            Page {page + 1} of {totalPages} ({total} total)
          </span>
          <button
            onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
            disabled={page >= totalPages - 1}
            className="text-xs text-link hover:underline disabled:text-description disabled:no-underline focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:outline-none"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
