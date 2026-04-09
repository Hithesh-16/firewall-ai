import Editor, { OnMount } from "@monaco-editor/react";
import {
  ArrowDownTrayIcon,
  ArrowPathIcon,
  ArrowUturnLeftIcon,
  BoltIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import { useCallback, useEffect, useRef, useState } from "react";

import { apiClient } from "../../api/client";
import { usePermission } from "../../hooks/usePermission";
import { PermissionGate } from "../../components/shared/guard/PermissionGate";

/**
 * Phase F — Assistant YAML editor.
 *
 * A single page that lets two classes of user do three things:
 *
 *   1. A regular user, whose role policy permits personal overrides,
 *      can create or edit their own default assistant. Saved via
 *      `PUT /api/me/assistants/default`. This is what the CLI loads
 *      when `AI_FIREWALL_USE_API_ASSISTANT=1`.
 *
 *   2. An admin (holding the `policies.edit` capability) can edit
 *      the org-level default assistant that applies to every user
 *      in the org unless they have a personal override. Saved via
 *      `PUT /api/orgs/:orgId/assistants/default`.
 *
 *   3. Either user can "fork to personal" — take whatever assistant
 *      is currently in view and save a personal copy for themselves
 *      without disturbing the org default.
 *
 * The editor itself is Monaco with YAML syntax highlighting. Schema
 * validation is lightweight (YAML parse errors + a few required-key
 * sanity checks). The full Zod schema lives in
 * `@ai-firewall/config-yaml` and will be wired in as a follow-up
 * — for now, the proxy does the authoritative validation at
 * `unrollAssistantFromContent` time, so a bad YAML can't silently
 * corrupt anything; it'll fail loudly on the next CLI boot.
 */

interface AssistantOwner {
  type: "org" | "user";
  id: number;
}

interface AssistantPayload {
  slug: string;
  name: string;
  owner: AssistantOwner;
  yaml: string;
  etag: string;
  isDefault: boolean;
  updatedAt: number;
}

interface GetAssistantResponse {
  assistant: AssistantPayload;
}

interface ModelsResponse {
  hasAny: boolean;
  canAddPersonal: boolean;
  hasAssistant: boolean;
}

// Small helper: try to parse YAML in the browser so we can show
// instant feedback on the save button. We don't bundle `yaml` here
// — we just look for obvious structural problems. Full schema
// validation happens server-side on save.
function quickValidate(yaml: string): string | null {
  if (!yaml.trim()) return "Assistant YAML is empty.";
  if (!yaml.includes("name:")) return "Missing required `name:` field.";
  if (!yaml.includes("schema:")) return "Missing required `schema: v1` field.";
  if (!yaml.includes("models:") && !yaml.includes("models :"))
    return "Missing `models:` block — at least one model must be declared.";
  return null;
}

function fmtWhen(ts: number): string {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

export default function AssistantPage() {
  const canEditOrg = usePermission("policies", "edit");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const [assistant, setAssistant] = useState<AssistantPayload | null>(null);
  const [yaml, setYaml] = useState<string>("");
  const [originalYaml, setOriginalYaml] = useState<string>("");
  const [modelStatus, setModelStatus] = useState<ModelsResponse | null>(null);

  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);

  // ─── Initial load ────────────────────────────────────────────

  const loadAssistant = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [a, m] = await Promise.all([
        apiClient.get<GetAssistantResponse>("/api/me/assistant").catch(() => null),
        apiClient.get<ModelsResponse>("/api/me/models").catch(() => null),
      ]);
      setModelStatus(m);
      if (a?.assistant) {
        setAssistant(a.assistant);
        setYaml(a.assistant.yaml);
        setOriginalYaml(a.assistant.yaml);
      } else {
        // No assistant yet — seed with a minimal template.
        const template =
          "# AI Firewall assistant — edit this YAML and click Save.\n" +
          "# See docs/developer/onboarding.mdx for the full schema.\n" +
          "name: my-assistant\n" +
          "schema: v1\n" +
          "version: 0.0.1\n" +
          "models:\n" +
          "  - name: GPT-4o\n" +
          "    provider: openai\n" +
          "    model: gpt-4o\n" +
          "    roles: [chat, edit]\n";
        setAssistant(null);
        setYaml(template);
        setOriginalYaml(template);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAssistant();
  }, [loadAssistant]);

  // ─── Save handlers ───────────────────────────────────────────

  async function saveAsPersonal() {
    const problem = quickValidate(yaml);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    setBanner(null);
    try {
      await apiClient.put("/api/me/assistants/default", {
        name: assistant?.name ?? "Personal assistant",
        yaml,
        isDefault: true,
      });
      setBanner("Saved as your personal default assistant.");
      await loadAssistant();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function saveAsOrg() {
    if (!canEditOrg) {
      setError("You don't have permission to edit the org assistant.");
      return;
    }
    const problem = quickValidate(yaml);
    if (problem) {
      setError(problem);
      return;
    }
    // We need the user's orgId. The /api/me/assistant response
    // includes it when the current assistant is org-owned. When
    // the user is creating a brand new personal-first assistant
    // we can't derive the org id from the response — fetch it
    // from /api/me/policy which is already authenticated.
    let orgId: number | null = null;
    if (assistant?.owner.type === "org") {
      orgId = assistant.owner.id;
    } else {
      try {
        const me = await apiClient.get<{ user?: { orgId?: number } }>("/api/auth/me");
        orgId = me.user?.orgId ?? null;
      } catch {
        /* ignore — handled below */
      }
    }
    if (!orgId) {
      setError("Could not determine your org id for the org-level save.");
      return;
    }

    setSaving(true);
    setError(null);
    setBanner(null);
    try {
      await apiClient.put(`/api/orgs/${orgId}/assistants/default`, {
        name: assistant?.name ?? "Org default assistant",
        yaml,
        isDefault: true,
      });
      setBanner("Saved as the org default assistant.");
      await loadAssistant();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function forkToPersonal() {
    // Copy the current editor buffer into a personal assistant
    // without changing the org default. The user then edits freely
    // in place.
    const problem = quickValidate(yaml);
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    setError(null);
    setBanner(null);
    try {
      await apiClient.put("/api/me/assistants/default", {
        name: "Forked from org default",
        yaml,
        isDefault: true,
      });
      setBanner("Forked. You're now editing your personal override.");
      await loadAssistant();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function deletePersonal() {
    if (!confirm("Delete your personal assistant and revert to the org default?")) return;
    setSaving(true);
    setError(null);
    setBanner(null);
    try {
      await apiClient.del("/api/me/assistants/default");
      setBanner("Personal assistant deleted. Using org default.");
      await loadAssistant();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  function revertLocalEdits() {
    setYaml(originalYaml);
    setError(null);
    setBanner("Reverted unsaved changes.");
  }

  // ─── Monaco wiring ───────────────────────────────────────────

  const handleEditorMount: OnMount = (editor) => {
    editorRef.current = editor;
    // Nothing fancy — just hand the ref. Monaco's YAML mode gives
    // us indentation guides, folding, and basic colouring out of
    // the box. A future pass can wire monaco-yaml for in-editor
    // schema validation.
  };

  // ─── Rendering ───────────────────────────────────────────────

  const isDirty = yaml !== originalYaml;
  const ownerLabel = assistant
    ? assistant.owner.type === "org"
      ? `Org default (id: ${assistant.owner.id})`
      : `Your personal override`
    : "Unsaved";

  return (
    <div className="mx-auto flex h-full max-w-6xl flex-col gap-4 p-6">
      {/* ── Header ───────────────────────────────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Assistant</h1>
          <p className="mt-1 text-sm text-slate-400">
            Your AI Firewall assistant definition — models, MCP servers, context providers, rules,
            and prompts. This is the file the CLI loads when{" "}
            <span className="font-mono text-slate-300">AI_FIREWALL_USE_API_ASSISTANT=1</span>.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={revertLocalEdits}
            disabled={!isDirty || saving}
            className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-40"
            title="Discard unsaved changes"
          >
            <ArrowUturnLeftIcon className="h-4 w-4" /> Revert
          </button>
          <button
            onClick={() => void loadAssistant()}
            disabled={saving}
            className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-40"
          >
            <ArrowPathIcon className="h-4 w-4" /> Reload
          </button>
        </div>
      </div>

      {/* ── Status strip ─────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 rounded border border-slate-800 bg-slate-900/60 px-4 py-3 text-sm">
        <div className="flex items-center gap-2">
          <BoltIcon className="h-4 w-4 text-emerald-400" />
          <span className="text-slate-300">Source:</span>
          <span className="font-medium text-slate-100">{ownerLabel}</span>
        </div>
        {assistant && (
          <div className="text-xs text-slate-500">
            Updated {fmtWhen(assistant.updatedAt)}
            <span className="mx-2">·</span>
            etag <span className="font-mono">{assistant.etag.slice(0, 16)}…</span>
          </div>
        )}
        <div className="ml-auto flex items-center gap-2">
          {modelStatus && modelStatus.hasAny ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-950/60 px-2 py-0.5 text-xs text-emerald-300">
              <CheckCircleIcon className="h-3.5 w-3.5" /> models reachable
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-950/60 px-2 py-0.5 text-xs text-amber-300">
              <ExclamationTriangleIcon className="h-3.5 w-3.5" /> no models reachable
            </span>
          )}
        </div>
      </div>

      {/* ── Banners ──────────────────────────────────────── */}
      {error && (
        <div className="rounded border border-red-900 bg-red-950/50 px-4 py-3 text-sm text-red-300">
          {error}
        </div>
      )}
      {banner && !error && (
        <div className="rounded border border-emerald-900 bg-emerald-950/40 px-4 py-3 text-sm text-emerald-300">
          {banner}
        </div>
      )}

      {/* ── Editor ───────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden rounded border border-slate-800 bg-slate-900">
        {loading ? (
          <div className="flex h-full items-center justify-center text-slate-500">
            Loading assistant…
          </div>
        ) : (
          <Editor
            height="520px"
            defaultLanguage="yaml"
            theme="vs-dark"
            value={yaml}
            onChange={(v) => setYaml(v ?? "")}
            onMount={handleEditorMount}
            options={{
              minimap: { enabled: false },
              fontSize: 13,
              tabSize: 2,
              wordWrap: "on",
              scrollBeyondLastLine: false,
              automaticLayout: true,
              renderWhitespace: "boundary",
            }}
          />
        )}
      </div>

      {/* ── Action bar ───────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-slate-800 bg-slate-900/60 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => void saveAsPersonal()}
            disabled={saving || !isDirty}
            className="inline-flex items-center gap-1 rounded bg-emerald-500 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-40"
          >
            <ArrowDownTrayIcon className="h-4 w-4" />
            {saving ? "Saving…" : "Save as personal"}
          </button>

          <PermissionGate module="policies" action="edit">
            <button
              onClick={() => void saveAsOrg()}
              disabled={saving || !isDirty}
              className="inline-flex items-center gap-1 rounded border border-blue-500 bg-blue-950/40 px-4 py-2 text-sm font-semibold text-blue-200 hover:bg-blue-950/70 disabled:opacity-40"
            >
              <ArrowDownTrayIcon className="h-4 w-4" />
              Save as org default
            </button>
          </PermissionGate>

          {assistant?.owner.type === "org" && (
            <button
              onClick={() => void forkToPersonal()}
              disabled={saving}
              className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-4 py-2 text-sm text-slate-200 hover:bg-slate-800 disabled:opacity-40"
            >
              Fork to personal
            </button>
          )}

          {assistant?.owner.type === "user" && (
            <button
              onClick={() => void deletePersonal()}
              disabled={saving}
              className="inline-flex items-center gap-1 rounded border border-red-900 bg-red-950/40 px-4 py-2 text-sm text-red-300 hover:bg-red-950/70 disabled:opacity-40"
            >
              <TrashIcon className="h-4 w-4" /> Delete personal
            </button>
          )}
        </div>
        <div className="text-xs text-slate-500">{isDirty ? "Unsaved changes" : "Saved"}</div>
      </div>
    </div>
  );
}
