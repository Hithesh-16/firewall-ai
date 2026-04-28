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

import { UnifiedModelForm } from "../../components/shared/UnifiedModelForm";

export function Step5Providers({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const dispatch = useAppDispatch();
  const wizard = useAppSelector((s) => s.onboarding);

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSave(values: any) {
    setError(null);
    setBusy(true);
    try {
      // Step5 in onboarding adds a "Provider" which in the current backend
      // maps to creating an entry in the providers table.
      // However, the unified form works on providerSlug/modelSlug pairs.
      // For onboarding, we'll add it as a provider if it's a "standard" one,
      // or as a custom model if it's custom.

      const resp = await apiClient.post<CreatedProviderResponse>(ENDPOINTS.providers.root, {
        kind: values.providerSlug,
        name: values.name || values.providerSlug,
        apiKey: values.apiKey,
        baseUrl: values.apiBase || undefined,
      });

      const alreadyListed = wizard.providers.some(
        (p) => p.name.toLowerCase() === (resp.name || "").toLowerCase(),
      );
      if (!alreadyListed) {
        dispatch(
          onboardingActions.addProvider({
            localId: tinyId(),
            serverId: resp.id,
            kind: values.providerSlug as any,
            name: resp.name,
          }),
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add provider");
    } finally {
      setBusy(false);
    }
  }

  // Non-mandatory now
  const canContinue = true;

  return (
    <WizardCard
      title="Add your LLM providers"
      subtitle="Bring your own keys. Each key + default model is stored on your account and reused across the web, VS Code, and the CLI."
    >
      {/* Existing providers */}
      {wizard.providers.length > 0 && (
        <div className="mb-6">
          <h3 className="mb-3 text-[11px] font-bold uppercase tracking-wider text-description-muted">
            Added Providers
          </h3>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {wizard.providers.map((p) => (
              <div
                key={p.localId}
                className="flex items-center justify-between rounded-lg border border-success/20 bg-success/5 px-3 py-2 text-sm"
              >
                <div className="flex items-center gap-2 overflow-hidden">
                  <CheckCircleIcon className="h-4 w-4 shrink-0 text-success" />
                  <span className="truncate font-medium text-foreground">{p.name}</span>
                  <span className="shrink-0 text-xs text-description-muted">· {p.kind}</span>
                </div>
                <button
                  onClick={() => dispatch(onboardingActions.removeProvider(p.localId))}
                  className="text-description-muted hover:text-danger"
                >
                  <XMarkIcon className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-4">
        <UnifiedModelForm
          title="Add a provider"
          submitLabel="Add Provider"
          onCancel={() => {}}
          onSave={handleSave}
        />

        {wizard.providers.length === 0 && (
          <p className="px-1 text-center text-xs text-description-muted">
            You can skip this for now and add providers later in Settings.
          </p>
        )}
      </div>

      <WizardError message={error} />

      <WizardNav onBack={onBack} onNext={onNext} nextDisabled={!canContinue} busy={busy} />
    </WizardCard>
  );
}
