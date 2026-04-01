import { useEffect, useState } from "react";
import { useProxyApi } from "../../hooks/useProxyApi";

interface CreditInfo {
  id: number;
  provider_id: number;
  provider_name: string;
  limit_type: string;
  max_value: number;
  used: number;
  reset_interval: string;
  last_reset: string;
}

interface UsageSummary {
  totalRequests: number;
  totalTokens: number;
  totalCost: number;
  byModel: Array<{
    model: string;
    requests: number;
    tokens: number;
    cost: number;
  }>;
}

function ProgressBar({ used, max, color }: { used: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min((used / max) * 100, 100) : 0;
  return (
    <div className="h-2 w-full rounded-full bg-background">
      <div
        className={`h-2 rounded-full ${color}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function CreditsTab() {
  const api = useProxyApi();
  const [credits, setCredits] = useState<CreditInfo[]>([]);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      api.get<{ credits?: CreditInfo[] }>("/api/credits")
        .catch((err) => { console.error("Failed to fetch credits", err); setError("Could not load credit data"); return { credits: [] }; }),
      api.get<UsageSummary>("/api/usage/summary")
        .catch((err) => { console.error("Failed to fetch usage summary", err); setError("Could not load credit data"); return null; }),
    ]).then(([creditsData, usageData]) => {
      setCredits(creditsData?.credits ?? []);
      setUsage(usageData);
      setLoading(false);
    });
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-xs text-description animate-pulse">Loading credits...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-error/5 border border-error/30 rounded-lg px-3 py-2 text-sm text-error">
          {error}
        </div>
      )}

      {/* Usage summary */}
      {usage && (
        <div className="rounded-lg border border-border p-3">
          <h3 className="mb-2 text-xs font-semibold text-foreground">Usage Summary</h3>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div className="rounded bg-background p-2 text-center">
              <div className="font-bold text-foreground">{usage.totalRequests}</div>
              <div className="text-description">Requests</div>
            </div>
            <div className="rounded bg-background p-2 text-center">
              <div className="font-bold text-foreground">
                {(usage.totalTokens / 1000).toFixed(1)}k
              </div>
              <div className="text-description">Tokens</div>
            </div>
            <div className="rounded bg-background p-2 text-center">
              <div className="font-bold text-foreground">
                ${usage.totalCost.toFixed(4)}
              </div>
              <div className="text-description">Cost</div>
            </div>
          </div>
        </div>
      )}

      {/* Credit limits */}
      {credits.length > 0 ? (
        <div className="rounded-lg border border-border p-3">
          <h3 className="mb-2 text-xs font-semibold text-foreground">Credit Limits</h3>
          <div className="space-y-3">
            {credits.map((c) => {
              const pct = c.max_value > 0 ? (c.used / c.max_value) * 100 : 0;
              const barColor =
                pct >= 90 ? "bg-error" : pct >= 70 ? "bg-warning" : "bg-success";
              return (
                <div key={c.id}>
                  <div className="mb-1 flex items-center justify-between text-xs">
                    <span className="text-foreground">{c.provider_name}</span>
                    <span className="text-description">
                      {c.used.toLocaleString()} / {c.max_value.toLocaleString()} {c.limit_type}
                    </span>
                  </div>
                  <ProgressBar used={c.used} max={c.max_value} color={barColor} />
                  <div className="mt-0.5 text-[10px] text-description">
                    Resets: {c.reset_interval}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="rounded-lg border border-border p-4 text-center">
          <p className="text-xs text-foreground">No credit limits configured</p>
          <p className="text-xs text-description-muted mt-1">
            Use the proxy API to add limits per provider.
          </p>
        </div>
      )}

      {/* Usage by model */}
      {usage?.byModel && usage.byModel.length > 0 && (
        <div className="rounded-lg border border-border p-3">
          <h3 className="mb-2 text-xs font-semibold text-foreground">By Model</h3>
          <div className="space-y-1">
            {usage.byModel.map((m) => (
              <div
                key={m.model}
                className="flex items-center justify-between rounded bg-background px-2 py-1.5 text-xs"
              >
                <span className="font-medium text-foreground">{m.model}</span>
                <span className="text-description">
                  {m.requests} req &middot; {(m.tokens / 1000).toFixed(1)}k tok &middot; ${m.cost.toFixed(4)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
