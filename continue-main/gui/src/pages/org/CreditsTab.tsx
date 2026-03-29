import { useCallback, useEffect, useState } from "react";
import { useProxyApi } from "../../hooks/useProxyApi";

interface CreditLimit {
  id: number;
  provider_id: number;
  model_id: number | null;
  limit_type: "requests" | "tokens" | "dollars";
  total_limit: number;
  used_amount: number;
  reset_period: "daily" | "weekly" | "monthly";
  hard_limit: number;
}

interface Provider {
  id: number;
  name: string;
  slug: string;
}

export function CreditsTab() {
  const api = useProxyApi();
  const [credits, setCredits] = useState<CreditLimit[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState(false);

  // Form state
  const [formProvider, setFormProvider] = useState<number>(0);
  const [formType, setFormType] = useState<string>("tokens");
  const [formLimit, setFormLimit] = useState("100000");
  const [formPeriod, setFormPeriod] = useState<string>("monthly");
  const [formHard, setFormHard] = useState(true);

  const fetchCredits = useCallback(async () => {
    try {
      const data = await api.get<CreditLimit[]>("/api/credits");
      setCredits(data);
    } catch {
      setError("Could not reach AI Firewall proxy");
    }
  }, [api]);

  const fetchProviders = useCallback(async () => {
    try {
      const data = await api.get<Provider[]>("/api/providers");
      setProviders(data);
      if (data.length > 0) setFormProvider(data[0].id);
    } catch {
      setError("Could not reach AI Firewall proxy");
    }
  }, [api]);

  useEffect(() => {
    Promise.all([fetchCredits(), fetchProviders()]).finally(() => setLoading(false));
  }, []);

  const handleAdd = async () => {
    setError(null);
    setMutating(true);
    try {
      await api.post("/api/credits", {
        providerId: formProvider,
        limitType: formType,
        totalLimit: parseFloat(formLimit),
        resetPeriod: formPeriod,
        hardLimit: formHard,
      });
      setShowAdd(false);
      await fetchCredits();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setMutating(false);
    }
  };

  const handleDelete = async (id: number) => {
    setMutating(true);
    try {
      await api.del(`/api/credits/${id}`);
      await fetchCredits();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setMutating(false);
    }
  };

  const providerName = (id: number) =>
    providers.find((p) => p.id === id)?.name ?? `#${id}`;

  if (loading) {
    return <div className="p-4 text-sm text-description">Loading credits...</div>;
  }

  return (
    <div className={`flex flex-col gap-3 ${mutating ? "opacity-60 pointer-events-none" : ""}`}>
      {error && (
        <div className="bg-error/5 border border-error/30 rounded-lg px-3 py-2 text-sm text-error">
          {error}
        </div>
      )}

      {credits.length === 0 ? (
        <p className="text-sm text-description text-center py-6">
          No credit limits configured. Add one to enforce usage budgets.
        </p>
      ) : (
        credits.map((c) => {
          const pct = c.total_limit > 0 ? (c.used_amount / c.total_limit) * 100 : 0;
          const barColor =
            pct > 90 ? "bg-error" : pct > 70 ? "bg-warning" : "bg-success";

          return (
            <div key={c.id} className="bg-secondary-background rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {providerName(c.provider_id)}
                  </p>
                  <p className="text-xs text-description">
                    {c.limit_type} &middot; {c.reset_period} reset
                    {c.hard_limit ? " \u00B7 hard limit" : " \u00B7 soft limit"}
                  </p>
                </div>
                <button
                  onClick={() => handleDelete(c.id)}
                  className="text-xs text-error hover:text-foreground focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:outline-none"
                >
                  Delete
                </button>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex-1 h-2 bg-background rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${barColor}`}
                    style={{ width: `${Math.min(pct, 100)}%` }}
                  />
                </div>
                <span className="text-xs font-mono text-foreground whitespace-nowrap">
                  {c.used_amount.toLocaleString()} / {c.total_limit.toLocaleString()}
                </span>
              </div>
            </div>
          );
        })
      )}

      {!showAdd ? (
        <button
          onClick={() => setShowAdd(true)}
          className="border border-dashed border-border rounded-lg px-4 py-3 text-sm text-description hover:text-foreground hover:border-border-focus transition-colors focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:outline-none"
        >
          + Add Credit Limit
        </button>
      ) : (
        <div className="bg-secondary-background rounded-lg p-4 flex flex-col gap-3">
          <p className="text-sm font-medium text-foreground">Add Credit Limit</p>

          <select
            className="bg-input-background text-input-foreground border border-input-border rounded px-2 py-1.5 text-sm"
            value={formProvider}
            onChange={(e) => setFormProvider(Number(e.target.value))}
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          <div className="flex gap-2">
            <select
              className="bg-input-background text-input-foreground border border-input-border rounded px-2 py-1.5 text-sm flex-1"
              value={formType}
              onChange={(e) => setFormType(e.target.value)}
            >
              <option value="tokens">Tokens</option>
              <option value="requests">Requests</option>
              <option value="dollars">Dollars</option>
            </select>
            <input
              className="bg-input-background text-input-foreground border border-input-border rounded px-2 py-1 text-sm flex-1"
              placeholder="Limit amount"
              value={formLimit}
              onChange={(e) => setFormLimit(e.target.value)}
            />
          </div>

          <div className="flex gap-2 items-center">
            <select
              className="bg-input-background text-input-foreground border border-input-border rounded px-2 py-1.5 text-sm flex-1"
              value={formPeriod}
              onChange={(e) => setFormPeriod(e.target.value)}
            >
              <option value="daily">Daily reset</option>
              <option value="weekly">Weekly reset</option>
              <option value="monthly">Monthly reset</option>
            </select>
            <label className="flex items-center gap-1.5 text-xs text-description">
              <input
                type="checkbox"
                checked={formHard}
                onChange={(e) => setFormHard(e.target.checked)}
                className="rounded"
              />
              Hard limit
            </label>
          </div>

          <div className="flex gap-2">
            <button
              onClick={handleAdd}
              className="bg-primary-background text-primary-foreground rounded px-3 py-1.5 text-sm hover:bg-primary-hover flex-1 focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:outline-none"
            >
              Save
            </button>
            <button
              onClick={() => setShowAdd(false)}
              className="bg-secondary-background text-description rounded px-3 py-1.5 text-sm hover:text-foreground border border-border focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:outline-none"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
