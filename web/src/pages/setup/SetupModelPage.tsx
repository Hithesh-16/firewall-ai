import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import { apiClient } from "../../api/client";

/**
 * Setup Model page — shown when /api/me/models returns hasAny=false.
 *
 * Two paths out:
 *
 *   1. User is allowed to add a personal provider (role policy's
 *      `rules.allow_user_provider_override` is true). → Show a form
 *      with provider slug + API key, submit to
 *      PUT /api/me/providers/:slug.
 *
 *   2. Otherwise, show a "Contact your admin" message with the
 *      admin email (from /api/me/policy → org metadata) so the user
 *      has a clear next action.
 *
 * After a successful add, we re-check /api/me/models and — if
 * hasAny now returns true — navigate the user to /dashboard.
 *
 * This page intentionally avoids a full Monaco assistant editor.
 * All the user needs is "pick a provider, paste a key, proceed".
 * The full Monaco experience lives on /settings/assistant (Phase F
 * follow-up) for power users who want to hand-edit the YAML.
 */

const PROVIDER_OPTIONS: Array<{
  slug: string;
  label: string;
  help: string;
  keyPattern: string;
  defaultBase?: string;
}> = [
  {
    slug: "openai",
    label: "OpenAI",
    help: "Keys start with sk-…",
    keyPattern: "^sk-.{20,}$",
  },
  {
    slug: "anthropic",
    label: "Anthropic (Claude)",
    help: "Keys start with sk-ant-…",
    keyPattern: "^sk-ant-.{20,}$",
  },
  {
    slug: "gemini",
    label: "Google Gemini",
    help: "API key from AI Studio",
    keyPattern: "^[A-Za-z0-9_-]{20,}$",
  },
  {
    slug: "mistral",
    label: "Mistral",
    help: "Key from console.mistral.ai",
    keyPattern: "^[A-Za-z0-9]{20,}$",
  },
  {
    slug: "ollama",
    label: "Ollama (local)",
    help: "Runs at http://localhost:11434 — no API key needed",
    keyPattern: ".*",
    defaultBase: "http://localhost:11434",
  },
];

interface ModelsResponse {
  models: Array<unknown>;
  availableProviders: Array<unknown>;
  hasAny: boolean;
  canAddPersonal: boolean;
  hasAssistant: boolean;
}

export default function SetupModelPage() {
  const navigate = useNavigate();
  const [canAddPersonal, setCanAddPersonal] = useState<boolean | null>(null);
  const [providerSlug, setProviderSlug] = useState("openai");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedProvider = PROVIDER_OPTIONS.find((p) => p.slug === providerSlug);

  // On mount: re-check /api/me/models so we know whether the user
  // is permitted to add a personal provider at all. If the proxy
  // says they already have models (raced), just bounce them out.
  useEffect(() => {
    apiClient
      .get<ModelsResponse>("/api/me/models")
      .then((res) => {
        if (res.hasAny) {
          navigate("/dashboard", { replace: true });
          return;
        }
        setCanAddPersonal(res.canAddPersonal);
      })
      .catch((err) => {
        setError(
          "Could not load model status: " + (err instanceof Error ? err.message : String(err)),
        );
        setCanAddPersonal(false);
      });
  }, [navigate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!selectedProvider) return;

    // Cheap client-side validation before the round trip.
    const keyRegex = new RegExp(selectedProvider.keyPattern);
    if (providerSlug !== "ollama" && !keyRegex.test(apiKey)) {
      setError(
        "That doesn't look like a valid " +
          selectedProvider.label +
          " key. " +
          selectedProvider.help +
          ".",
      );
      return;
    }

    setSubmitting(true);
    try {
      await apiClient.put(`/api/me/providers/${providerSlug}`, {
        apiKey: providerSlug === "ollama" && !apiKey ? "no-key-needed" : apiKey,
        baseUrl: baseUrl || selectedProvider.defaultBase || undefined,
      });

      // Re-check and bounce out on success.
      const fresh = await apiClient.get<ModelsResponse>("/api/me/models");
      if (fresh.hasAny) {
        navigate("/dashboard", { replace: true });
      } else {
        setError(
          "The key was saved, but no models are reachable yet. Your admin may need to add this provider to the org assistant first.",
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  // ─── Rendering ──────────────────────────────────────────────

  if (canAddPersonal === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-100">
        Loading…
      </div>
    );
  }

  if (canAddPersonal === false) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-100">
        <div className="max-w-lg rounded-2xl border border-slate-800 bg-slate-900 p-8 text-center shadow-xl">
          <div className="text-2xl font-semibold">Model not yet configured</div>
          <p className="mt-4 text-sm text-slate-400">
            Your organization has not provisioned an LLM provider, and your current role does not
            allow personal provider overrides.
          </p>
          <p className="mt-4 text-sm text-slate-400">
            Ask your admin to add a provider in{" "}
            <span className="font-mono">Settings → Assistant</span>, or to relax the{" "}
            <span className="font-mono">allow_user_provider_override</span> rule in your role
            policy.
          </p>
          <button
            className="mt-6 rounded bg-slate-800 px-4 py-2 text-sm text-slate-100 hover:bg-slate-700"
            onClick={() => window.location.reload()}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-100">
      <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900 p-8 shadow-xl">
        <div className="text-2xl font-semibold">Add your first model</div>
        <p className="mt-2 text-sm text-slate-400">
          At least one LLM provider is required before you can use AI Firewall. Your key is stored
          AES-256-GCM encrypted in the proxy vault and never leaves your machine.
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <label className="block">
            <span className="text-xs font-semibold text-slate-300">Provider</span>
            <select
              value={providerSlug}
              onChange={(e) => setProviderSlug(e.target.value)}
              className="mt-1 w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-sm"
            >
              {PROVIDER_OPTIONS.map((p) => (
                <option key={p.slug} value={p.slug}>
                  {p.label}
                </option>
              ))}
            </select>
            {selectedProvider && (
              <span className="mt-1 block text-xs text-slate-500">{selectedProvider.help}</span>
            )}
          </label>

          {providerSlug !== "ollama" && (
            <label className="block">
              <span className="text-xs font-semibold text-slate-300">API Key</span>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={
                  providerSlug === "openai"
                    ? "sk-…"
                    : providerSlug === "anthropic"
                      ? "sk-ant-…"
                      : "Paste your API key"
                }
                className="mt-1 w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 font-mono text-sm"
                autoFocus
                required
              />
            </label>
          )}

          {(providerSlug === "ollama" || selectedProvider?.defaultBase !== undefined) && (
            <label className="block">
              <span className="text-xs font-semibold text-slate-300">Base URL (optional)</span>
              <input
                type="text"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder={selectedProvider?.defaultBase ?? ""}
                className="mt-1 w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 font-mono text-sm"
              />
            </label>
          )}

          {error && (
            <div className="rounded border border-red-900 bg-red-950/50 p-3 text-xs text-red-300">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded bg-emerald-500 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
          >
            {submitting ? "Saving…" : "Save and continue"}
          </button>
        </form>
      </div>
    </div>
  );
}
