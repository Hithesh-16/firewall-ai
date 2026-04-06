import { useCallback, useEffect, useState } from "react";
import {
  ShieldCheckIcon,
  NoSymbolIcon,
  PencilSquareIcon,
  CheckCircleIcon,
  ServerIcon,
} from "@heroicons/react/24/outline";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import {
  addScanResult,
  setProxyHealthy,
} from "../../store/slices/securitySlice";
import { apiClient } from "../../api/client";
import type { ScanResult, Provider } from "../../api/types";
import { cn } from "../../utils/cn";
import { UnderlineTabs } from "../../components/ui/UnderlineTabs";
import { StatCard } from "../../components/ui/StatCard";
import { Card } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { LoadingSpinner } from "../../components/ui/LoadingSpinner";
import { ErrorBanner } from "../../components/ui/ErrorBanner";
import { EmptyState } from "../../components/ui/EmptyState";
import { ShieldStatus } from "../../components/security/ShieldStatus";
import { RiskGauge } from "../../components/security/RiskGauge";
import { LiveScanFeed } from "../../components/security/LiveScanFeed";
import { useWebSocket } from "../../hooks/useWebSocket";
import { PolicyEditor } from "./PolicyEditor";

interface StatsData {
  totalRequests: number;
  blocked: number;
  redacted: number;
  allowed: number;
  avgRiskScore: number;
}

interface CreditData {
  id: string;
  provider: string;
  maxRequests?: number;
  maxTokens?: number;
  maxDollars?: number;
  usedRequests: number;
  usedTokens: number;
  usedDollars: number;
}

interface UsageSummary {
  totalRequests: number;
  totalTokens: number;
  totalCost: number;
}

