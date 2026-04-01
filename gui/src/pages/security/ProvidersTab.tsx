import { useEffect, useState } from "react";
import { useProxyApi } from "../../hooks/useProxyApi";

interface ProviderInfo {
  id: number;
  name: string;
  slug: string;
  base_url: string;
  enabled: boolean;
  created_at: string;
}

interface ModelInfo {
  id: number;
  provider_id: number;
  model_name: string;
  display_name: string;
  input_cost_per_1k: number;
  output_cost_per_1k: number;
}

export function ProvidersTab() {
  const api = useProxyApi();
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);
  const [formName, setFormName] = useState("");
  const [formKey, setFormKey] = useState("");
  const [formUrl, setFormUrl] = useState("");
  const [formError, setFormError] = useState("");

  async function fetchData() {
    try {
      const [pRes, mRes] = await Promise.all([
        api.get<{ providers?: ProviderInfo[] }>("/api/providers").catch(() => ({ providers: [] })),
        api.get<{ models?: ModelInfo[] }>("/api/models").catch(() => ({ models: [] })),
      ]);
      setProviders(pRes.providers ?? []);
      setModels(mRes.models ?? []);
    } catch (err) {
      console.error("Failed to fetch providers data", err);
      setFormError("Could not reach AI Firewall proxy");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchData();
  }, []);

  async function handleAdd() {
    setFormError("");
    if (!formName.trim()) {
      setFormError("Name is required");
      return;
    }
    try {
      await api.post("/api/providers", {
        name: formName.trim(),
        apiKey: formKey.trim() || undefined,
        baseUrl: formUrl.trim() || undefined,
      });
      setShowAddForm(false);
      setFormName("");
      setFormKey("");
      setFormUrl("");
      await fetchData();
    } catch (e: unknown) {
      console.error("Failed to add provider", e);
      setFormError(e instanceof Error ? e.message : "Failed to add provider");
    }
  }

  async function handleToggle(id: number, enabled: boolean) {
    try {
      await api.patch(`/api/providers/${id}`, { enabled: !enabled });
    } catch (err) {
      console.error("Failed to toggle provider", err);
      setFormError("Operation failed");
    }
    await fetchData();
  }

  async function handleDelete(id: number) {
    try {
      await api.del(`/api/providers/${id}`);
    } catch (err) {
      console.error("Failed to delete provider", err);
      setFormError("Operation failed");
    }
    await fetchData();
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="text-xs text-description animate-pulse">Loading providers...</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {formError && (
        <div className="bg-error/5 border border-error/30 rounded-lg px-3 py-2 text-sm text-error">
          {formError}
        </div>
      )}

      {/* Provider list */}
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold text-foreground">Providers ({providers.length})</h3>
        <a
          href="/config?tab=models"
          className="rounded bg-primary px-2 py-0.5 text-[10px] font-medium text-primary-foreground hover:bg-primary-hover no-underline focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:outline-none"
        >
          + Add via Settings
        </a>
      </div>

      {/* Provider cards */}
      {providers.length === 0 ? (
        <div className="rounded-lg border border-border p-4 text-center">
          <p className="text-xs text-foreground">No providers configured</p>
          <p className="text-xs text-description-muted mt-1">
            Add one to route requests through the gateway.
          </p>
        </div>
      ) : (
        providers.map((p) => {
          const providerModels = models.filter((m) => m.provider_id === p.id);
          return (
            <div key={p.id} className="rounded-lg border border-border p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div
                    className={`h-2 w-2 rounded-full ${p.enabled ? "bg-success" : "bg-description-muted"}`}
                  />
                  <span className="text-xs font-medium text-foreground">{p.name}</span>
                  <span className="text-[10px] text-description">{p.slug}</span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleToggle(p.id, p.enabled)}
                    className="rounded px-1.5 py-0.5 text-[10px] text-description border border-border hover:bg-background focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:outline-none"
                  >
                    {p.enabled ? "Disable" : "Enable"}
                  </button>
                  <button
                    onClick={() => handleDelete(p.id)}
                    className="rounded px-1.5 py-0.5 text-[10px] text-error border border-error/30 hover:bg-error/10 focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:outline-none"
                  >
                    Delete
                  </button>
                </div>
              </div>
              {p.base_url && (
                <div className="mt-1 text-[10px] text-description truncate">{p.base_url}</div>
              )}
              {providerModels.length > 0 && (
                <div className="mt-2 space-y-1">
                  {providerModels.map((m) => (
                    <div
                      key={m.id}
                      className="flex items-center justify-between rounded bg-background px-2 py-1 text-[10px]"
                    >
                      <span className="text-foreground">{m.display_name || m.model_name}</span>
                      <span className="text-description">
                        ${m.input_cost_per_1k}/1k in &middot; ${m.output_cost_per_1k}/1k out
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
