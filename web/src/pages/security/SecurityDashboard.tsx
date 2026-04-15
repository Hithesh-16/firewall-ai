import { useCallback, useEffect, useState } from "react";
import {
  ShieldCheckIcon,
  NoSymbolIcon,
  PencilSquareIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  FingerPrintIcon,
} from "@heroicons/react/24/outline";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import { addScanResult, setRecentScans, setProxyHealthy } from "../../store/slices/securitySlice";
import { apiClient } from "../../api/client";
import type { ScanResult, Provider } from "../../api/types";
import { UnderlineTabs } from "../../components/ui/UnderlineTabs";
import { StatCard } from "../../components/ui/StatCard";
import { Card } from "../../components/ui/Card";
import { LoadingSpinner } from "../../components/ui/LoadingSpinner";
import { ErrorBanner } from "../../components/ui/ErrorBanner";
import { ShieldStatus } from "../../components/security/ShieldStatus";
import { RiskGauge } from "../../components/security/RiskGauge";
import { LiveScanFeed } from "../../components/security/LiveScanFeed";
import { DonutChart } from "../../components/security/DonutChart";
import { ActivityChart } from "../../components/security/ActivityChart";
import { SecretTypesChart } from "../../components/security/SecretTypesChart";
import { useWebSocket } from "../../hooks/useWebSocket";
import { PolicyEditor } from "./PolicyEditor";
import { CreditsTab } from "./tabs/CreditsTab";
import type { CreditData, UsageSummary } from "./tabs/CreditsTab";
import { ProvidersTab } from "./tabs/ProvidersTab";

interface StatsData {
  totalRequests: number;
  blocked: number;
  redacted: number;
  allowed: number;
  avgRiskScore: number;
  totalEntropyFindings: number;
  totalSecretsFound?: number;
  totalPiiFound?: number;
  secretsByType: Record<string, number>;
  requestsByDay: Array<{ date: string; count: number; blocked?: number; redacted?: number }>;
  topModels?: Array<{ model: string; count: number }>;
}

const tabs = [
  { id: "overview", label: "Overview" },
  { id: "feed", label: "Live Feed" },
  { id: "analytics", label: "Analytics" },
  { id: "policy", label: "Policy" },
  { id: "credits", label: "Credits" },
  { id: "providers", label: "Providers" },
];

