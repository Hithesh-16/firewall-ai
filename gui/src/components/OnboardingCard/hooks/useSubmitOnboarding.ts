import { OnboardingModes } from "core/protocol/core";
import { usePostHog } from "posthog-js/react";
import { useContext } from "react";
import { IdeMessengerContext } from "../../../context/IdeMessenger";
import { getLocalStorage, setLocalStorage } from "../../../util/localStorage";
import { useOnboardingCard } from "./useOnboardingCard";

/**
 * Default base URLs per provider — used by the onboarding wizard when
 * the user picks a hosted provider via the API_KEY mode. The proxy
 * vault accepts `baseUrl` so it can spawn requests on the user's
 * behalf without re-deriving it from the provider name.
 */
const PROVIDER_BASE_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com",
  gemini: "https://generativelanguage.googleapis.com/v1beta",
  mistral: "https://api.mistral.ai/v1",
  ollama: "http://localhost:11434",
};

/**
 * Best-effort proxy URL. The webview is hosted by VS Code and can't
 * read process env, so we hardcode the loopback default. Aligned with
 * the rest of the GUI (see `gui/src/forms/AddModelForm.tsx:110`).
 */
const PROXY_BASE = "http://localhost:8080";

/**
 * Phase C.C5 (SECURITY_HARDENING_PLAN.md) — POSTs the apiKey to the
 * proxy vault (`POST /api/providers`) and returns a vault reference
 * the IDE can write into config.yaml as `apiKeyRef:`. The plaintext
 * key NEVER leaves this function — the IDE messenger receives only
 * the reference shape `vault://<slug>`.
 *
 * Returns null if the proxy is unreachable. The caller decides how
 * to surface the failure; the previous "fall back to plaintext" path
 * is intentionally gone.
 */
async function vaultProvider(
  provider: string,
  apiKey: string,
): Promise<string | null> {
  try {
    const baseUrl = PROVIDER_BASE_URLS[provider] ?? "";
    const res = await fetch(`${PROXY_BASE}/api/providers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: provider,
        slug: provider,
        baseUrl,
        apiKey,
      }),
    });
    if (!res.ok) return null;
    // The route returns `{ id, name, slug, baseUrl, ... }`. We build
    // the reference shape the YAML loader expects.
    const data = (await res.json()) as { slug?: string };
    const slug = data.slug ?? provider;
    return `vault://${slug}`;
  } catch {
    return null;
  }
}

export function useSubmitOnboarding(mode: OnboardingModes, isDialog = false) {
  const posthog = usePostHog();
  const ideMessenger = useContext(IdeMessengerContext);
  const { close: closeOnboardingCard } = useOnboardingCard();

  async function submitOnboarding(provider?: string, apiKey?: string) {
    const onboardingStatus = getLocalStorage("onboardingStatus");

    // Always close the onboarding card and update config.yaml
    closeOnboardingCard(isDialog);

    // Phase C.C5: vault the key BEFORE telling the IDE about it.
    // The plaintext apiKey never reaches the IDE messenger, the IDE
    // never writes it to disk, and the YAML stores only the reference.
    let apiKeyRef: string | undefined;
    if (provider && apiKey) {
      const ref = await vaultProvider(provider, apiKey);
      if (!ref) {
        // Proxy unreachable — surface to the user. Phase C principle:
        // never silently downgrade to plaintext storage.
        // eslint-disable-next-line no-alert
        window.alert(
          "AI Firewall proxy is not reachable on localhost:8080. " +
            "Onboarding cannot complete because vaulting the API key " +
            "is mandatory in this build (SECURITY_HARDENING_PLAN.md " +
            "Phase C). Start the proxy and try again.",
        );
        return;
      }
      apiKeyRef = ref;
    }

    ideMessenger.post("onboarding/complete", {
      mode,
      provider,
      apiKeyRef,
    });

    if (onboardingStatus === "Started") {
      // Telemetry
      posthog.capture("Onboarding Step", { status: "Completed" });
      posthog.capture("onboardingSelection", {
        mode,
      });

      // Local state
      setLocalStorage("onboardingStatus", "Completed");

      // Move to next step in onboarding
      ideMessenger.post("showTutorial", undefined);
    }

    ideMessenger.post("config/openProfile", { profileId: undefined });
  }

  return {
    submitOnboarding,
  };
}
