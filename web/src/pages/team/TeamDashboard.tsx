import { useEffect, useState } from "react";
import {
  UsersIcon,
  ShieldCheckIcon,
  CurrencyDollarIcon,
  ChartBarIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import { apiClient } from "../../api/client";
import { useAppDispatch } from "../../store/hooks";
import { showToast } from "../../store/slices/uiSlice";
import type { User } from "../../api/types";
import { UnderlineTabs } from "../../components/ui/UnderlineTabs";
import { Card } from "../../components/ui/Card";
import { StatCard } from "../../components/ui/StatCard";
import { Badge } from "../../components/ui/Badge";
import { Avatar } from "../../components/ui/Avatar";
import { Button } from "../../components/ui/Button";
import { DataTable } from "../../components/ui/DataTable";
import { LoadingSpinner } from "../../components/ui/LoadingSpinner";
import { ErrorBanner } from "../../components/ui/ErrorBanner";
import { EmptyState } from "../../components/ui/EmptyState";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";

const tabs = [
  { id: "overview", label: "Overview" },
  { id: "members", label: "Members" },
  { id: "usage", label: "Usage" },
];

const ROLES = ["admin", "security_lead", "developer", "auditor"] as const;

const roleVariant: Record<string, "error" | "warning" | "info" | "default"> = {
  admin: "error",
  security_lead: "warning",
  developer: "info",
  auditor: "default",
};

interface TeamStats {
  totalScanned: number;
  blocked: number;
  redacted: number;
  allowed: number;
  avgRiskScore: number;
}

interface UsageSummary {
  totalRequests: number;
  totalTokens: number;
  totalCost: number;
}

interface UserUsage {
  userId: string;
  name: string;
  requests: number;
  tokens: number;
  cost: number;
}

export function TeamDashboard() {
  const [activeTab, setActiveTab] = useState("overview");

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-foreground text-2xl font-bold">Team</h1>
      <UnderlineTabs
        tabs={tabs}
        activeTab={activeTab}
        onChange={setActiveTab}
      />

      {activeTab === "overview" && <OverviewTab />}
      {activeTab === "members" && <MembersTab />}
      {activeTab === "usage" && <UsageTab />}
    </div>
  );
}

/* ──────────── Overview Tab ──────────── */

function OverviewTab() {
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
      <StatCard
        label="Team Size"
        value={members.length}
        icon={<UsersIcon className="h-5 w-5" />}
      />
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
      <StatCard
        label="Redacted"
        value={stats?.redacted.toLocaleString() ?? "0"}
      />
      <StatCard
        label="Total Spend"
        value={usage ? `$${usage.totalCost.toFixed(2)}` : "$0.00"}
        icon={<CurrencyDollarIcon className="h-5 w-5" />}
      />
      <StatCard
        label="Security Score"
        value={
          stats
            ? `${Math.max(0, 100 - (stats.avgRiskScore ?? 0)).toFixed(0)}/100`
            : "N/A"
        }
        icon={<ShieldCheckIcon className="h-5 w-5" />}
      />
    </div>
  );
}

/* ──────────── Members Tab ──────────── */