function gradeFromScore(score: number): string {
  if (score <= 20) return "A";
  if (score <= 40) return "B";
  if (score <= 60) return "C";
  if (score <= 80) return "D";
  return "F";
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

export function SecurityDashboard() {
  const dispatch = useAppDispatch();
  const { proxyHealthy, recentScans } = useAppSelector((s) => s.security);
  const [activeTab, setActiveTab] = useState("overview");
  const [stats, setStats] = useState<StatsData | null>(null);
  const [credits, setCredits] = useState<CreditData[]>([]);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const handleScanEvent = useCallback(
    (data: unknown) => {
      const scan = data as ScanResult;
      dispatch(addScanResult(scan));
      // Refresh stats on new scan event
      apiClient
        .get<StatsData>("/api/stats")
        .then(setStats)
        .catch(() => {});
    },
    [dispatch],
  );

  useWebSocket({ scan_result: handleScanEvent });

  const loadOverviewData = useCallback(
    async (showSpinner = true) => {
      if (showSpinner) setLoading(true);
      setError(null);
      try {
        const [healthRes, statsRes, logsRes, creditsRes, usageRes] = await Promise.allSettled([
          apiClient.get<{ status: string }>("/health"),
          apiClient.get<StatsData>("/api/stats"),
          apiClient.get<{ logs: ScanResult[] }>("/api/logs?limit=50"),
          apiClient.get<CreditData[]>("/api/credits"),
          apiClient.get<UsageSummary>("/api/usage/summary"),
        ]);

        dispatch(
          setProxyHealthy(healthRes.status === "fulfilled" && healthRes.value.status === "ok"),
        );

        if (statsRes.status === "fulfilled") {
          setStats(statsRes.value);
        }

        if (logsRes.status === "fulfilled") {
          dispatch(setRecentScans(logsRes.value.logs ?? []));
        }

        if (creditsRes.status === "fulfilled") {
          setCredits(creditsRes.value);
        }
        if (usageRes.status === "fulfilled") {
          setUsage(usageRes.value);
        }
      } catch (err: unknown) {
        if (err instanceof Error) setError(err.message);
        else setError("Failed to load security data");
      } finally {
        setLoading(false);
      }
    },
    [dispatch],
  );

  useEffect(() => {
    loadOverviewData(true);
  }, [loadOverviewData]);

  useEffect(() => {
    if (activeTab === "overview" || activeTab === "analytics") {
      loadOverviewData(false);
    }
    if (activeTab === "feed") {
      apiClient
        .get<{ logs: ScanResult[] }>("/api/logs?limit=50")
        .then((res) => {
          dispatch(setRecentScans(res.logs ?? []));
        })
        .catch(() => {});
    }
    if (activeTab === "credits") {
      Promise.allSettled([
        apiClient.get<CreditData[]>("/api/credits"),
        apiClient.get<UsageSummary>("/api/usage/summary"),
      ]).then(([creditsRes, usageRes]) => {
        if (creditsRes.status === "fulfilled") setCredits(creditsRes.value);
        if (usageRes.status === "fulfilled") setUsage(usageRes.value);
      });
    }
    if (activeTab === "providers") {
      apiClient
        .get<Provider[]>("/api/providers")
        .then(setProviders)
        .catch(() => setProviders([]));
    }
  }, [activeTab, dispatch, loadOverviewData]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  const avgRisk = stats?.avgRiskScore ?? 0;
  const totalReqs = stats?.totalRequests ?? 0;
  const blocked = stats?.blocked ?? 0;
  const redacted = stats?.redacted ?? 0;
  const allowed = stats?.allowed ?? 0;

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-foreground text-2xl font-bold">Security Dashboard</h1>
        <ShieldStatus healthy={proxyHealthy} />
      </div>

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      <UnderlineTabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />

      {activeTab === "overview" && (
        <div className="space-y-6">
          {/* ── Row 1: Stat Cards ───────────────────────────────── */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard
              label="Total Scanned"
              value={totalReqs.toLocaleString()}
              icon={<ShieldCheckIcon className="h-5 w-5" />}
            />
            <StatCard
              label="Blocked"
              value={blocked.toLocaleString()}
              icon={<NoSymbolIcon className="h-5 w-5" />}
              variant={blocked > 0 ? "error" : undefined}
            />
            <StatCard
              label="Redacted"
              value={redacted.toLocaleString()}
              icon={<PencilSquareIcon className="h-5 w-5" />}
              variant={redacted > 0 ? "warning" : undefined}
            />
            <StatCard
              label="Allowed"
              value={allowed.toLocaleString()}
              icon={<CheckCircleIcon className="h-5 w-5" />}
              variant="success"
            />
          </div>

          {/* ── Row 2: Risk Gauge + Donut + Detection Summary ── */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
            <Card className="flex flex-col items-center justify-center gap-3 py-6">
              <RiskGauge score={avgRisk} grade={gradeFromScore(avgRisk)} size={140} />
              <p className="text-description text-xs">Average Risk Score</p>
            </Card>

            <Card className="flex flex-col items-center justify-center py-6 lg:col-span-2">
              <h3 className="text-foreground mb-4 text-sm font-semibold">Action Distribution</h3>
              <DonutChart
                segments={[
                  {
                    label: "Allowed",
                    value: allowed,
                    colorClass: "text-success",
                    stroke: "#22c55e",
                  },
                  {
                    label: "Redacted",
                    value: redacted,
                    colorClass: "text-warning",
                    stroke: "#f59e0b",
                  },
                  { label: "Blocked", value: blocked, colorClass: "text-error", stroke: "#ef4444" },
                ]}
                size={200}
              />
            </Card>

            {stats && (
              <div className="grid grid-cols-2 gap-3">
                <Card className="flex flex-col gap-1 p-4">
                  <div className="flex items-center gap-2">
                    <ExclamationTriangleIcon className="text-error h-4 w-4" />
                    <span className="text-description text-xs">Secrets</span>
                  </div>
                  <span className="text-foreground text-xl font-bold">
                    {(stats.totalSecretsFound ?? 0).toLocaleString()}
                  </span>
                </Card>
                <Card className="flex flex-col gap-1 p-4">
                  <div className="flex items-center gap-2">
                    <FingerPrintIcon className="text-warning h-4 w-4" />
                    <span className="text-description text-xs">PII</span>
                  </div>
                  <span className="text-foreground text-xl font-bold">
                    {(stats.totalPiiFound ?? 0).toLocaleString()}
                  </span>
                </Card>
                <Card className="flex flex-col gap-1 p-4">
                  <span className="text-description text-xs">Entropy</span>
                  <span className="text-foreground text-xl font-bold">
                    {stats.totalEntropyFindings.toLocaleString()}
                  </span>
                </Card>
                <Card className="flex flex-col gap-1 p-4">
                  <span className="text-description text-xs">Score</span>
                  <span className="text-success text-xl font-bold">
                    {totalReqs > 0 ? `${Math.max(0, 100 - Math.round(avgRisk))}` : "—"}
                    <span className="text-description text-sm font-normal">/100</span>
                  </span>
                </Card>
              </div>
            )}
          </div>

          {/* ── Row 3: Secret Types + Top Models ────────────── */}
          {stats && (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <Card>
                <h3 className="text-foreground mb-4 text-sm font-semibold">Secrets by Type</h3>
                {Object.keys(stats.secretsByType).length > 0 ? (
                  <SecretTypesChart data={stats.secretsByType} />
                ) : (
                  <p className="text-description-muted py-6 text-center text-sm">
                    No secrets detected yet
                  </p>
                )}
              </Card>
              <Card>
                <h3 className="text-foreground mb-4 text-sm font-semibold">Top Models</h3>
                {stats.topModels && stats.topModels.length > 0 ? (
                  <div className="space-y-2">
                    {stats.topModels.map((m, idx) => {
                      const pct = totalReqs > 0 ? (m.count / totalReqs) * 100 : 0;
                      return (
                        <div key={m.model} className="flex items-center gap-3">
                          <span className="bg-secondary text-primary flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold">
                            {idx + 1}
                          </span>
                          <span className="text-description w-36 shrink-0 truncate text-xs font-medium">
                            {m.model}
                          </span>
                          <div className="bg-secondary relative h-3 flex-1 overflow-hidden rounded-full">
                            <div
                              className="from-primary/70 to-primary absolute inset-y-0 left-0 rounded-full bg-gradient-to-r transition-all duration-500"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="text-foreground w-10 shrink-0 text-right text-xs font-semibold">
                            {m.count.toLocaleString()}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-description-muted py-6 text-center text-sm">
                    No model data available
                  </p>
                )}
              </Card>
            </div>
          )}

          {/* ── Row 4: Activity Chart + Live Feed (5 latest) ── */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            {stats && stats.requestsByDay.length > 0 && (
              <Card className="lg:col-span-2">
                <h3 className="text-foreground mb-4 text-sm font-semibold">Daily Scan Activity</h3>
                <ActivityChart data={stats.requestsByDay} height={180} />
              </Card>
            )}
            <Card className="flex flex-col">
              <div className="flex items-center justify-between pb-3">
                <h3 className="text-foreground text-sm font-semibold">Recent Scans</h3>
                <button
                  type="button"
                  onClick={() => setActiveTab("feed")}
                  className="text-primary text-xs font-medium hover:underline"
                >
                  View all
                </button>
              </div>
              <div className="flex-1 space-y-1.5 overflow-y-auto" style={{ maxHeight: 220 }}>
                {recentScans.slice(0, 8).map((scan, i) => {
                  const badgeClass =
                    scan.action === "BLOCK"
                      ? "bg-error/15 text-error"
                      : scan.action === "REDACT"
                        ? "bg-warning/15 text-warning"
                        : "bg-success/15 text-success";
                  return (
                    <div
                      key={scan.id ?? i}
                      className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-white/[.03]"
                    >
                      <span
                        className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${badgeClass}`}
                      >
                        {scan.action}
                      </span>
                      <span className="text-description min-w-0 flex-1 truncate">
                        {scan.model ?? "unknown"}
                      </span>
                      <span
                        className={`shrink-0 font-mono text-[10px] ${
                          scan.riskScore > 60
                            ? "text-error"
                            : scan.riskScore > 25
                              ? "text-warning"
                              : "text-success"
                        }`}
                      >
                        {scan.riskScore}
                      </span>
                    </div>
                  );
                })}
                {recentScans.length === 0 && (
                  <p className="text-description-muted py-6 text-center text-sm">No scans yet</p>
                )}
              </div>
            </Card>
          </div>

          {/* ── Row 5: Token Intelligence + Credit Usage ────── */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {usage && (
              <Card>
                <h3 className="text-foreground mb-4 text-sm font-semibold">Token Intelligence</h3>
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <p className="text-description text-xs">Total Tokens</p>
                    <p className="text-foreground text-lg font-bold">
                      {formatTokens(usage.totalTokens ?? 0)}
                    </p>
                  </div>
                  <div>
                    <p className="text-description text-xs">Total Cost</p>
                    <p className="text-success text-lg font-bold">
                      ${(usage.totalCost ?? 0).toFixed(2)}
                    </p>
                  </div>
                  <div>
                    <p className="text-description text-xs">Avg / Request</p>
                    <p className="text-foreground text-lg font-bold">
                      $
                      {usage.totalRequests > 0
                        ? ((usage.totalCost ?? 0) / usage.totalRequests).toFixed(4)
                        : "0.00"}
                    </p>
                  </div>
                </div>
              </Card>
            )}
            {credits.length > 0 && (
              <Card>
                <h3 className="text-foreground mb-4 text-sm font-semibold">Credit Usage</h3>
                <div className="space-y-3">
                  {credits.slice(0, 4).map((c) => {
                    const used = c.usedDollars ?? 0;
                    const total = c.maxDollars ?? 0;
                    const pctVal = total > 0 ? Math.min((used / total) * 100, 100) : 0;
                    const colorClass =
                      pctVal > 80 ? "bg-error" : pctVal > 50 ? "bg-warning" : "bg-success";
                    return (
                      <div key={c.id}>
                        <div className="mb-1 flex items-center justify-between text-xs">
                          <span className="text-foreground font-medium">{c.provider}</span>
                          <span className="text-description">
                            ${used.toFixed(2)}
                            {total > 0 ? ` / $${total.toFixed(2)}` : ""}
                          </span>
                        </div>
                        <div className="bg-secondary h-2 overflow-hidden rounded-full">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${colorClass}`}
                            style={{ width: `${Math.max(pctVal, 2)}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            )}
          </div>
        </div>
      )}

      {activeTab === "analytics" && stats && (
        <div className="space-y-6">
          {/* Detections by type */}
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card>
              <h3 className="text-foreground mb-4 text-sm font-semibold">Detections by Type</h3>
              <SecretTypesChart data={stats.secretsByType} />
            </Card>
            <Card>
              <h3 className="text-foreground mb-4 text-sm font-semibold">Top Models</h3>
              {stats.topModels && stats.topModels.length > 0 ? (
                <div className="space-y-2">
                  {stats.topModels.map((m) => {
                    const pct = totalReqs > 0 ? (m.count / totalReqs) * 100 : 0;
                    return (
                      <div key={m.model} className="flex items-center gap-3">
                        <span className="text-description w-36 shrink-0 truncate text-xs font-medium">
                          {m.model}
                        </span>
                        <div className="bg-secondary relative h-4 flex-1 overflow-hidden rounded-full">
                          <div
                            className="bg-primary/80 absolute inset-y-0 left-0 rounded-full transition-all duration-500"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-foreground w-10 shrink-0 text-right text-xs font-semibold">
                          {m.count}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-description-muted py-8 text-center text-sm">
                  No model data available
                </p>
              )}
            </Card>
          </div>

          {/* All-time summary grid */}
          <Card>
            <h3 className="text-foreground mb-4 text-sm font-semibold">All-Time Summary</h3>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
              <div>
                <p className="text-description text-xs">Total Scanned</p>
                <p className="text-foreground text-xl font-semibold">
                  {stats.totalRequests.toLocaleString()}
                </p>
              </div>
              <div>
                <p className="text-description text-xs">Blocked</p>
                <p className="text-error text-xl font-semibold">{stats.blocked.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-description text-xs">Redacted</p>
                <p className="text-warning text-xl font-semibold">
                  {stats.redacted.toLocaleString()}
                </p>
              </div>
              <div>
                <p className="text-description text-xs">Allowed</p>
                <p className="text-success text-xl font-semibold">
                  {stats.allowed.toLocaleString()}
                </p>
              </div>
              <div>
                <p className="text-description text-xs">Avg Risk Score</p>
                <p className="text-foreground text-xl font-semibold">{stats.avgRiskScore}</p>
              </div>
              <div>
                <p className="text-description text-xs">Entropy Findings</p>
                <p className="text-foreground text-xl font-semibold">
                  {stats.totalEntropyFindings.toLocaleString()}
                </p>
              </div>
            </div>
          </Card>
        </div>
      )}

      {activeTab === "feed" && <LiveScanFeed scans={recentScans} />}

      {activeTab === "policy" && <PolicyEditor />}

      {activeTab === "credits" && <CreditsTab credits={credits} usage={usage} />}

      {activeTab === "providers" && <ProvidersTab providers={providers} />}
    </div>
  );
}
