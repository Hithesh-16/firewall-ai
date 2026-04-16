import { useEffect, useState } from "react";
import {
  UsersIcon,
  ShieldCheckIcon,
  NoSymbolIcon,
  PencilSquareIcon,
  CurrencyDollarIcon,
  ChartBarIcon,
  ExclamationTriangleIcon,
  FingerPrintIcon,
} from "@heroicons/react/24/outline";
import { apiClient } from "../../../api/client";
import { ENDPOINTS } from "../../../api/endpoints";
import type { User } from "../../../api/types";
import { StatCard } from "../../../components/ui/StatCard";
import { Card } from "../../../components/ui/Card";
import { LoadingSpinner } from "../../../components/ui/LoadingSpinner";
import { DonutChart } from "../../../components/security/DonutChart";

interface TeamStats {
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

interface UsageSummary {
  totalRequests: number;
  totalTokens: number;
  totalCost: number;
}

export function OverviewTab() {
  const [members, setMembers] = useState<User[]>([]);
  const [stats, setStats] = useState<TeamStats | null>(null);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const [m, s, u] = await Promise.allSettled([
        apiClient.get<User[]>(ENDPOINTS.admin.users),
        apiClient.get<TeamStats>(ENDPOINTS.stats),
        apiClient.get<UsageSummary>(ENDPOINTS.usageSummary),
      ]);
      if (m.status === "fulfilled") {
        const val = m.value;
        setMembers(Array.isArray(val) ? val : (val as { users: User[] }).users);
      }
      if (s.status === "fulfilled") setStats(s.value);
      if (u.status === "fulfilled") setUsage(u.value);
      setLoading(false);
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  const totalReqs = stats?.totalRequests ?? 0;
  const blocked = stats?.blocked ?? 0;
  const redacted = stats?.redacted ?? 0;
  const allowed = stats?.allowed ?? 0;

  return (
    <div className="space-y-6">
      {/* Primary stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCard
          label="Team Size"
          value={members.length}
          icon={<UsersIcon className="h-5 w-5" />}
        />
        <StatCard
          label="Total Requests"
          value={totalReqs.toLocaleString()}
          icon={<ChartBarIcon className="h-5 w-5" />}
        />
        <StatCard
          label="Total Spend"
          value={usage ? `$${usage.totalCost.toFixed(2)}` : "$0.00"}
          icon={<CurrencyDollarIcon className="h-5 w-5" />}
        />
      </div>

      {/* Security stats */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
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
          label="Secrets Found"
          value={(stats?.totalSecretsFound ?? 0).toLocaleString()}
          icon={<ExclamationTriangleIcon className="h-5 w-5" />}
          variant={(stats?.totalSecretsFound ?? 0) > 0 ? "error" : undefined}
        />
        <StatCard
          label="PII Detected"
          value={(stats?.totalPiiFound ?? 0).toLocaleString()}
          icon={<FingerPrintIcon className="h-5 w-5" />}
          variant={(stats?.totalPiiFound ?? 0) > 0 ? "warning" : undefined}
        />
      </div>

      {/* Visual: security score + donut */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="flex flex-col items-center justify-center gap-2 py-6">
          <ShieldCheckIcon className="text-primary h-8 w-8" />
          <p className="text-foreground text-3xl font-bold">
            {totalReqs > 0 ? `${Math.max(0, 100 - Math.round(stats?.avgRiskScore ?? 0))}` : "N/A"}
          </p>
          <p className="text-description text-xs">Security Score (out of 100)</p>
        </Card>

        <Card className="flex flex-col items-center justify-center py-6">
          <h3 className="text-foreground mb-3 text-sm font-semibold">Request Distribution</h3>
          <DonutChart
            segments={[
              { label: "Allowed", value: allowed, colorClass: "text-success", stroke: "#22c55e" },
              { label: "Redacted", value: redacted, colorClass: "text-warning", stroke: "#f59e0b" },
              { label: "Blocked", value: blocked, colorClass: "text-error", stroke: "#ef4444" },
            ]}
            size={160}
          />
        </Card>
      </div>

      {/* Top models */}
      {stats?.topModels && stats.topModels.length > 0 && (
        <Card>
          <h3 className="text-foreground mb-3 text-sm font-semibold">Models Used</h3>
          <div className="space-y-2">
            {stats.topModels.map((m) => {
              const pct = totalReqs > 0 ? (m.count / totalReqs) * 100 : 0;
              return (
                <div key={m.model} className="flex items-center gap-3">
                  <span className="text-description w-40 shrink-0 truncate text-xs font-medium">
                    {m.model}
                  </span>
                  <div className="bg-secondary relative h-3 flex-1 overflow-hidden rounded-full">
                    <div
                      className="bg-primary/70 absolute inset-y-0 left-0 rounded-full transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <span className="text-foreground w-12 shrink-0 text-right text-xs">
                    {m.count} ({Math.round(pct)}%)
                  </span>
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}
