import { Listbox, Transition } from "@headlessui/react";
import {
  ArrowPathIcon,
  CheckIcon,
  ChevronUpDownIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import { Fragment, useCallback, useEffect, useState } from "react";

import { apiClient } from "../../api/client";
import {
  type CatalogueModel,
  type CatalogueProvider,
  findProvider,
  OTHER_PROVIDERS,
  POPULAR_PROVIDERS,
} from "../../data/providerCatalogue";

/**
 * Unified Models page — the SINGLE place to add, view, and remove
 * models. Replaces all previous fragmented surfaces:
 *   - /add-provider  (old Phase 4)
 *   - /setup-model   (Phase F first-run)
 *   - ProvidersTab in /org and /security
 *   - ModelAccessPage (Phase F2 grant matrix)
 *
 * Data flows through the `user_models` table via:
 *   POST   /api/me/models/add   → add a model
 *   GET    /api/me/models/list  → list models
 *   DELETE /api/me/models/:id   → remove a model
 *
 * The gateway reads the same table on every /v1/chat/completions
 * request, so adding a model here makes it usable immediately
 * in the CLI, VS Code, JetBrains, and web chat.
 */

interface UserModelRow {
  id: number;
  providerSlug: string;
  modelSlug: string;
  displayName: string | null;
  apiBase: string | null;
  enabled: boolean;
  roles: string[];
  createdAt: number;
}

interface ListResponse {
  models: UserModelRow[];
  hasAny: boolean;
}

// ─── Reusable Listbox components ─────────────────────────────────

function ProviderDropdown({
  selected,
  onSelect,
}: {
  selected: CatalogueProvider;
  onSelect: (p: CatalogueProvider) => void;
}) {
  const [query, setQuery] = useState("");
  const filter = (list: CatalogueProvider[]) =>
    query.trim().length === 0
      ? list
      : list.filter(
          (p) =>
            p.title.toLowerCase().includes(query.toLowerCase()) ||
            p.slug.toLowerCase().includes(query.toLowerCase()),
        );

  return (
    <Listbox value={selected} onChange={onSelect}>
      <div className="relative">
        <Listbox.Button className="relative w-full cursor-pointer rounded border border-slate-700 bg-slate-800 py-2 pl-3 pr-10 text-left text-sm text-slate-100">
          <span className="font-medium">{selected.title}</span>
          <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
            <ChevronUpDownIcon className="h-5 w-5 text-slate-400" />
          </span>
        </Listbox.Button>
        <Transition
          as={Fragment}
          leave="transition ease-in duration-100"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <Listbox.Options className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded border border-slate-700 bg-slate-900 py-1 text-sm shadow-lg">
            <div className="sticky top-0 z-30 border-b border-slate-800 bg-slate-900 px-2 py-1.5">
              <div className="relative">
                <MagnifyingGlassIcon className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  placeholder="Search…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.stopPropagation()}
                  className="w-full rounded border border-slate-700 bg-slate-800 py-1 pl-7 pr-2 text-xs text-slate-100 focus:outline-none"
                />
              </div>
            </div>
            {[...filter(POPULAR_PROVIDERS), ...filter(OTHER_PROVIDERS)].map((p) => (
              <Listbox.Option
                key={p.slug}
                value={p}
                className={({ active }) =>
                  `relative cursor-pointer select-none py-2 pl-8 pr-4 ${active ? "bg-emerald-500/10 text-emerald-200" : "text-slate-200"}`
                }
              >
                {({ selected: isSel }) => (
                  <>
                    <span className="font-medium">{p.title}</span>
                    {isSel && (
                      <span className="absolute inset-y-0 left-0 flex items-center pl-2 text-emerald-400">
                        <CheckIcon className="h-4 w-4" />
                      </span>
                    )}
                  </>
                )}
              </Listbox.Option>
            ))}
          </Listbox.Options>
        </Transition>
      </div>
    </Listbox>
  );
}

function ModelDropdown({
  models,
  selected,
  onSelect,
}: {
  models: CatalogueModel[];
  selected: CatalogueModel;
  onSelect: (m: CatalogueModel) => void;
}) {
  return (
    <Listbox value={selected} onChange={onSelect}>
      <div className="relative">
        <Listbox.Button className="relative w-full cursor-pointer rounded border border-slate-700 bg-slate-800 py-2 pl-3 pr-10 text-left text-sm text-slate-100">
          <span className="font-medium">{selected.displayName}</span>
          <span className="block text-xs text-slate-500">{selected.model}</span>
          <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
            <ChevronUpDownIcon className="h-5 w-5 text-slate-400" />
          </span>
        </Listbox.Button>
        <Transition
          as={Fragment}
          leave="transition ease-in duration-100"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <Listbox.Options className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded border border-slate-700 bg-slate-900 py-1 text-sm shadow-lg">
            {/* AUTODETECT option always first */}
            <Listbox.Option
              value={
                {
                  model: "AUTODETECT",
                  displayName: "Auto-detect",
                  description: "Use any model this key supports",
                  roles: ["chat", "edit", "apply"],
                } as CatalogueModel
              }
              className={({ active }) =>
                `relative cursor-pointer select-none py-2 pl-8 pr-4 ${active ? "bg-emerald-500/10" : ""} text-slate-200`
              }
            >
              {({ selected: isSel }) => (
                <>
                  <div className="font-medium">Auto-detect</div>
                  <div className="text-xs text-slate-500">Use any model this key supports</div>
                  {isSel && (
                    <span className="absolute inset-y-0 left-0 flex items-center pl-2 text-emerald-400">
                      <CheckIcon className="h-4 w-4" />
                    </span>
                  )}
                </>
              )}
            </Listbox.Option>
            {models.map((m) => (
              <Listbox.Option
                key={m.model}
                value={m}
                className={({ active }) =>
                  `relative cursor-pointer select-none py-2 pl-8 pr-4 ${active ? "bg-emerald-500/10 text-emerald-200" : "text-slate-200"}`
                }
              >
                {({ selected: isSel }) => (
                  <>
                    <div className="font-medium">{m.displayName}</div>
                    <div className="font-mono text-xs text-slate-500">{m.model}</div>
                    {isSel && (
                      <span className="absolute inset-y-0 left-0 flex items-center pl-2 text-emerald-400">
                        <CheckIcon className="h-4 w-4" />
                      </span>
                    )}
                  </>
                )}
              </Listbox.Option>
            ))}
          </Listbox.Options>
        </Transition>
      </div>
    </Listbox>
  );
}

// ─── Main page ───────────────────────────────────────────────────

export default function ModelsPage() {
  const [models, setModels] = useState<UserModelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  // Add-model form state
  const [showForm, setShowForm] = useState(false);
  const [provider, setProvider] = useState<CatalogueProvider>(
    findProvider("openai") ?? POPULAR_PROVIDERS[0],
  );
  const [model, setModel] = useState<CatalogueModel>(provider.models[0]);
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setModel(provider.models[0]);
    setApiKey("");
    setBaseUrl(provider.defaultBaseUrl ?? "");
  }, [provider]);

  const loadModels = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiClient.get<ListResponse>("/api/me/models/list");
      setModels(res.models);
      // Show the add form automatically if no models exist
      if (res.models.length === 0) setShowForm(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadModels();
  }, [loadModels]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBanner(null);
    setSubmitting(true);
    try {
      await apiClient.post("/api/me/models/add", {
        providerSlug: provider.slug,
        modelSlug: model.model,
        displayName: model.displayName,
        apiKey: !provider.requiresApiKey && !apiKey ? "no-key-needed" : apiKey,
        apiBase: baseUrl || provider.defaultBaseUrl || undefined,
      });
      setBanner(`Added ${model.displayName} (${provider.title})`);
      setShowForm(false);
      setApiKey("");
      await loadModels();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(m: UserModelRow) {
    if (!confirm(`Remove ${m.displayName || m.modelSlug}?`)) return;
    setError(null);
    setBanner(null);
    try {
      await apiClient.del(`/api/me/models/${m.id}`);
      setBanner(`Removed ${m.displayName || m.modelSlug}`);
      await loadModels();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Models</h1>
          <p className="mt-1 text-sm text-slate-400">
            Add your LLM provider keys and models. These are available in the CLI, VS Code,
            JetBrains, and web chat.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void loadModels()}
            className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800"
          >
            <ArrowPathIcon className="h-4 w-4" /> Refresh
          </button>
          <button
            onClick={() => setShowForm(true)}
            className="inline-flex items-center gap-1 rounded bg-emerald-500 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-600"
          >
            <PlusIcon className="h-4 w-4" /> Add Model
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded border border-red-900 bg-red-950/50 p-3 text-sm text-red-300">
          {error}
        </div>
      )}
      {banner && !error && (
        <div className="rounded border border-emerald-900 bg-emerald-950/40 p-3 text-sm text-emerald-300">
          {banner}
        </div>
      )}

      {/* Add model form */}
      {showForm && (
        <form
          onSubmit={handleAdd}
          className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/60 p-6"
        >
          <div className="text-lg font-semibold">Add a model</div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-300">Provider</label>
              <ProviderDropdown selected={provider} onSelect={setProvider} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-300">Model</label>
              <ModelDropdown models={provider.models} selected={model} onSelect={setModel} />
            </div>
          </div>

          {provider.requiresApiKey && (
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-300">API Key</label>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={provider.keyPlaceholder ?? "Paste your API key"}
                className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 font-mono text-sm"
                required
              />
              {provider.apiKeyUrl && (
                <a
                  href={provider.apiKeyUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 block text-xs text-emerald-400 hover:text-emerald-300"
                >
                  Get a {provider.title} API key →
                </a>
              )}
            </div>
          )}

          {(provider.requiresBaseUrl || provider.defaultBaseUrl) && (
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-300">
                Base URL {provider.requiresBaseUrl ? "(required)" : "(optional)"}
              </label>
              <input
                type="text"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder={provider.defaultBaseUrl ?? ""}
                className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 font-mono text-sm"
              />
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={submitting}
              className="rounded bg-emerald-500 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
            >
              {submitting ? "Adding…" : "Add"}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded border border-slate-700 bg-slate-900 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Models list */}
      {loading ? (
        <div className="py-12 text-center text-slate-500">Loading models…</div>
      ) : models.length === 0 && !showForm ? (
        <div className="rounded-xl border border-dashed border-slate-700 py-16 text-center">
          <div className="text-lg font-medium text-slate-400">No models configured</div>
          <p className="mt-2 text-sm text-slate-500">
            Click "Add Model" to get started. You'll need at least one model to use AI Firewall
            chat.
          </p>
        </div>
      ) : (
        <div className="divide-y divide-slate-800 rounded-xl border border-slate-800 bg-slate-900/40">
          {models.map((m) => (
            <div
              key={m.id}
              className="flex items-center justify-between px-5 py-4 hover:bg-slate-800/30"
            >
              <div>
                <div className="font-medium text-slate-100">{m.displayName || m.modelSlug}</div>
                <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
                  <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono">
                    {m.providerSlug}
                  </span>
                  <span className="font-mono">{m.modelSlug}</span>
                  {m.apiBase && <span className="text-slate-600">@ {m.apiBase}</span>}
                </div>
              </div>
              <button
                onClick={() => void handleDelete(m)}
                className="rounded p-2 text-slate-500 hover:bg-red-950/40 hover:text-red-400"
                title="Remove model"
              >
                <TrashIcon className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-slate-500">
        Models added here are stored per-user in the proxy database (AES-256-GCM encrypted). Use{" "}
        <span className="font-mono">/sync</span> in the CLI to pull new models into a running
        session.
      </p>
    </div>
  );
}