function MembersTab() {
  const dispatch = useAppDispatch();
  const [members, setMembers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<User | null>(null);

  useEffect(() => {
    loadMembers();
  }, []);

  async function loadMembers() {
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.get<{ users: User[] } | User[]>(
        "/api/admin/users",
      );
      setMembers(Array.isArray(data) ? data : data.users);
    } catch (err: unknown) {
      if (err instanceof Error) setError(err.message);
      else setError("Failed to load team members");
    } finally {
      setLoading(false);
    }
  }

  async function changeRole(userId: string, role: string) {
    try {
      await apiClient.put(`/api/admin/users/${userId}/role`, { role });
      setMembers((prev) =>
        prev.map((u) =>
          u.id === userId ? { ...u, role: role as User["role"] } : u,
        ),
      );
      dispatch(
        showToast({
          id: `tr-${Date.now()}`,
          type: "success",
          message: "Role updated",
        }),
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to change role";
      dispatch(
        showToast({ id: `tr-err-${Date.now()}`, type: "error", message: msg }),
      );
    }
  }

  async function handleRemove(user: User) {
    try {
      await apiClient.del(`/api/admin/users/${user.id}`);
      setMembers((prev) => prev.filter((u) => u.id !== user.id));
      dispatch(
        showToast({
          id: `rm-${Date.now()}`,
          type: "success",
          message: `${user.name} removed`,
        }),
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to remove user";
      dispatch(
        showToast({ id: `rm-err-${Date.now()}`, type: "error", message: msg }),
      );
    }
    setRemoveTarget(null);
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (error) return <ErrorBanner message={error} />;

  if (members.length === 0) {
    return (
      <EmptyState
        icon={<UsersIcon className="h-12 w-12" />}
        title="No team members"
        description="Invite members to your team."
      />
    );
  }

  return (
    <>
      <div className="space-y-2">
        {members.map((m) => (
          <Card key={m.id} className="flex items-center gap-3">
            <Avatar name={m.name || m.email} />
            <div className="min-w-0 flex-1">
              <p className="text-foreground truncate text-sm font-medium">
                {m.name}
              </p>
              <p className="text-description truncate text-xs">{m.email}</p>
            </div>
            <select
              value={m.role}
              onChange={(e) => changeRole(m.id, e.target.value)}
              className="border-input-border bg-input text-input-foreground focus:border-border-focus focus:ring-border-focus rounded-md border px-2 py-1 text-xs focus:outline-none focus:ring-1"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r.replace("_", " ")}
                </option>
              ))}
            </select>
            <Badge variant={roleVariant[m.role] ?? "default"}>
              {m.role.replace("_", " ")}
            </Badge>
            <Button
              variant="icon"
              onClick={() => setRemoveTarget(m)}
              aria-label={`Remove ${m.name}`}
            >
              <TrashIcon className="text-error h-4 w-4" />
            </Button>
          </Card>
        ))}
      </div>

      <ConfirmDialog
        open={removeTarget !== null}
        onClose={() => setRemoveTarget(null)}
        onConfirm={() => removeTarget && handleRemove(removeTarget)}
        title="Remove Member"
        message={`Are you sure you want to remove ${removeTarget?.name} from the team?`}
        confirmLabel="Remove"
        variant="danger"
      />
    </>
  );
}

/* ──────────── Usage Tab ──────────── */

function UsageTab() {
  const [userUsage, setUserUsage] = useState<UserUsage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const data = await apiClient.get<{ byUser: UserUsage[] } | UserUsage[]>(
          "/api/usage/by-user",
        );
        setUserUsage(Array.isArray(data) ? data : data.byUser);
      } catch {
        // Endpoint may not exist yet
        setUserUsage([]);
      } finally {
        setLoading(false);
      }
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

  if (error) return <ErrorBanner message={error} />;

  if (userUsage.length === 0) {
    return (
      <EmptyState
        icon={<ChartBarIcon className="h-12 w-12" />}
        title="No usage data"
        description="Per-user usage data will appear here once activity is recorded."
      />
    );
  }

  const columns = [
    {
      key: "name",
      label: "User",
      sortable: true,
      render: (_value: unknown, row: Record<string, unknown>) => (
        <span className="font-medium">{String(row.name)}</span>
      ),
    },
    {
      key: "requests",
      label: "Requests",
      sortable: true,
      render: (_value: unknown, row: Record<string, unknown>) =>
        Number(row.requests).toLocaleString(),
    },
    {
      key: "tokens",
      label: "Tokens",
      sortable: true,
      render: (_value: unknown, row: Record<string, unknown>) =>
        Number(row.tokens).toLocaleString(),
    },
    {
      key: "cost",
      label: "Cost",
      sortable: true,
      render: (_value: unknown, row: Record<string, unknown>) =>
        `$${Number(row.cost).toFixed(4)}`,
    },
  ];

  return (
    <Card padding={false}>
      <DataTable
        columns={columns}
        data={userUsage as unknown as Record<string, unknown>[]}
        emptyMessage="No usage data available"
      />
    </Card>
  );
}
