import { useCallback, useEffect, useState } from "react";
import { useProxyApi } from "../../hooks/useProxyApi";

interface Provider {
  id: number;
  name: string;
  slug: string;
  base_url: string;
  enabled: number;
  created_at: string;
}

interface Model {
  id: number;
  provider_id: number;
  model_name: string;
  display_name: string;
  input_cost_per_1k: number;
  output_cost_per_1k: number;
  enabled: number;
}

const PROVIDER_TYPES = [
  { slug: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1/chat/completions" },
  { slug: "anthropic", name: "Anthropic", baseUrl: "https://api.anthropic.com/v1/messages" },
  { slug: "google-gemini", name: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com" },
  { slug: "ollama", name: "Ollama (Local)", baseUrl: "http://localhost:11434/api/chat" },
  { slug: "custom", name: "Custom", baseUrl: "" },
];

export function ProvidersTab() {
  const api = useProxyApi();
  const [providers, setProviders] = useState<Provider[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [showAddModel, setShowAddModel] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState(false);

  // Model form state
  const [modelName, setModelName] = useState("");
  const [modelDisplay, setModelDisplay] = useState("");
  const [modelInputCost, setModelInputCost] = useState("0.003");
  const [modelOutputCost, setModelOutputCost] = useState("0.015");

  const fetchProviders = useCallback(async () => {
    try {
      const data = await api.get<Provider[]>("/api/providers");
      setProviders(data);
    } catch {
      setError("Could not reach AI Firewall proxy");
    }
  }, [api]);

  const fetchModels = useCallback(async () => {
    try {
      const data = await api.get<Model[]>("/api/models");
      setModels(data);
    } catch {
      setError("Could not reach AI Firewall proxy");
    }
  }, [api]);

  useEffect(() => {
    Promise.all([fetchProviders(), fetchModels()]).finally(() => setLoading(false));
  }, []);

  const handleDeleteProvider = async (id: number) => {
    setMutating(true);
    try {
      await api.del(`/api/providers/${id}`);
      await fetchProviders();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setMutating(false);
    }
  };

  const handleAddModel = async (providerId: number) => {
    setError(null);
    setMutating(true);
    try {
      await api.post(`/api/providers/${providerId}/models`, {
        modelName,
        displayName: modelDisplay || modelName,
        inputCostPer1k: parseFloat(modelInputCost),
        outputCostPer1k: parseFloat(modelOutputCost),
      });
      setShowAddModel(null);
      setModelName("");
      setModelDisplay("");
      await fetchModels();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setMutating(false);
    }
  };

  const handleDeleteModel = async (id: number) => {
    try {
      await api.del(`/api/models/${id}`);
      await fetchModels();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    }
  };

  if (loading) {
    return <div className="p-4 text-sm text-description">Loading providers...</div>;
  }

  return (
    <div className={`flex flex-col gap-3 ${mutating ? "opacity-60 pointer-events-none" : ""}`}>
      {error && (
        <div className="bg-error/5 border border-error/30 rounded-lg px-3 py-2 text-sm text-error">
          {error}
        </div>
      )}

      {/* Provider list */}
      {providers.map((p) => (
        <div key={p.id} className="bg-secondary-background rounded-lg p-3">
          <div className="flex items-center gap-3">
            <div
              className={`w-2 h-2 rounded-full flex-shrink-0 ${p.enabled ? "bg-success" : "bg-description-muted"}`}
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">{p.name}</p>
              <p className="text-xs text-description truncate">{p.base_url}</p>
            </div>
            <span className="text-xs text-description font-mono">{p.slug}</span>
            <button
              onClick={() =>
                setShowAddModel(showAddModel === p.id ? null : p.id)
              }
              className="text-xs text-link hover:underline focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:outline-none"
            >
              + Model
            </button>
            <button
              onClick={() => handleDeleteProvider(p.id)}
              className="text-xs text-error hover:text-foreground focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:outline-none"
            >
              Delete
            </button>
          </div>

          {/* Models for this provider */}
          {models.filter((m) => m.provider_id === p.id).length > 0 && (
            <div className="mt-2 ml-5 flex flex-col gap-1">
              {models
                .filter((m) => m.provider_id === p.id)
                .map((m) => (
                  <div
                    key={m.id}
                    className="flex items-center gap-2 text-xs text-description"
                  >
                    <span className="text-foreground">{m.model_name}</span>
                    <span>
                      ${m.input_cost_per_1k}/1k in, ${m.output_cost_per_1k}/1k
                      out
                    </span>
                    <button
                      onClick={() => handleDeleteModel(m.id)}
                      className="text-error hover:text-foreground ml-auto focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:outline-none"
                      aria-label="Delete model"
                    >
                      x
                    </button>
                  </div>
                ))}
            </div>
          )}

          {/* Add model form */}
          {showAddModel === p.id && (
            <div className="mt-3 ml-5 flex flex-col gap-2 border-t border-border pt-2">
              <input
                className="bg-input-background text-input-foreground border border-input-border rounded px-2 py-1 text-sm"
                placeholder="Model name (e.g. gpt-4o)"
                value={modelName}
                onChange={(e) => setModelName(e.target.value)}
              />
              <input
                className="bg-input-background text-input-foreground border border-input-border rounded px-2 py-1 text-sm"
                placeholder="Display name"
                value={modelDisplay}
                onChange={(e) => setModelDisplay(e.target.value)}
              />
              <div className="flex gap-2">
                <input
                  className="bg-input-background text-input-foreground border border-input-border rounded px-2 py-1 text-sm flex-1"
                  placeholder="Input $/1k"
                  value={modelInputCost}
                  onChange={(e) => setModelInputCost(e.target.value)}
                />
                <input
                  className="bg-input-background text-input-foreground border border-input-border rounded px-2 py-1 text-sm flex-1"
                  placeholder="Output $/1k"
                  value={modelOutputCost}
                  onChange={(e) => setModelOutputCost(e.target.value)}
                />
              </div>
              <button
                onClick={() => handleAddModel(p.id)}
                className="bg-primary-background text-primary-foreground rounded px-3 py-1 text-sm hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:outline-none"
              >
                Add Model
              </button>
            </div>
          )}
        </div>
      ))}

      {/* Add provider — redirect to canonical model setup */}
      <div className="border border-dashed border-border rounded-lg px-4 py-3 text-center">
        <p className="text-sm text-description mb-2">
          To add a provider, use the model setup in Settings.
          API keys are stored securely in the encrypted vault.
        </p>
        <a
          href="/config?tab=models"
          className="text-sm text-link hover:underline focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:outline-none"
        >
          Go to Model Settings →
        </a>
      </div>
    </div>
  );
}
