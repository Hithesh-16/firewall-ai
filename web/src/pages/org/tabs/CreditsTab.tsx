import { useEffect, useState } from "react";
import { apiClient } from "../../../api/client";
import { ENDPOINTS } from "../../../api/endpoints";
import { cn } from "../../../utils/cn";
import { Card } from "../../../components/ui/Card";
import { StatCard } from "../../../components/ui/StatCard";
import { LoadingSpinner } from "../../../components/ui/LoadingSpinner";

interface UsageSummary {
  totalRequests: number;
  totalTokens: number;
  totalCost: number;
}

interface CreditLimit {
  id: string;
  provider: string;
  maxRequests?: number;
  maxTokens?: number;
  maxDollars?: number;
  usedRequests: number;
  usedTokens: number;
  usedDollars: number;
}

export function CreditsTab() {
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [credits, setCredits] = useState<CreditLimit[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const [u, c] = await Promise.allSettled([
        apiClient.get<UsageSummary>(ENDPOINTS.usageSummary),
        apiClient.get<CreditLimit[]>(ENDPOINTS.credits),
      ]);
      if (u.status === "fulfilled") setUsage(u.value);
      if (c.status === "fulfilled") setCredits(c.value);
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
    <div className="space-y-6">
      {usage && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard label="Total Requests" value={usage.totalRequests.toLocaleString()} />
          <StatCard label="Total Tokens" value={usage.totalTokens.toLocaleString()} />
          <StatCard label="Total Cost" value={`$${usage.totalCost.toFixed(4)}`} />
        </div>
      )}

      {credits.length > 0 && (
        <div className="space-y-3">
          {credits.map((c) => {
            const pct =
              c.maxDollars && c.maxDollars > 0
                ? Math.min(100, Math.round((c.usedDollars / c.maxDollars) * 100))
                : 0;
            const color = pct >= 90 ? "bg-error" : pct >= 70 ? "bg-warning" : "bg-success";

            return (
              <Card key={c.id}>
                <div className="mb-2 flex justify-between text-sm">
                  <span className="text-foreground font-medium">{c.provider}</span>
                  <span className="text-description">
                    ${c.usedDollars.toFixed(2)} / ${(c.maxDollars ?? 0).toFixed(2)}
                  </span>
                </div>
                <div className="bg-secondary h-2 w-full overflow-hidden rounded-full">
                  <div
                    className={cn("h-full rounded-full transition-all", color)}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
