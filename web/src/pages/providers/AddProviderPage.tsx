import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  MagnifyingGlassIcon,
  CheckIcon,
  ArrowLeftIcon,
  PlusIcon,
  KeyIcon,
  ServerIcon,
  ArrowTopRightOnSquareIcon,
} from "@heroicons/react/24/outline";
import { cn } from "../../utils/cn";
import { apiClient } from "../../api/client";
import { useAppDispatch } from "../../store/hooks";
import { showToast } from "../../store/slices/uiSlice";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { PROVIDER_CATALOG, POPULAR_PROVIDER_IDS, type CatalogProvider } from "../../data/providers";
import { ProviderCard } from "./ProviderCard";

type Step = "select-provider" | "configure" | "select-models";

export function AddProviderPage() {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();

  const [step, setStep] = useState<Step>("select-provider");
  const [search, setSearch] = useState("");
  const [selectedProvider, setSelectedProvider] = useState<CatalogProvider | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  // Fuzzy search
  const filteredProviders = useMemo(() => {
    if (!search.trim()) return PROVIDER_CATALOG;
    const q = search.toLowerCase();
    return PROVIDER_CATALOG.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q),
    );
  }, [search]);

  const popularProviders = filteredProviders.filter((p) => POPULAR_PROVIDER_IDS.includes(p.id));
  const otherProviders = filteredProviders.filter((p) => !POPULAR_PROVIDER_IDS.includes(p.id));

  function handleSelectProvider(provider: CatalogProvider) {
    setSelectedProvider(provider);
    setBaseUrl(provider.baseUrl);
    setApiKey("");
    setSelectedModels(new Set(provider.models.slice(0, 3).map((m) => m.id)));
    setStep("configure");
  }

  function handleBack() {
    if (step === "select-models") {
      setStep("configure");
    } else if (step === "configure") {
      setStep("select-provider");
      setSelectedProvider(null);
    } else {
      navigate("/org");
    }
  }

  function toggleModel(modelId: string) {
    setSelectedModels((prev) => {
      const next = new Set(prev);
      if (next.has(modelId)) next.delete(modelId);
      else next.add(modelId);
      return next;
    });
  }

  async function handleSave() {
    if (!selectedProvider) return;
    if (selectedProvider.requiresApiKey && !apiKey.trim()) return;

    setSaving(true);
    try {
      // Create the provider
      const provider = await apiClient.post<{ id: number }>("/api/providers", {
        name: selectedProvider.name,
        apiKey: selectedProvider.requiresApiKey ? apiKey : "local",
        baseUrl: baseUrl || selectedProvider.baseUrl,
      });

      // Add selected models
      const modelsToAdd = selectedProvider.models.filter((m) => selectedModels.has(m.id));

      for (const model of modelsToAdd) {
        try {
          await apiClient.post(`/api/providers/${provider.id}/models`, {
            modelName: model.id,
            displayName: model.name,
            inputCostPer1k: model.inputCostPer1k ?? 0,
            outputCostPer1k: model.outputCostPer1k ?? 0,
            maxContextTokens: model.contextLength,
          });
        } catch {
          // Model might already exist — continue
        }
      }

      dispatch(
        showToast({
          id: `prov-${Date.now()}`,
          type: "success",
          message: `${selectedProvider.name} added with ${modelsToAdd.length} model(s)`,
        }),
      );
      navigate("/org");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to add provider";
      dispatch(
        showToast({
          id: `prov-err-${Date.now()}`,
          type: "error",
          message: msg,
        }),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleBack}
          className="text-description hover:bg-list-hover hover:text-foreground rounded p-1"
          aria-label="Go back"
        >
          <ArrowLeftIcon className="h-5 w-5" />
        </button>
        <div>
          <h1 className="text-foreground text-2xl font-bold">Add Provider</h1>
          <p className="text-description text-sm">
            {step === "select-provider" && "Choose an AI provider to connect"}
            {step === "configure" && `Configure ${selectedProvider?.name}`}
            {step === "select-models" && `Select models for ${selectedProvider?.name}`}
          </p>
        </div>
      </div>

      {/* Step 1: Select Provider */}
      {step === "select-provider" && (
        <>
          {/* Search */}
          <div className="relative">
            <MagnifyingGlassIcon className="text-description absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search providers..."
              autoFocus
              className="border-input-border bg-input text-input-foreground placeholder:text-input-placeholder focus:border-border-focus focus:ring-border-focus w-full rounded-lg border py-2.5 pl-10 pr-4 text-sm focus:outline-none focus:ring-1"
            />
          </div>

          {/* Popular */}
          {popularProviders.length > 0 && (
            <div>
              <h2 className="text-description-muted mb-3 text-xs font-semibold uppercase tracking-wider">
                Popular
              </h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {popularProviders.map((p) => (
                  <ProviderCard key={p.id} provider={p} onClick={() => handleSelectProvider(p)} />
                ))}
              </div>
            </div>
          )}

          {/* Other providers */}
          {otherProviders.length > 0 && (
            <div>
              <h2 className="text-description-muted mb-3 text-xs font-semibold uppercase tracking-wider">
                {search ? "Results" : "More Providers"}
              </h2>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {otherProviders.map((p) => (
                  <ProviderCard key={p.id} provider={p} onClick={() => handleSelectProvider(p)} />
                ))}
              </div>
            </div>
          )}

          {filteredProviders.length === 0 && (
            <div className="text-description py-12 text-center text-sm">
              No providers match "{search}"
            </div>
          )}
        </>
      )}

      {/* Step 2: Configure */}
      {step === "configure" && selectedProvider && (
        <Card>
          <div className="space-y-5">
            {/* Provider header */}
            <div className="flex items-center gap-3">
              <img
                src={`/logos/${selectedProvider.icon}`}
                alt=""
                className="h-10 w-10 rounded-lg object-contain"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = "none";
                }}
              />
              <div>
                <h3 className="text-foreground text-lg font-semibold">{selectedProvider.name}</h3>
                <p className="text-description text-sm">{selectedProvider.description}</p>
              </div>
              <div className="ml-auto flex gap-2">
                {selectedProvider.isLocal && <Badge variant="success">Local</Badge>}
                {selectedProvider.requiresApiKey && (
                  <Badge variant="warning">API Key Required</Badge>
                )}
              </div>
            </div>

            {/* API Key */}
            {selectedProvider.requiresApiKey && (
              <div>
                <label className="text-foreground mb-1.5 flex items-center gap-1.5 text-sm font-medium">
                  <KeyIcon className="h-4 w-4" />
                  API Key
                </label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder={`Enter your ${selectedProvider.name} API key`}
                  autoFocus
                  className="border-input-border bg-input text-input-foreground placeholder:text-input-placeholder focus:border-border-focus focus:ring-border-focus w-full rounded-lg border px-4 py-2.5 text-sm focus:outline-none focus:ring-1"
                />
                {selectedProvider.apiKeyUrl && (
                  <a
                    href={selectedProvider.apiKeyUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-link mt-1.5 inline-flex items-center gap-1 text-xs hover:underline"
                  >
                    Get your API key
                    <ArrowTopRightOnSquareIcon className="h-3 w-3" />
                  </a>
                )}
              </div>
            )}

            {/* Base URL */}
            <div>
              <label className="text-foreground mb-1.5 flex items-center gap-1.5 text-sm font-medium">
                <ServerIcon className="h-4 w-4" />
                Base URL
              </label>
              <input
                type="text"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder={selectedProvider.baseUrl}
                className="border-input-border bg-input text-input-foreground placeholder:text-input-placeholder focus:border-border-focus focus:ring-border-focus w-full rounded-lg border px-4 py-2.5 text-sm focus:outline-none focus:ring-1"
              />
              <p className="text-description-muted mt-1 text-xs">
                Default: {selectedProvider.baseUrl}
              </p>
            </div>

            {/* Models selection */}
            <div>
              <label className="text-foreground mb-2 block text-sm font-medium">
                Models ({selectedModels.size} selected)
              </label>
              <div className="border-border max-h-64 space-y-1 overflow-y-auto rounded-lg border p-2">
                {selectedProvider.models.map((model) => (
                  <button
                    key={model.id}
                    type="button"
                    onClick={() => toggleModel(model.id)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors",
                      selectedModels.has(model.id)
                        ? "bg-primary/10 text-foreground"
                        : "text-description hover:bg-list-hover hover:text-foreground",
                    )}
                  >
                    <div
                      className={cn(
                        "flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                        selectedModels.has(model.id)
                          ? "border-primary bg-primary"
                          : "border-border",
                      )}
                    >
                      {selectedModels.has(model.id) && (
                        <CheckIcon className="text-primary-foreground h-3 w-3" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{model.name}</p>
                      <p className="text-description-muted text-xs">
                        {model.contextLength.toLocaleString()} tokens
                        {model.inputCostPer1k != null && ` | $${model.inputCostPer1k}/1K in`}
                        {model.outputCostPer1k != null && ` | $${model.outputCostPer1k}/1K out`}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div className="border-border flex justify-end gap-3 border-t pt-4">
              <Button variant="ghost" onClick={handleBack}>
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                loading={saving}
                disabled={
                  saving ||
                  (selectedProvider.requiresApiKey && !apiKey.trim()) ||
                  selectedModels.size === 0
                }
              >
                <PlusIcon className="h-4 w-4" />
                Add {selectedProvider.name}
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