const tabs = [
  { id: "overview", label: "Overview" },
  { id: "feed", label: "Live Feed" },
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

export function SecurityDashboard() {
  const dispatch = useAppDispatch();
  const { proxyHealthy, sessionStats, recentScans } = useAppSelector(
    (s) => s.security,
  );
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
    },
    [dispatch],
  );

  useWebSocket({ scan_result: handleScanEvent });

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [healthRes, statsRes] = await Promise.allSettled([
          apiClient.get<{ status: string }>("/health"),
          apiClient.get<StatsData>("/api/stats"),
        ]);

        dispatch(
          setProxyHealthy(
            healthRes.status === "fulfilled" && healthRes.value.status === "ok",
          ),
        );

        if (statsRes.status === "fulfilled") {
          setStats(statsRes.value);
        }
      } catch (err: unknown) {
        if (err instanceof Error) setError(err.message);
        else setError("Failed to load security data");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [dispatch]);

  useEffect(() => {
    if (activeTab === "feed") {
      apiClient
        .get<{ logs: ScanResult[] }>("/api/logs?limit=50")
        .then((res) => {
          const logs = res.logs ?? [];
          for (const log of logs) {
            dispatch(addScanResult(log));
          }
        })
        .catch(() => {
          /* historical logs unavailable, live feed still works */
        });
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
  }, [activeTab, dispatch]);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  const avgRisk = stats?.avgRiskScore ?? 0;

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-foreground text-2xl font-bold">Security Dashboard</h1>

      {error && (
        <ErrorBanner message={error} onDismiss={() => setError(null)} />
      )}

      <UnderlineTabs
        tabs={tabs}
        activeTab={activeTab}
        onChange={setActiveTab}
      />

      {activeTab === "overview" && (
        <div className="space-y-6">
          {/* Top row: shield + gauge */}
          <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
            <Card className="flex-1">
              <ShieldStatus healthy={proxyHealthy} />
            </Card>
            <Card className="flex items-center justify-center">
              <RiskGauge score={avgRisk} grade={gradeFromScore(avgRisk)} />
            </Card>
          </div>

          {/* Session stats grid */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard
              label="Total Scanned"
              value={sessionStats.totalScanned}
              icon={<ShieldCheckIcon className="h-5 w-5" />}
            />
            <StatCard
              label="Blocked"
              value={sessionStats.blocked}
              icon={<NoSymbolIcon className="h-5 w-5" />}
            />
            <StatCard
              label="Redacted"
              value={sessionStats.redacted}
              icon={<PencilSquareIcon className="h-5 w-5" />}
            />
            <StatCard
              label="Allowed"
              value={sessionStats.allowed}
              icon={<CheckCircleIcon className="h-5 w-5" />}
            />
          </div>

          {/* All-time stats */}
          {stats && (
            <Card>
              <h3 className="text-foreground mb-3 text-sm font-semibold">
                All-Time Statistics
              </h3>
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <div>
                  <p className="text-description text-xs">Total Scanned</p>
                  <p className="text-foreground text-lg font-semibold">
                    {stats.totalRequests.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-description text-xs">Blocked</p>
                  <p className="text-error text-lg font-semibold">
                    {stats.blocked.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-description text-xs">Redacted</p>
                  <p className="text-warning text-lg font-semibold">
                    {stats.redacted.toLocaleString()}
                  </p>
                </div>
                <div>
                  <p className="text-description text-xs">Allowed</p>
                  <p className="text-success text-lg font-semibold">
                    {stats.allowed.toLocaleString()}
                  </p>
                </div>
              </div>
            </Card>
          )}
        </div>
      )}

      {activeTab === "feed" && <LiveScanFeed scans={recentScans} />}

      {activeTab === "policy" && <PolicyEditor />}

      {activeTab === "credits" && (
        <CreditsTab credits={credits} usage={usage} />
      )}

      {activeTab === "providers" && <ProvidersTab providers={providers} />}
    </div>
  );
}

/* ──────────── Credits Tab ──────────── */

function CreditsTab({
  credits,
  usage,
}: {
  credits: CreditData[];
  usage: UsageSummary | null;
}) {
  function pct(used: number, max: number | undefined): number {
    if (!max || max === 0) return 0;
    return Math.min(100, Math.round((used / max) * 100));
  }

  function barColor(percent: number): string {
    if (percent >= 90) return "bg-error";
    if (percent >= 70) return "bg-warning";
    return "bg-success";
  }

  return (
    <div className="space-y-6">
      {usage && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard
            label="Total Requests"
            value={usage.totalRequests.toLocaleString()}
          />
          <StatCard
            label="Total Tokens"
            value={usage.totalTokens.toLocaleString()}
          />
          <StatCard
            label="Total Cost"
            value={`$${usage.totalCost.toFixed(4)}`}
          />
        </div>
      )}

      {credits.length === 0 ? (
        <EmptyState
          title="No credit limits configured"
          description="Credit limits can be set per provider in the proxy."
        />
      ) : (
        <div className="space-y-4">
          {credits.map((c) => {
            const reqPct = pct(c.usedRequests, c.maxRequests);
            const tokPct = pct(c.usedTokens, c.maxTokens);
            const dolPct = pct(c.usedDollars, c.maxDollars);

            return (
              <Card key={c.id}>
                <h4 className="text-foreground mb-3 font-medium">
                  {c.provider}
                </h4>
                <div className="space-y-3">
                  {c.maxRequests != null && (
                    <CreditBar
                      label="Requests"
                      used={c.usedRequests}
                      max={c.maxRequests}
                      pct={reqPct}
                      color={barColor(reqPct)}
                    />
                  )}
                  {c.maxTokens != null && (
                    <CreditBar
                      label="Tokens"
                      used={c.usedTokens}
                      max={c.maxTokens}
                      pct={tokPct}
                      color={barColor(tokPct)}
                    />
                  )}
                  {c.maxDollars != null && (
                    <CreditBar
                      label="Cost"
                      used={c.usedDollars}
                      max={c.maxDollars}
                      pct={dolPct}
                      color={barColor(dolPct)}
                      prefix="$"
                    />
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CreditBar({
  label,
  used,
  max,
  pct,
  color,
  prefix = "",
}: {
  label: string;
  used: number;
  max: number;
  pct: number;
  color: string;
  prefix?: string;
}) {
  return (
    <div>
      <div className="text-description mb-1 flex justify-between text-xs">
        <span>{label}</span>
        <span>
          {prefix}
          {used.toLocaleString()} / {prefix}
          {max.toLocaleString()} ({pct}%)
        </span>
      </div>
      <div className="bg-secondary h-2 w-full overflow-hidden rounded-full">
        <div
          className={cn("h-full rounded-full transition-all", color)}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

/* ──────────── Providers Tab ──────────── */

function ProvidersTab({ providers }: { providers: Provider[] }) {
  if (providers.length === 0) {
    return (
      <EmptyState
        icon={<ServerIcon className="h-12 w-12" />}
        title="No providers configured"
        description="Add an AI provider in the proxy configuration to get started."
      />
    );
  }

  return (
    <div className="space-y-3">
      {providers.map((p) => (
        <Card key={p.id} className="flex items-center justify-between">
          <div>
            <p className="text-foreground font-medium">{p.name}</p>
            <p className="text-description text-xs">
              {p.baseUrl || "Default endpoint"}
            </p>
          </div>
          <Badge variant={p.enabled ? "success" : "default"}>
            {p.enabled ? "Enabled" : "Disabled"}
          </Badge>
        </Card>
      ))}
    </div>
  );
}
