import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { UnderlineTabs } from "../../components/ui/UnderlineTabs";
import { useProxyApi } from "../../hooks/useProxyApi";
import { ROUTES } from "../../util/navigation";

interface UserUsage {
  userId: number;
  name: string;
  email: string;
  role: string;
  totalRequests: number;
  totalTokens: number;
  totalCost: number;
  blockedCount: number;
  redactedCount: number;
  lastActive: number | string;
}

interface TeamStats {
  totalUsers: number;
  totalRequests: number;
  totalBlocked: number;
  totalRedacted: number;
  totalCost: number;
}

interface AdminUser {
  id: number;
  name: string;
  email: string;
  role: string;
  created_at: string;
  updated_at?: string;
}

interface UsageSummary {
  totalCost: number;
  totalTokens: number;
  totalRequests: number;
}

interface StatsResponse {
  total: number;
  blocked: number;
  redacted: number;
  allowed: number;
}

const PROXY_URL = "http://localhost:8080";

function TeamDashboard() {
  const navigate = useNavigate();
  const api = useProxyApi();
  const [users, setUsers] = useState<UserUsage[]>([]);
  const [stats, setStats] = useState<TeamStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"overview" | "members" | "models">(
    "overview",
  );

  const fetchData = useCallback(async () => {
    try {
      // Fetch users
      const usersData = await api.get<AdminUser[]>("/api/admin/users");
      // Fetch usage summary
      const usageSummary = await api.get<UsageSummary>("/api/usage/summary");
      // Fetch stats
      const statsData = await api.get<StatsResponse>("/api/stats");

      const mapped: UserUsage[] = (usersData ?? []).map((u) => ({
        userId: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        totalRequests: 0,
        totalTokens: 0,
        totalCost: 0,
        blockedCount: 0,
        redactedCount: 0,
        lastActive: u.updated_at || u.created_at,
      }));
      setUsers(mapped);

      setStats({
        totalUsers: mapped.length,
        totalRequests: statsData?.total ?? 0,
        totalBlocked: statsData?.blocked ?? 0,
        totalRedacted: statsData?.redacted ?? 0,
        totalCost: usageSummary?.totalCost ?? 0,
      });
    } catch {
      setError("Could not reach AI Firewall proxy");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    fetchData();
  }, []);

  const tabs = [
    { id: "overview" as const, label: "Overview" },
    { id: "members" as const, label: "Members" },
    { id: "models" as const, label: "Model Rules" },
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
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
        </div>
        <div>
          <h1 className="text-lg font-semibold text-foreground">
            Team Dashboard
          </h1>
          <p className="text-xs text-description">
            Organization-wide usage, risks, and compliance
          </p>
        </div>
      </div>

      {error && (
        <div className="bg-error/5 border border-error/30 rounded-lg px-3 py-2 text-sm text-error">
          {error}
        </div>
      )}

      {loading && (
        <div className="p-4 text-xs text-description">Loading team data...</div>
      )}

      {/* Tabs */}
      <UnderlineTabs
        tabs={tabs}
        activeTab={activeTab}
        onTabClick={(id) => setActiveTab(id as typeof activeTab)}
      />

      {/* Overview */}
      {activeTab === "overview" && stats && (
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-secondary-background rounded-lg p-4">
            <p className="text-xs text-description mb-1">Team Size</p>
            <p className="text-2xl font-bold text-foreground">
              {stats.totalUsers}
            </p>
          </div>
          <div className="bg-secondary-background rounded-lg p-4">
            <p className="text-xs text-description mb-1">Total Requests</p>
            <p className="text-2xl font-bold text-foreground">
              {stats.totalRequests.toLocaleString()}
            </p>
          </div>
          <div className="bg-secondary-background rounded-lg p-4">
            <p className="text-xs text-description mb-1">Blocked</p>
            <p className="text-2xl font-bold text-error">
              {stats.totalBlocked.toLocaleString()}
            </p>
          </div>
          <div className="bg-secondary-background rounded-lg p-4">
            <p className="text-xs text-description mb-1">Redacted</p>
            <p className="text-2xl font-bold text-warning">
              {stats.totalRedacted.toLocaleString()}
            </p>
          </div>
          <div className="col-span-2 bg-secondary-background rounded-lg p-4">
            <p className="text-xs text-description mb-1">Total Spend</p>
            <p className="text-2xl font-bold text-foreground">
              ${stats.totalCost.toFixed(2)}
            </p>
          </div>
          <div className="col-span-2 bg-secondary-background rounded-lg p-4">
            <p className="text-xs text-description mb-2">Security Score</p>
            <div className="flex items-center gap-3">
              <div className="flex-1 h-3 bg-background rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full bg-success transition-all"
                  style={{
                    width: `${stats.totalRequests > 0 ? Math.round(((stats.totalRequests - stats.totalBlocked) / stats.totalRequests) * 100) : 100}%`,
                  }}
                />
              </div>
              <span className="text-sm font-mono text-foreground">
                {stats.totalRequests > 0
                  ? Math.round(
                      ((stats.totalRequests - stats.totalBlocked) /
                        stats.totalRequests) *
                        100,
                    )
                  : 100}
                % clean
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Members */}
      {activeTab === "members" && (
        <div className="flex flex-col gap-2">
          {users.length === 0 ? (
            <p className="text-sm text-description text-center py-8">
              No team members found.
            </p>
          ) : (
            users.map((u) => (
              <div
                key={u.userId}
                className="flex items-center gap-3 bg-secondary-background rounded-lg px-4 py-3"
              >
                <div className="w-8 h-8 rounded-full bg-background flex items-center justify-center text-sm font-medium text-foreground">
                  {u.name?.[0]?.toUpperCase() ?? "?"}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    {u.name}
                  </p>
                  <p className="text-xs text-description">{u.email}</p>
                </div>
                <span
                  className={`px-2 py-0.5 rounded text-xs font-medium ${
                    {
                      admin: "bg-badge text-badge-foreground",
                      security_lead: "bg-info/15 text-info",
                      developer: "bg-success/15 text-success",
                      auditor: "bg-warning/15 text-warning",
                    }[u.role] ?? "bg-secondary text-description-muted"
                  }`}
                >
                  {u.role}
                </span>
              </div>
            ))
          )}
        </div>
      )}

      {/* Model Rules */}
      {activeTab === "models" && (
        <div className="text-sm text-description text-center py-8">
          <p className="mb-2">
            Model allow/deny rules are configured via the proxy API.
          </p>
          <p className="text-xs text-description-muted">
            POST /api/orgs/:id/model-rules to add allow/deny patterns.
          </p>
        </div>
      )}
    </div>
  );
}

export default TeamDashboard;
