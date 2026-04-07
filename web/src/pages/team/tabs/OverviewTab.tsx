import { useEffect, useState } from "react";
import {
  UsersIcon,
  ShieldCheckIcon,
  CurrencyDollarIcon,
  ChartBarIcon,
} from "@heroicons/react/24/outline";
import { apiClient } from "../../../api/client";
import type { User } from "../../../api/types";
import { StatCard } from "../../../components/ui/StatCard";
import { LoadingSpinner } from "../../../components/ui/LoadingSpinner";

export interface TeamStats {
  totalScanned: number;
  blocked: number;
  redacted: number;
  allowed: number;
  avgRiskScore: number;
}

export interface UsageSummary {
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
        apiClient.get<User[]>("/api/admin/users"),
        apiClient.get<TeamStats>("/api/stats"),
        apiClient.get<UsageSummary>("/api/usage/summary"),
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

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
      <StatCard label="Team Size" value={members.length} icon={<UsersIcon className="h-5 w-5" />} />
      <StatCard
        label="Total Requests"
        value={usage?.totalRequests.toLocaleString() ?? "0"}
        icon={<ChartBarIcon className="h-5 w-5" />}
      />
      <StatCard
        label="Blocked"
        value={stats?.blocked.toLocaleString() ?? "0"}
        icon={<ShieldCheckIcon className="h-5 w-5" />}
      />
      <StatCard label="Redacted" value={stats?.redacted.toLocaleString() ?? "0"} />
      <StatCard
        label="Total Spend"
        value={usage ? `$${usage.totalCost.toFixed(2)}` : "$0.00"}
        icon={<CurrencyDollarIcon className="h-5 w-5" />}
      />
      <StatCard
        label="Security Score"
        value={stats ? `${Math.max(0, 100 - (stats.avgRiskScore ?? 0)).toFixed(0)}/100` : "N/A"}
        icon={<ShieldCheckIcon className="h-5 w-5" />}
      />
    </div>
  );
}
