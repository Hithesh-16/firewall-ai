import { useEffect, useState } from "react";
import { ChartBarIcon } from "@heroicons/react/24/outline";
import { apiClient } from "../../../api/client";
import { Card } from "../../../components/ui/Card";
import { DataTable } from "../../../components/ui/DataTable";
import { Badge } from "../../../components/ui/Badge";
import { LoadingSpinner } from "../../../components/ui/LoadingSpinner";
import { ErrorBanner } from "../../../components/ui/ErrorBanner";
import { EmptyState } from "../../../components/ui/EmptyState";

interface UserUsage {
  userId: string | number;
  name?: string;
  requests: number;
  tokens: number;
  cost: number;
}

interface UserScanStats {
  userId: number;
  total: number;
  blocked: number;
  redacted: number;
  allowed: number;
  avgRiskScore: number;
  totalSecrets: number;
  totalPii: number;
}

interface MergedUserRow {
  userId: string | number;
  name: string;
  requests: number;
  tokens: number;
  cost: number;
  blocked: number;
  redacted: number;
  secrets: number;
  pii: number;
}

export function UsageTab() {
  const [rows, setRows] = useState<MergedUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [usageRes, scanRes] = await Promise.allSettled([
          apiClient.get<{ byUser: UserUsage[] } | UserUsage[]>("/api/usage/by-user"),
          apiClient.get<{ users: UserScanStats[] }>("/api/stats/per-user"),
        ]);

        const usageData: UserUsage[] =
          usageRes.status === "fulfilled"
            ? Array.isArray(usageRes.value)
              ? usageRes.value
              : usageRes.value.byUser
            : [];

        const scanData: UserScanStats[] = scanRes.status === "fulfilled" ? scanRes.value.users : [];

        // Build a map by userId
        const scanMap = new Map<number, UserScanStats>();
        for (const s of scanData) {
          if (s.userId != null) scanMap.set(s.userId, s);
        }

        // Merge usage + scan data
        const merged: MergedUserRow[] = usageData.map((u) => {
          const scan = scanMap.get(Number(u.userId));
          return {
            userId: u.userId,
            name: u.name ?? `User ${u.userId}`,
            requests: u.requests,
            tokens: u.tokens,
            cost: u.cost,
            blocked: scan?.blocked ?? 0,
            redacted: scan?.redacted ?? 0,
            secrets: scan?.totalSecrets ?? 0,
            pii: scan?.totalPii ?? 0,
          };
        });

        // Add users that have scan data but no usage data
        for (const [uid, scan] of scanMap) {
          if (!merged.some((m) => Number(m.userId) === uid)) {
            merged.push({
              userId: uid,
              name: `User ${uid}`,
              requests: scan.total,
              tokens: 0,
              cost: 0,
              blocked: scan.blocked,
              redacted: scan.redacted,
              secrets: scan.totalSecrets,
              pii: scan.totalPii,
            });
          }
        }

        setRows(merged);
      } catch {
        setRows([]);
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

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<ChartBarIcon className="h-12 w-12" />}
        title="No usage data"
        description="Per-user usage and security data will appear here once activity is recorded."
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
      key: "blocked",
      label: "Blocked",
      sortable: true,
      render: (_value: unknown, row: Record<string, unknown>) => {
        const v = Number(row.blocked);
        return v > 0 ? (
          <Badge variant="error">{v}</Badge>
        ) : (
          <span className="text-description-muted">0</span>
        );
      },
    },
    {
      key: "redacted",
      label: "Redacted",
      sortable: true,
      render: (_value: unknown, row: Record<string, unknown>) => {
        const v = Number(row.redacted);
        return v > 0 ? (
          <Badge variant="warning">{v}</Badge>
        ) : (
          <span className="text-description-muted">0</span>
        );
      },
    },
    {
      key: "secrets",
      label: "Secrets",
      sortable: true,
      render: (_value: unknown, row: Record<string, unknown>) => {
        const v = Number(row.secrets);
        return v > 0 ? (
          <span className="text-error font-medium">{v}</span>
        ) : (
          <span className="text-description-muted">0</span>
        );
      },
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
      render: (_value: unknown, row: Record<string, unknown>) => `$${Number(row.cost).toFixed(4)}`,
    },
  ];

  return (
    <Card padding={false}>
      <DataTable
        columns={columns}
        data={rows as unknown as Record<string, unknown>[]}
        emptyMessage="No usage data available"
      />
    </Card>
  );
}
