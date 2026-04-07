import { StatCard } from "../../../components/ui/StatCard";
import { Card } from "../../../components/ui/Card";
import { EmptyState } from "../../../components/ui/EmptyState";
import { cn } from "../../../utils/cn";

export interface CreditData {
  id: string;
  provider: string;
  maxRequests?: number;
  maxTokens?: number;
  maxDollars?: number;
  usedRequests: number;
  usedTokens: number;
  usedDollars: number;
}

export interface UsageSummary {
  totalRequests: number;
  totalTokens: number;
  totalCost: number;
}

function pct(used: number, max: number | undefined): number {
  if (!max || max === 0) return 0;
  return Math.min(100, Math.round((used / max) * 100));
}

function barColor(percent: number): string {
  if (percent >= 90) return "bg-error";
  if (percent >= 70) return "bg-warning";
  return "bg-success";
}

export function CreditsTab({
  credits,
  usage,
}: {
  credits: CreditData[];
  usage: UsageSummary | null;
}) {
  return (
    <div className="space-y-6">
      {usage && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard label="Total Requests" value={usage.totalRequests.toLocaleString()} />
          <StatCard label="Total Tokens" value={usage.totalTokens.toLocaleString()} />
          <StatCard label="Total Cost" value={`$${usage.totalCost.toFixed(4)}`} />
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
                <h4 className="text-foreground mb-3 font-medium">{c.provider}</h4>
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
