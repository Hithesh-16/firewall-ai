import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppSelector } from "../../redux/hooks";
import { PerimeterStatus } from "../../components/security/PerimeterStatus";
import { RiskGauge } from "../../components/security/RiskGauge";
import { UnderlineTabs } from "../../components/ui/UnderlineTabs";
import { ROUTES } from "../../util/navigation";
import { useProxyApi } from "../../hooks/useProxyApi";
import { useFirewallWebSocket } from "../../hooks/useFirewallWebSocket";

interface SecurityStats {
  totalRequests: number;
  blocked: number;
  redacted: number;
  allowed: number;
  avgRiskScore: number;
  totalEntropyFindings: number;
  totalSecretsFound?: number;
  totalPiiFound?: number;
  topModels?: Array<{ model: string; count: number }>;
}

interface LogEntry {
  id: number;
  timestamp: number;
  model: string;
  provider?: string;
  action: string;
  riskScore: number;
  secretsFound: number;
  piiFound: number;
  entropyFound: number;
  responseTimeMs: number;
  reasons?: string | null;
}

function SecurityPage() {
  const navigate = useNavigate();
  const api = useProxyApi();
  const recentScans = useAppSelector((s) => s.security.recentScans);
  const proxyHealthy = useAppSelector((s) => s.security.proxyHealthy);

  const [stats, setStats] = useState<SecurityStats | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [activeTab, setActiveTab] = useState<"overview" | "feed">("overview");

  const wsHandlers = useCallback(
    () => ({
      connected: () => setWsConnected(true),
      disconnected: () => setWsConnected(false),
      scan_result: () => {
        fetchStats();
        fetchLogs();
      },
      scan_blocked: () => {
        fetchStats();
        fetchLogs();
      },
      policy_changed: () => {
        fetchStats();
      },
      credit_exceeded: (payload: Record<string, unknown>) => {
        setError(`Credit limit exceeded: ${payload.message ?? "Check usage"}`);
      },
    }),
    [],
  );

  useFirewallWebSocket(wsHandlers());

  useEffect(() => {
    Promise.all([fetchStats(), fetchLogs()]).finally(() => setLoading(false));
  }, []);

  async function fetchStats() {
    try {
      const data = await api.get<SecurityStats>("/api/stats");
      setStats(data);
      setError(null);
    } catch {
      // Only show error once, don't keep overwriting
      if (!error) setError("Could not reach AI Firewall proxy");
    }
  }

  async function fetchLogs() {
    try {
      const data = await api.get<{ logs?: LogEntry[] }>("/api/logs?limit=50");
      setLogs(data.logs ?? []);
    } catch {
      // Logs unavailable
    }
  }

  const tabs = [
    { id: "overview" as const, label: "Overview" },
    { id: "feed" as const, label: "Live Feed" },
  ];

  const totalReqs = stats?.totalRequests ?? 0;
  const blocked = stats?.blocked ?? 0;
  const redacted = stats?.redacted ?? 0;
  const allowed = stats?.allowed ?? 0;
  const avgRisk = stats?.avgRiskScore ?? 0;

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <span
          onClick={() => navigate(ROUTES.HOME)}
          className="text-description hover:text-foreground cursor-pointer transition-colors"
          role="button"
          aria-label="Back to chat"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M19 12H5" />
            <path d="m12 19-7-7 7-7" />
          </svg>
        </span>
        <div className="bg-primary/10 flex h-8 w-8 items-center justify-center rounded-lg">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            className="text-primary"
          >
            <path
              d="M12 2L21 5.5V11C21 16.5 17.2 20.8 12 22.5C6.8 20.8 3 16.5 3 11V5.5L12 2Z"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinejoin="round"
            />
            <path
              d="M8 12.5L10.8 15.3L16 9.5"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <div className="flex-1">
          <h1 className="text-foreground text-base font-semibold">
            Security Dashboard
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <div
            className={`h-1.5 w-1.5 rounded-full ${proxyHealthy ? "bg-success" : "bg-description-muted"}`}
            title={proxyHealthy ? "Proxy online" : "Proxy offline"}
          />
          <span className="text-description text-[10px]">
            {proxyHealthy ? "Online" : "Offline"}
          </span>
          {wsConnected && (
            <span className="text-success text-[10px]">Live</span>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-error/5 border-error/30 text-error flex items-center justify-between rounded-lg border px-3 py-2 text-xs">
          <span>{error}</span>
          <span
            onClick={() => setError(null)}
            className="text-error/50 hover:text-error ml-2 cursor-pointer"
            role="button"
          >
            {"\u2715"}
          </span>
        </div>
      )}

      {loading && (
        <div className="text-description p-4 text-center text-xs">
          Loading security data...
        </div>
      )}

      <UnderlineTabs
        tabs={tabs}
        activeTab={activeTab}
        onTabClick={(id) => setActiveTab(id as typeof activeTab)}
      />

      {/* ── Overview Tab ─────────────────────────────────────── */}
      {activeTab === "overview" && (
        <div className="flex flex-col gap-3">
          <PerimeterStatus />

          {/* Stats row — from database, not session */}
          <div className="flex items-stretch gap-2">
            <div className="border-border bg-editor flex min-w-[90px] flex-col items-center justify-center rounded-lg border p-3">
              <RiskGauge score={avgRisk} size="sm" label="Risk" />
            </div>
            <div className="grid flex-1 grid-cols-2 gap-1.5">
              <StatCard
                label="Total Scanned"
                value={totalReqs}
                color="text-foreground"
              />
              <StatCard label="Blocked" value={blocked} color="text-error" />
              <StatCard
                label="Redacted"
                value={redacted}
                color="text-warning"
              />
              <StatCard label="Allowed" value={allowed} color="text-success" />
            </div>
          </div>

          {/* Detection summary */}
          <div className="grid grid-cols-3 gap-1.5">
            <MiniCard
              label="Secrets"
              value={stats?.totalSecretsFound ?? 0}
              color="text-error"
            />
            <MiniCard
              label="PII"
              value={stats?.totalPiiFound ?? 0}
              color="text-warning"
            />
            <MiniCard
              label="Entropy"
              value={stats?.totalEntropyFindings ?? 0}
              color="text-info"
            />
          </div>

          {/* Top models */}
          {stats?.topModels && stats.topModels.length > 0 && (
            <div className="border-border bg-editor rounded-lg border p-3">
              <p className="text-description mb-2 text-[10px] font-medium">
                Models Used
              </p>
              <div className="space-y-1.5">
                {stats.topModels.slice(0, 5).map((m) => {
                  const pct = totalReqs > 0 ? (m.count / totalReqs) * 100 : 0;
                  return (
                    <div key={m.model} className="flex items-center gap-2">
                      <span className="text-description w-28 truncate text-[11px]">
                        {m.model}
                      </span>
                      <div className="bg-secondary-background h-1.5 flex-1 overflow-hidden rounded-full">
                        <div
                          className="bg-primary/70 h-full rounded-full"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-description w-8 text-right text-[10px]">
                        {m.count}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Security score */}
          <div className="border-border bg-editor rounded-lg border p-3">
            <div className="flex items-center justify-between">
              <p className="text-description text-[10px] font-medium">
                Security Score
              </p>
              <p className="text-foreground text-lg font-bold">
                {totalReqs > 0
                  ? `${Math.max(0, 100 - Math.round(avgRisk))}`
                  : "N/A"}
                <span className="text-description text-[10px] font-normal">
                  /100
                </span>
              </p>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <div className="bg-secondary-background h-1.5 flex-1 overflow-hidden rounded-full">
                <div
                  className={`h-full rounded-full transition-all ${
                    avgRisk > 60
                      ? "bg-error"
                      : avgRisk > 30
                        ? "bg-warning"
                        : "bg-success"
                  }`}
                  style={{ width: `${avgRisk}%` }}
                />
              </div>
              <span className="text-description w-8 text-right font-mono text-[10px]">
                {avgRisk.toFixed(0)}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* ── Live Feed Tab ────────────────────────────────────── */}
      {activeTab === "feed" && (
        <div className="flex flex-col gap-2 overflow-y-auto">
          {/* Real-time session scans from Redux */}
          {recentScans.length > 0 && (
            <>
              <p className="text-description text-xs font-medium">
                This Session
              </p>
              {recentScans.slice(0, 20).map((scan, i) => (
                <div
                  key={`scan-${i}`}
                  className="bg-secondary-background flex items-center gap-3 rounded-lg px-3 py-2"
                >
                  <ActionBadge action={scan.action} />
                  <div className="min-w-0 flex-1">
                    <p className="text-description text-xs">
                      {scan.secretsCount} secrets, {scan.piiCount} PII
                      {scan.entropyCount > 0
                        ? `, ${scan.entropyCount} entropy`
                        : ""}{" "}
                      {"\u00B7"} Risk: {scan.riskScore}
                      {scan.tokensUsed ? ` \u00B7 ${scan.tokensUsed} tok` : ""}
                    </p>
                  </div>
                  <span className="text-description whitespace-nowrap text-[10px]">
                    {new Date(scan.timestamp).toLocaleTimeString()}
                  </span>
                </div>
              ))}
            </>
          )}

          {/* Historical logs from proxy API */}
          <p className="text-description mt-2 text-xs font-medium">History</p>
          {logs.length === 0 && recentScans.length === 0 && (
            <p className="text-description py-8 text-center text-sm">
              No scan results yet. Start using the AI agent to see activity.
            </p>
          )}
          {logs.map((log) => (
            <div
              key={log.id}
              className="bg-secondary-background flex items-center gap-3 rounded-lg px-3 py-2"
            >
              <ActionBadge action={log.action} />
              <div className="min-w-0 flex-1">
                <p className="text-foreground truncate text-xs font-medium">
                  {log.model}
                </p>
                <p className="text-description text-[11px]">
                  {log.provider && (
                    <span className="text-description-muted">
                      via {log.provider} {"\u00B7"}{" "}
                    </span>
                  )}
                  {log.secretsFound} secrets, {log.piiFound} PII
                  {log.entropyFound > 0
                    ? `, ${log.entropyFound} entropy`
                    : ""}{" "}
                  {"\u00B7"} Risk: {log.riskScore}
                </p>
              </div>
              <span className="text-description whitespace-nowrap text-[10px]">
                {log.responseTimeMs}ms
              </span>
            </div>
          ))}
          <span
            onClick={fetchLogs}
            className="text-link cursor-pointer self-center py-2 text-xs hover:underline"
            role="button"
          >
            Refresh
          </span>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="border-border bg-editor rounded-md border px-2.5 py-2">
      <p className="text-description text-[10px]">{label}</p>
      <p className={`text-lg font-bold ${color}`}>{value.toLocaleString()}</p>
    </div>
  );
}

function MiniCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="border-border bg-editor rounded-md border px-2.5 py-1.5">
      <p className="text-description text-[10px]">{label}</p>
      <p className={`text-sm font-bold ${color}`}>{value.toLocaleString()}</p>
    </div>
  );
}

function ActionBadge({ action }: { action: string }) {
  const colors: Record<string, string> = {
    BLOCK: "bg-error/20 text-error",
    REDACT: "bg-warning/20 text-warning",
    ALLOW: "bg-success/20 text-success",
  };
  return (
    <span
      className={`rounded px-2 py-0.5 text-[11px] font-medium ${colors[action] ?? "bg-secondary-background text-description"}`}
    >
      {action}
    </span>
  );
}

export default SecurityPage;
