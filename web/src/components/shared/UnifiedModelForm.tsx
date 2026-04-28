import {
  CommandLineIcon,
  GlobeAltIcon,
  KeyIcon,
  SparklesIcon,
  WrenchIcon,
  ChevronDownIcon,
  ChevronUpIcon,
} from "@heroicons/react/24/outline";
import { useEffect, useState } from "react";
import { apiClient } from "../../api/client";
import { ENDPOINTS } from "../../api/endpoints";
import {
  ALL_ROLES,
  findProvider,
  POPULAR_PROVIDERS,
  type CatalogueModel,
  type CatalogueProvider,
} from "../../data/providerCatalogue";
import { cn } from "../../utils/cn";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { ModelPicker, ProviderPicker } from "./ModelPickers";

export interface UnifiedModelFormValues {
  name: string;
  providerSlug: string;
  modelSlug: string;
  apiBase: string;
  apiKey: string;
  roles: string[];
}

interface UnifiedModelFormProps {
  onCancel: () => void;
  onSave: (values: UnifiedModelFormValues) => Promise<void>;
  initialValues?: Partial<UnifiedModelFormValues>;
  title?: string;
  submitLabel?: string;
}

export function UnifiedModelForm({
  onCancel,
  onSave,
  initialValues,
  title = "Add a model",
  submitLabel = "Add Model",
}: UnifiedModelFormProps) {
  const [isCustom, setIsCustom] = useState(false);
  const [provider, setProvider] = useState<CatalogueProvider>(
    findProvider(initialValues?.providerSlug || "openai") ?? POPULAR_PROVIDERS[0],
  );
  const [model, setModel] = useState<CatalogueModel>(
    provider.models.find((m) => m.model === initialValues?.modelSlug) ||
      provider.models[0] || {
        model: "AUTODETECT",
        displayName: "Auto-detect",
        roles: ["chat", "edit", "apply"],
      },
  );

  const [name, setName] = useState(initialValues?.name || "");
  const [apiKey, setApiKey] = useState(initialValues?.apiKey || "");
  const [apiBase, setApiBase] = useState(initialValues?.apiBase || provider.defaultBaseUrl || "");
  const [roles, setRoles] = useState<string[]>(initialValues?.roles || ["chat", "edit", "apply"]);
  const [customModelSlug, setCustomModelSlug] = useState(initialValues?.modelSlug || "");
  const [detectedModels, setDetectedModels] = useState<string[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    if (!isCustom) {
      setApiBase(provider.defaultBaseUrl || "");
      if (!model || !provider.models.some((m) => m.model === model.model)) {
        setModel(
          provider.models[0] || {
            model: "AUTODETECT",
            displayName: "Auto-detect",
            roles: ["chat", "edit", "apply"],
          },
        );
      }
    }
  }, [provider, isCustom]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await onSave({
        name: isCustom ? name : name || model?.displayName || "",
        providerSlug: isCustom && provider.slug === "custom" ? "openai" : provider.slug,
        modelSlug: isCustom ? customModelSlug : model.model,
        apiBase: apiBase || provider.defaultBaseUrl || "",
        apiKey: !provider.requiresApiKey && !apiKey ? "local" : apiKey,
        roles,
      });
    } finally {
      setSubmitting(false);
    }
  }

  const toggleRole = (role: string) => {
    setRoles((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]));
  };

  return (
    <Card className="overflow-hidden border-border/50 bg-card shadow-xl ring-1 ring-black/5">
      <div className="border-b border-border/40 bg-muted/30 px-6 py-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-foreground">{title}</h3>
          <div className="flex gap-1 rounded-lg bg-muted p-1">
            <button
              type="button"
              onClick={() => setIsCustom(false)}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition-all",
                !isCustom
                  ? "bg-background text-foreground shadow-sm"
                  : "text-description hover:text-foreground",
              )}
            >
              Catalogue
            </button>
            <button
              type="button"
              onClick={() => setIsCustom(true)}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition-all",
                isCustom
                  ? "bg-background text-foreground shadow-sm"
                  : "text-description hover:text-foreground",
              )}
            >
              Custom
            </button>
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="p-6">
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          {/* Left Column: Basic Config */}
          <div className="space-y-5">
            <div>
              <label className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-description-muted">
                <GlobeAltIcon className="h-3.5 w-3.5" />
                Provider
              </label>
              <ProviderPicker selected={provider} onSelect={setProvider} />
            </div>

            {isCustom ? (
              <div>
                <label className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-description-muted">
                  <CommandLineIcon className="h-3.5 w-3.5" />
                  Model ID
                </label>
                <input
                  type="text"
                  value={customModelSlug}
                  onChange={(e) => setCustomModelSlug(e.target.value)}
                  placeholder="e.g. gpt-4o, minimaxai/minimax-m2.7"
                  required
                  className="w-full rounded-md border border-input-border bg-input px-3 py-2.5 font-mono text-sm text-input-foreground placeholder:text-input-placeholder focus:border-border-focus focus:outline-none focus:ring-1 focus:ring-border-focus"
                />
              </div>
            ) : (
              <div>
                <label className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-description-muted">
                  <SparklesIcon className="h-3.5 w-3.5" />
                  Model
                </label>
                <ModelPicker
                  models={provider.models}
                  selected={model}
                  onSelect={setModel}
                  includeAutoDetect
                />
              </div>
            )}

            <div>
              <label className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-description-muted">
                <WrenchIcon className="h-3.5 w-3.5" />
                Friendly Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={
                  isCustom ? "Give this model a name" : model?.displayName || "Select a model"
                }
                className="w-full rounded-md border border-input-border bg-input px-3 py-2.5 text-sm text-input-foreground placeholder:text-input-placeholder focus:border-border-focus focus:outline-none focus:ring-1 focus:ring-border-focus"
              />
            </div>
          </div>

          {/* Right Column: Connection & Roles */}
          <div className="space-y-5">
            <div>
              <label className="mb-1.5 flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-description-muted">
                <div className="flex items-center gap-1.5">
                  <KeyIcon className="h-3.5 w-3.5" />
                  API Key
                </div>
                {provider.apiKeyUrl && (
                  <a
                    href={provider.apiKeyUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[10px] font-medium text-info hover:underline"
                  >
                    Get Key →
                  </a>
                )}
              </label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={provider.keyPlaceholder ?? "Paste your API key"}
                required={provider.requiresApiKey}
                className="w-full rounded-md border border-input-border bg-input px-3 py-2.5 font-mono text-sm text-input-foreground placeholder:text-input-placeholder focus:border-border-focus focus:outline-none focus:ring-1 focus:ring-border-focus"
              />
            </div>

            <div>
              <label className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-description-muted">
                <GlobeAltIcon className="h-3.5 w-3.5" />
                Base URL
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={apiBase}
                  onChange={(e) => setApiBase(e.target.value)}
                  placeholder={provider.defaultBaseUrl ?? "https://api.openai.com/v1"}
                  className="w-full rounded-md border border-input-border bg-input px-3 py-2.5 font-mono text-sm text-input-foreground placeholder:text-input-placeholder focus:border-border-focus focus:outline-none focus:ring-1 focus:ring-border-focus"
                />
                {isCustom && (
                  <button
                    type="button"
                    onClick={async () => {
                      if (!apiBase || !apiKey) return;
                      setSubmitting(true);
                      try {
                        const res = await apiClient.post<{ models: string[] }>(
                          ENDPOINTS.me.modelsDetect,
                          {
                            apiBase,
                            apiKey,
                            providerSlug: provider.slug,
                          },
                        );
                        if (res.models && res.models.length > 0) {
                          setDetectedModels(res.models);
                          setCustomModelSlug(res.models[0]);
                        }
                      } catch (err) {
                        // Silent fail or toast? Let's just log for now
                        console.error("Detection failed", err);
                      } finally {
                        setSubmitting(false);
                      }
                    }}
                    className={cn(
                      "absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-semibold text-info hover:text-info-hover",
                      submitting && "opacity-50",
                    )}
                    disabled={submitting || !apiBase || !apiKey}
                  >
                    {submitting ? "..." : "Auto-detect"}
                  </button>
                )}
              </div>
              {isCustom && detectedModels.length > 0 && (
                <div className="mt-2">
                  <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-description-muted">
                    Detected Models
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {detectedModels.map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setCustomModelSlug(m)}
                        className={cn(
                          "rounded bg-info/10 px-2 py-1 text-[10px] font-medium text-info transition-all hover:bg-info/20",
                          customModelSlug === m && "bg-info text-white hover:bg-info",
                        )}
                      >
                        {m}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <label className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-description-muted">
                Roles
              </label>
              <div className="flex flex-wrap gap-1.5">
                {ALL_ROLES.map((role) => (
                  <button
                    key={role}
                    type="button"
                    onClick={() => toggleRole(role)}
                    className={cn(
                      "rounded-full px-3 py-1 text-[11px] font-medium transition-all",
                      roles.includes(role)
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "border border-border bg-muted/50 text-description-muted hover:border-border-focus hover:text-foreground",
                    )}
                  >
                    {role}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-description-muted">
                Select which workflows this model should be used for.
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-8 flex items-center justify-between border-t border-border/40 pt-6">
          <div className="flex items-center gap-2">
            {!isCustom && (
              <p className="text-xs text-description-muted">
                Using pre-configured settings for{" "}
                <span className="font-medium text-foreground">
                  {model?.displayName || "this model"}
                </span>
                .
              </p>
            )}
          </div>
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onCancel}
              disabled={submitting}
              className="text-description-muted"
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" loading={submitting} className="min-w-[120px]">
              {submitLabel}
            </Button>
          </div>
        </div>
      </form>
    </Card>
  );
}
