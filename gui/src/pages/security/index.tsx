import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppSelector } from "../../redux/hooks";
import { PerimeterStatus } from "../../components/security/PerimeterStatus";
import { RiskGauge } from "../../components/security/RiskGauge";
import { UnderlineTabs } from "../../components/ui/UnderlineTabs";
import { CreditsTab } from "./CreditsTab";
import { ProvidersTab } from "./ProvidersTab";
import { PolicyEditor } from "./PolicyEditor";
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
}

interface LogEntry {
  id: number;
  timestamp: number;
  model: string;
  action: string;
  risk_score: number;
  secrets_found: number;
  pii_found: number;
  entropy_found: number;
  response_time_ms: number;
  reasons: string;
}

function SecurityPage() {
  const navigate = useNavigate();
  const api = useProxyApi();
  const sessionStats = useAppSelector((s) => s.security.sessionStats);
  const recentScans = useAppSelector((s) => s.security.recentScans);
  const proxyHealthy = useAppSelector((s) => s.security.proxyHealthy);

  const [stats, setStats] = useState<SecurityStats | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [activeTab, setActiveTab] = useState<
    "overview" | "feed" | "policy" | "credits" | "providers"
  >("overview");

  // Real-time WebSocket events from proxy
  const wsHandlers = useCallback(() => ({
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
  }), []);

  useFirewallWebSocket(wsHandlers());

  useEffect(() => {
    Promise.all([fetchStats(), fetchLogs()]).finally(() => setLoading(false));
  }, []);

  // Auto-refresh when a new scan result arrives (fallback for Redux-based events)
  useEffect(() => {
    if (sessionStats.totalScanned > 0) {
      fetchStats();
      fetchLogs();
    }
  }, [sessionStats.totalScanned]);

  async function fetchStats() {
    try {
      const data = await api.get<Record<string, unknown>>("/api/stats");
      setStats({
        totalRequests: (data.totalRequests as number) ?? 0,
        blocked: (data.blocked as number) ?? 0,
        redacted: (data.redacted as number) ?? 0,
        allowed: (data.allowed as number) ?? 0,
        avgRiskScore: (data.avgRiskScore as number) ?? 0,
        totalEntropyFindings: (data.totalEntropyFindings as number) ?? 0,
      });
    } catch (err) {
      console.error("Failed to fetch security stats", err);
      setError("Could not reach AI Firewall proxy");
    }
  }

  async function fetchLogs() {
    try {
      const data = await api.get<{ logs?: LogEntry[] }>("/api/logs?limit=50");
      setLogs(data.logs ?? []);
    } catch (err) {
      console.error("Failed to fetch security logs", err);
      setError("Could not reach AI Firewall proxy");
    }
  }

  const tabs = [
    { id: "overview" as const, label: "Overview" },
    { id: "feed" as const, label: "Live Feed" },
    { id: "policy" as const, label: "Policy" },
    { id: "credits" as const, label: "Credits" },
    { id: "providers" as const, label: "Providers" },
  ];

  return (
    <div className="flex flex-col h-full overflow-y-auto p-4 gap-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate(ROUTES.HOME)}
          className="text-description hover:text-foreground transition-colors focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:outline-none"
          aria-label="Back to chat"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5" /><path d="m12 19-7-7 7-7" />
          </svg>
        </button>
        <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
          <span className="text-primary-foreground text-sm font-bold">AF</span>
        </div>
        <div className="flex-1">
          <h1 className="text-lg font-semibold text-foreground">
            Security Dashboard
          </h1>
          <p className="text-xs text-description">
            Real-time scanning and policy enforcement
          </p>
        </div>
        <button
          onClick={() => navigate("/rbac" as any)}
          className="flex items-center gap-1.5 text-xs text-description hover:text-foreground bg-secondary border border-border rounded-lg px-3 py-1.5 transition-colors focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:outline-none"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M22 21v-2a4 4 0 00-3-3.87" />
            <path d="M16 3.13a4 4 0 010 7.75" />
          </svg>
          Roles
        </button>
        {/* WebSocket live indicator */}
        <div className={`w-2 h-2 rounded-full ${wsConnected ? "bg-success animate-pulse" : "bg-description-muted"}`} title={wsConnected ? "Live updates connected" : "Live updates disconnected"} />
      </div>

      {error && (
        <div className="bg-error/5 border border-error/30 rounded-lg px-3 py-2 text-sm text-error">
          {error}
        </div>
      )}

      {loading && (
        <div className="p-4 text-xs text-description">Loading security data...</div>
      )}

      {/* Tabs */}
      <UnderlineTabs
        tabs={tabs}
        activeTab={activeTab}
        onTabClick={(id) => setActiveTab(id as typeof activeTab)}
      />

      {/* Overview Tab */}
      {activeTab === "overview" && (
        <div className="flex flex-col gap-3">
          {/* Proxy status bar */}
          <div className="flex items-center gap-2 px-1">
            <div className={`w-1.5 h-1.5 rounded-full ${proxyHealthy ? "bg-success animate-pulse" : "bg-description-muted"}`} />
            <span className="text-[11px] text-description">
              {proxyHealthy ? "Proxy Online" : "Proxy Offline"}
            </span>
          </div>

          {/* Perimeter */}
          <PerimeterStatus />

          {/* Risk + Stats row */}
          <div className="flex items-stretch gap-2">
            {/* Risk Gauge */}
            <div className="flex flex-col items-center justify-center rounded-lg border border-border bg-editor p-3 min-w-[90px]">
              <RiskGauge score={stats?.avgRiskScore ?? 0} size="sm" label="Risk" />
            </div>

            {/* Stats grid */}
            <div className="flex-1 grid grid-cols-2 gap-1.5">
              <StatCard label="Scanned" value={sessionStats.totalScanned} color="text-foreground" />
              <StatCard label="Blocked" value={sessionStats.blocked} color="text-error" />
              <StatCard label="Redacted" value={sessionStats.redacted} color="text-warning" />
              <StatCard label="Clean" value={sessionStats.allowed} color="text-success" />
            </div>
          </div>

          {/* All Time — compact row */}
          <div className="rounded-lg border border-border bg-editor p-3">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] text-description font-medium">All Time</p>
              <p className="text-[11px] text-description">
                Entropy: <span className="text-warning font-mono">{stats?.totalEntropyFindings ?? 0}</span>
              </p>
            </div>
            <div className="grid grid-cols-4 gap-2">
              <MiniStat label="Total" value={stats?.totalRequests ?? 0} color="text-foreground" />
              <MiniStat label="Blocked" value={stats?.blocked ?? 0} color="text-error" />
              <MiniStat label="Redacted" value={stats?.redacted ?? 0} color="text-warning" />
              <MiniStat label="Clean" value={stats?.allowed ?? 0} color="text-success" />
            </div>

            {/* Risk bar */}
            <div className="flex items-center gap-2 mt-3">
              <span className="text-[10px] text-description w-10">Risk</span>
              <div className="flex-1 h-1.5 bg-secondary-background rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    (stats?.avgRiskScore ?? 0) > 60
                      ? "bg-error"
                      : (stats?.avgRiskScore ?? 0) > 30
                        ? "bg-warning"
                        : "bg-success"
                  }`}
                  style={{ width: `${stats?.avgRiskScore ?? 0}%` }}
                />
              </div>
              <span className="text-[10px] font-mono text-foreground w-8 text-right">
                {(stats?.avgRiskScore ?? 0).toFixed(0)}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Live Feed Tab */}
      {activeTab === "feed" && (
        <div className="flex flex-col gap-2 overflow-y-auto">
          {/* Real-time session scans from Redux */}
          {recentScans.length > 0 && (
            <>
              <p className="text-xs text-description font-medium">This Session (live)</p>
              {recentScans.slice(0, 20).map((scan, i) => (
                <div
                  key={`scan-${i}`}
                  className="flex items-center gap-3 bg-secondary-background rounded-lg px-3 py-2"
                >
                  <ActionBadge action={scan.action} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-description">
                      {scan.secretsCount} secrets, {scan.piiCount} PII
                      {scan.entropyCount > 0 ? `, ${scan.entropyCount} entropy` : ""}
                      {" "}&middot; Risk: {scan.riskScore}
                      {scan.tokensUsed ? ` \u00B7 ${scan.tokensUsed} tok` : ""}
                    </p>
                  </div>
                  <span className="text-xs text-description whitespace-nowrap">
                    {new Date(scan.timestamp).toLocaleTimeString()}
                  </span>
                </div>
              ))}
            </>
          )}

          {/* Historical logs from proxy API */}
          <p className="text-xs text-description font-medium mt-2">History (from proxy)</p>
          {logs.length === 0 && recentScans.length === 0 && (
            <p className="text-description text-sm text-center py-8">
              No scan results yet. Start using the AI agent to see activity.
            </p>
          )}
          {logs.map((log) => (
            <div
              key={log.id}
              className="flex items-center gap-3 bg-secondary-background rounded-lg px-3 py-2"
            >
              <ActionBadge action={log.action} />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-foreground truncate">{log.model}</p>
                <p className="text-xs text-description">
                  {log.secrets_found} secrets, {log.pii_found} PII
                  {log.entropy_found > 0 ? `, ${log.entropy_found} entropy` : ""}
                  {" "}&middot; Risk: {log.risk_score}
                </p>
              </div>
              <span className="text-xs text-description whitespace-nowrap">
                {log.response_time_ms}ms
              </span>
            </div>
          ))}
          <button
            onClick={fetchLogs}
            className="text-xs text-link hover:underline self-center py-2 focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:outline-none"
          >
            Refresh
          </button>
        </div>
      )}

      {/* Policy Tab */}
      {activeTab === "policy" && <PolicyEditor />}

      {/* Credits Tab */}
      {activeTab === "credits" && <CreditsTab />}

      {/* Providers Tab */}
      {activeTab === "providers" && <ProvidersTab />}
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
    <div className="rounded-md border border-border bg-editor px-2.5 py-2">
      <p className="text-[10px] text-description">{label}</p>
      <p className={`text-lg font-bold ${color}`}>{value.toLocaleString()}</p>
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
      className={`px-2 py-0.5 rounded text-xs font-medium ${colors[action] ?? "bg-secondary-background text-description"}`}
    >
      {action}
    </span>
  );
}

function MiniStat({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div>
      <p className="text-xs text-description">{label}</p>
      <p className={`text-lg font-bold ${color}`}>{value.toLocaleString()}</p>
    </div>
  );
}

export default SecurityPage;
