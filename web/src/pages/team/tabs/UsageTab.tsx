import { useEffect, useState } from "react";
import { ChartBarIcon } from "@heroicons/react/24/outline";
import { apiClient } from "../../../api/client";
import { Card } from "../../../components/ui/Card";
import { DataTable } from "../../../components/ui/DataTable";
import { LoadingSpinner } from "../../../components/ui/LoadingSpinner";
import { ErrorBanner } from "../../../components/ui/ErrorBanner";
import { EmptyState } from "../../../components/ui/EmptyState";

export interface UserUsage {
  userId: string;
  name: string;
  requests: number;
  tokens: number;
  cost: number;
}

export function UsageTab() {
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
      render: (_value: unknown, row: Record<string, unknown>) => `$${Number(row.cost).toFixed(4)}`,
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
