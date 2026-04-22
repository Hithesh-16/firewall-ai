import { useState } from "react";
import { PlusIcon, XMarkIcon, CheckCircleIcon } from "@heroicons/react/24/outline";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import {
  onboardingActions,
  type OnboardingProviderDraft,
} from "../../store/slices/onboardingSlice";
import { apiClient } from "../../api/client";
import { ENDPOINTS } from "../../api/endpoints";
import { cn } from "../../utils/cn";
import { WizardCard, WizardError, WizardNav, tinyId } from "./_shared";

/**
 * Step 5 — BYOK providers.
 *
 * Admin adds the org's LLM provider keys. Keys go into the proxy's
 * AES-256-GCM vault via POST /api/providers. At least one provider is
 * required to finish onboarding — the chat doesn't work otherwise.
 */

type Kind = OnboardingProviderDraft["kind"];

const PROVIDER_META: Record<
  Kind,
  {
    label: string;
    logo: string;
    needsApiKey: boolean;
    needsBaseUrl: boolean;
    needsDeployment: boolean;
    defaultBase?: string;
  }
> = {
  openai: {
    label: "OpenAI",
    logo: "🟢",
    needsApiKey: true,
    needsBaseUrl: false,
    needsDeployment: false,
  },
  anthropic: {
    label: "Anthropic",
    logo: "🟠",
    needsApiKey: true,
    needsBaseUrl: false,
    needsDeployment: false,
  },
  gemini: {
    label: "Google Gemini",
    logo: "🔵",
    needsApiKey: true,
    needsBaseUrl: false,
    needsDeployment: false,
  },
  mistral: {
    label: "Mistral",
    logo: "🟣",
    needsApiKey: true,
    needsBaseUrl: false,
    needsDeployment: false,
  },
  azure: {
    label: "Azure OpenAI",
    logo: "🔷",
    needsApiKey: true,
    needsBaseUrl: true,
    needsDeployment: true,
  },
  ollama: {
    label: "Ollama (local)",
    logo: "🦙",
    needsApiKey: false,
    needsBaseUrl: true,
    needsDeployment: false,
    defaultBase: "http://localhost:11434",
  },
  custom: {
    label: "Custom OpenAI-compatible",
    logo: "⚙️",
    needsApiKey: true,
    needsBaseUrl: true,
    needsDeployment: false,
  },
};

interface CreatedProviderResponse {
  id: number;
  name: string;
  slug: string;
}

export function Step5Providers({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const dispatch = useAppDispatch();
  const wizard = useAppSelector((s) => s.onboarding);

  const [draft, setDraft] = useState<Omit<OnboardingProviderDraft, "localId">>({
    kind: "openai",
    name: "",
    apiKey: "",
    baseUrl: "",
    deploymentName: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const meta = PROVIDER_META[draft.kind];

  function updateKind(kind: Kind) {
    setDraft({
      kind,
      name: PROVIDER_META[kind].label,
      apiKey: "",
      baseUrl: PROVIDER_META[kind].defaultBase || "",
      deploymentName: "",
    });
  }

  async function handleAdd() {
    setError(null);
    if (meta.needsApiKey && !draft.apiKey?.trim()) {
      setError("API key is required for this provider.");
      return;
    }
    if (meta.needsBaseUrl && !draft.baseUrl?.trim()) {
      setError("Base URL is required for this provider.");
      return;
    }

    setBusy(true);
    try {
      const resp = await apiClient.post<CreatedProviderResponse>(ENDPOINTS.providers.root, {
        kind: draft.kind,
        name: draft.name || meta.label,
        apiKey: draft.apiKey,
        baseUrl: draft.baseUrl || undefined,
        deploymentName: draft.deploymentName || undefined,
      });

      // POST /api/providers is an upsert — re-submitting the same
      // provider rotates its key rather than erroring. Dedupe by slug
      // so the "Added" list doesn't grow a duplicate tile on rotation.
      const alreadyListed = wizard.providers.some(
        (p) => p.name.toLowerCase() === (resp.name || "").toLowerCase(),
      );
      if (!alreadyListed) {
        dispatch(
          onboardingActions.addProvider({
            localId: tinyId(),
            serverId: resp.id,
            kind: draft.kind,
            name: resp.name,
          }),
        );
      }

      // Reset form for the next add
      setDraft({
        kind: "openai",
        name: "",
        apiKey: "",
        baseUrl: "",
        deploymentName: "",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add provider");
    } finally {
      setBusy(false);
    }
  }

  const canContinue = wizard.providers.length > 0;

  return (
    <WizardCard
      title="Add your LLM providers"
      subtitle="Bring your own keys. Each key + default model is stored on your account (not in a separate file) and reused across the web, VS Code, and the CLI."
    >
      {/* Existing providers */}
      {wizard.providers.length > 0 && (
        <div className="mb-5">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
            Added
          </h3>
          <div className="space-y-2">
            {wizard.providers.map((p) => (
              <div
                key={p.localId}
                className="flex items-center justify-between rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-sm"
              >
                <div className="flex items-center gap-2">
                  <CheckCircleIcon className="h-4 w-4 text-emerald-400" />
                  <span className="text-slate-100">{p.name}</span>
                  <span className="text-xs text-slate-500">· {PROVIDER_META[p.kind].label}</span>
                </div>
                <button
                  onClick={() => dispatch(onboardingActions.removeProvider(p.localId))}
                  className="text-slate-500 hover:text-red-400"
                >
                  <XMarkIcon className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* New provider form */}
      <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-4">
        <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
          Add a provider
        </h3>

        {/* Kind picker */}
        <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {(Object.keys(PROVIDER_META) as Kind[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => updateKind(k)}
              className={cn(
                "flex items-center gap-1.5 rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors",
                draft.kind === k
                  ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-300"
                  : "border-slate-800 text-slate-400 hover:border-slate-600 hover:text-slate-200",
              )}
            >
              <span>{PROVIDER_META[k].logo}</span>
              <span className="truncate">{PROVIDER_META[k].label}</span>
            </button>
          ))}
        </div>

        <div className="space-y-2">
          {meta.needsApiKey && (
            <input
              type="password"
              value={draft.apiKey}
              onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
              placeholder="API key"
              className="w-full rounded-lg border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-500/60 focus:outline-none"
            />
          )}
          {meta.needsBaseUrl && (
            <input
              type="url"
              value={draft.baseUrl}
              onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
              placeholder={meta.defaultBase || "https://api.example.com"}
              className="w-full rounded-lg border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-500/60 focus:outline-none"
            />
          )}
          {meta.needsDeployment && (
            <input
              type="text"
              value={draft.deploymentName}
              onChange={(e) => setDraft({ ...draft, deploymentName: e.target.value })}
              placeholder="Deployment name (Azure)"
              className="w-full rounded-lg border border-slate-700 bg-slate-950/80 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-emerald-500/60 focus:outline-none"
            />
          )}
        </div>

        <button
          type="button"
          onClick={handleAdd}
          disabled={busy}
          className="mt-3 inline-flex items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-300 transition-colors hover:bg-emerald-500/20 disabled:opacity-40"
        >
          <PlusIcon className="h-4 w-4" />
          {busy ? "Adding…" : "Add provider"}
        </button>
      </div>

      <WizardError message={error} />

      {!canContinue && (
        <p className="mt-3 text-xs text-amber-400/80">
          Add at least one provider to continue — the chat won't work without one.
        </p>
      )}

      <WizardNav onBack={onBack} onNext={onNext} nextDisabled={!canContinue} busy={busy} />
    </WizardCard>
  );
}
