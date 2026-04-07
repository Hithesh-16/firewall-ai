import { useState, useEffect } from "react";
import { apiClient } from "../../api/client";
import { Card } from "../../components/ui/Card";
import { StatCard } from "../../components/ui/StatCard";
import { LoadingSpinner } from "../../components/ui/LoadingSpinner";
import { ErrorBanner } from "../../components/ui/ErrorBanner";
import { DataTable } from "../../components/ui/DataTable";
import { formatCost, formatTokens } from "../../utils/format";
import { ChartBarIcon } from "@heroicons/react/24/outline";

interface UsageSummary {
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
  byModel?: {
    model: string;
    requests: number;
    inputTokens: number;
    outputTokens: number;
    cost: number;
  }[];
}

interface CreditLimit {
  providerId: string;
  providerName: string;
  maxRequests?: number;
  maxTokens?: number;
  maxDollars?: number;
  usedRequests: number;
  usedTokens: number;
  usedDollars: number;
}

export function UsagePage() {
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [credits, setCredits] = useState<CreditLimit[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [usageRes, creditRes] = await Promise.allSettled([
          apiClient.get<UsageSummary>("/api/usage/summary"),
          apiClient.get<{ credits: CreditLimit[] } | CreditLimit[]>("/api/credits"),
        ]);
        if (usageRes.status === "fulfilled") setSummary(usageRes.value);
        if (creditRes.status === "fulfilled") {
          const val = creditRes.value;
          setCredits(Array.isArray(val) ? val : (val.credits ?? []));
        }
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <LoadingSpinner />
      </div>
    );
  }

  const totalTokens = (summary?.totalInputTokens ?? 0) + (summary?.totalOutputTokens ?? 0);

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center gap-3">
        <ChartBarIcon className="text-primary h-6 w-6" />
        <h1 className="text-foreground text-xl font-semibold">Usage & Billing</h1>
      </div>

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total Requests" value={String(summary?.totalRequests ?? 0)} />
        <StatCard label="Total Tokens" value={formatTokens(totalTokens)} />
        <StatCard label="Total Cost" value={formatCost(summary?.totalCost ?? 0)} />
        <StatCard
          label="Avg Cost/Request"
          value={
            summary && summary.totalRequests > 0
              ? formatCost(summary.totalCost / summary.totalRequests)
              : "$0"
          }
        />
      </div>

      {summary?.byModel && summary.byModel.length > 0 && (
        <div className="mb-8">
          <h2 className="text-foreground mb-3 font-medium">Usage by Model</h2>
          <DataTable
            columns={[
              { key: "model", label: "Model", sortable: true },
              {
                key: "requests",
                label: "Requests",
                sortable: true,
                render: (v) => String(v ?? 0),
              },
              {
                key: "inputTokens",
                label: "Input Tokens",
                sortable: true,
                render: (v) => formatTokens(Number(v ?? 0)),
              },
              {
                key: "outputTokens",
                label: "Output Tokens",
                sortable: true,
                render: (v) => formatTokens(Number(v ?? 0)),
              },
              {
                key: "cost",
                label: "Cost",
                sortable: true,
                render: (v) => formatCost(Number(v ?? 0)),
              },
            ]}
            data={summary.byModel}
            emptyMessage="No model usage data"
          />
        </div>
      )}

      {credits.length > 0 && (
        <div>
          <h2 className="text-foreground mb-3 font-medium">Credit Limits</h2>
          <div className="space-y-3">
            {credits.map((c) => {
              const pctDollars = c.maxDollars
                ? Math.min(100, (c.usedDollars / c.maxDollars) * 100)
                : 0;
              const barColor =
                pctDollars >= 90 ? "bg-error" : pctDollars >= 70 ? "bg-warning" : "bg-success";
              return (
                <Card key={c.providerId}>
                  <div className="flex items-center justify-between">
                    <span className="text-foreground font-medium">{c.providerName}</span>
                    <span className="text-description text-sm">
                      {formatCost(c.usedDollars)} /{" "}
                      {c.maxDollars ? formatCost(c.maxDollars) : "Unlimited"}
                    </span>
                  </div>
                  {c.maxDollars && (
                    <div className="bg-secondary mt-2 h-2 rounded-full">
                      <div
                        className={`h-2 rounded-full ${barColor}`}
                        style={{ width: `${pctDollars}%` }}
                      />
                    </div>
                  )}
                  <div className="text-description-muted mt-2 flex gap-4 text-xs">
                    <span>
                      Requests: {c.usedRequests}
                      {c.maxRequests ? ` / ${c.maxRequests}` : ""}
                    </span>
                    <span>
                      Tokens: {formatTokens(c.usedTokens)}
                      {c.maxTokens ? ` / ${formatTokens(c.maxTokens)}` : ""}
                    </span>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
