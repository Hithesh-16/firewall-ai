import { ArrowPathIcon } from "@heroicons/react/24/outline";
import { useCallback, useEffect, useMemo, useState } from "react";

import { apiClient } from "../../api/client";
import { usePermission } from "../../hooks/usePermission";
import {
  CatalogueModel,
  CatalogueProvider,
  findProvider,
  PROVIDER_CATALOGUE,
} from "../../data/providerCatalogue";

/**
 * Phase F (slice 2) — admin Model Access page.
 *
 * Matrix of users × (provider + model) with a checkbox per cell.
 * Admin ticks the boxes → Save → one bulk POST creates every grant
 * inside a DB transaction. Revoke by unticking.
 *
 * Backed by:
 *   - GET  /api/orgs/:id/model-grants       (list all grants)
 *   - GET  /api/users                       (list users to grant to)
 *   - POST /api/orgs/:id/model-grants/bulk  (create grants)
 *   - DELETE /api/orgs/:id/model-grants/:id (revoke)
 *
 * Team grants aren't surfaced in this first iteration — the
 * backend supports them but building the team-expand UX is a
 * follow-up. Users-only is enough for day one.
 */

interface OrgUser {
  id: number;
  email: string;
  name?: string;
}

interface Grant {
  id: number;
  orgId: number;
  granteeType: "user" | "team";
  granteeId: number;
  providerSlug: string;
  modelSlug: string;
  grantedAt: number;
}

type MatrixKey = `${number}:${string}/${string}`;

function matrixKey(userId: number, providerSlug: string, modelSlug: string): MatrixKey {
  return `${userId}:${providerSlug}/${modelSlug}`;
}

export default function ModelAccessPage() {
  const canEdit = usePermission("policies", "edit");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const [orgId, setOrgId] = useState<number | null>(null);
  const [users, setUsers] = useState<OrgUser[]>([]);
  const [grants, setGrants] = useState<Grant[]>([]);

  // Which provider tab is currently expanded.
  const [activeProvider, setActiveProvider] = useState<string>(PROVIDER_CATALOGUE[0].slug);

  // Matrix edit state: a Set of string keys representing "checked" cells.
  // Initialized from the server-side grant list, mutated locally,
  // persisted via the bulk POST on Save.
  const [checkedKeys, setCheckedKeys] = useState<Set<MatrixKey>>(new Set());
  const [originalKeys, setOriginalKeys] = useState<Set<MatrixKey>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Step 1: who am I? Used to scope every org-level call.
      const me = await apiClient.get<{ user: { orgId?: number } }>("/api/auth/me");
      const resolvedOrgId = me.user?.orgId ?? null;
      if (!resolvedOrgId) {
        setError("You're not a member of an organization.");
        setLoading(false);
        return;
      }
      setOrgId(resolvedOrgId);

      // Step 2: parallel fetch users + existing grants.
      const [usersRes, grantsRes] = await Promise.all([
        apiClient.get<{ users: OrgUser[] }>("/api/users"),
        apiClient.get<{ grants: Grant[] }>(`/api/orgs/${resolvedOrgId}/model-grants`),
      ]);
      setUsers(usersRes.users ?? []);
      const g = grantsRes.grants ?? [];
      setGrants(g);

      // Build the initial matrix state from the grant list.
      const keys = new Set<MatrixKey>();
      for (const grant of g) {
        if (grant.granteeType !== "user") continue;
        keys.add(matrixKey(grant.granteeId, grant.providerSlug, grant.modelSlug));
      }
      setCheckedKeys(keys);
      setOriginalKeys(new Set(keys));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const provider = useMemo<CatalogueProvider>(
    () => findProvider(activeProvider) ?? PROVIDER_CATALOGUE[0],
    [activeProvider],
  );

  const isDirty = useMemo(() => {
    if (checkedKeys.size !== originalKeys.size) return true;
    for (const k of checkedKeys) {
      if (!originalKeys.has(k)) return true;
    }
    return false;
  }, [checkedKeys, originalKeys]);

  function toggleCell(userId: number, model: CatalogueModel) {
    const key = matrixKey(userId, provider.slug, model.model);
    setCheckedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleWildcardRow(userId: number) {
    // "Grant all models from this provider" via the `*` slug.
    const key = matrixKey(userId, provider.slug, "*");
    setCheckedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  async function handleSave() {
    if (!orgId || !canEdit) return;
    setSaving(true);
    setError(null);
    setBanner(null);

    try {
      // Diff: find keys to add vs keys to remove.
      const toAdd: Array<{
        granteeType: "user" | "team";
        granteeId: number;
        providerSlug: string;
        modelSlug: string;
      }> = [];
      for (const key of checkedKeys) {
        if (originalKeys.has(key)) continue;
        const [userPart, rest] = key.split(":");
        const [providerSlug, modelSlug] = rest.split("/");
        toAdd.push({
          granteeType: "user",
          granteeId: Number(userPart),
          providerSlug,
          modelSlug,
        });
      }

      const toDeleteIds: number[] = [];
      for (const key of originalKeys) {
        if (checkedKeys.has(key)) continue;
        // Find the grant id for this (userId, provider, model)
        const [userPart, rest] = key.split(":");
        const [providerSlug, modelSlug] = rest.split("/");
        const userId = Number(userPart);
        const match = grants.find(
          (g) =>
            g.granteeType === "user" &&
            g.granteeId === userId &&
            g.providerSlug === providerSlug &&
            g.modelSlug === modelSlug,
        );
        if (match) toDeleteIds.push(match.id);
      }

      // Parallel: one bulk POST + N DELETEs. Keep the DELETEs
      // sequential so a mid-loop error doesn't leave partial state.
      if (toAdd.length > 0) {
        await apiClient.post(`/api/orgs/${orgId}/model-grants/bulk`, {
          grants: toAdd,
        });
      }
      for (const id of toDeleteIds) {
        await apiClient.del(`/api/orgs/${orgId}/model-grants/${id}`);
      }

      setBanner(
        `Saved. ${toAdd.length} grant${
          toAdd.length === 1 ? "" : "s"
        } added, ${toDeleteIds.length} revoked.`,
      );
      // Refresh the server state so the diff baseline is correct
      // for the next round of edits.
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  function handleRevert() {
    setCheckedKeys(new Set(originalKeys));
    setBanner("Reverted unsaved changes.");
    setError(null);
  }

  // ─── Rendering ───────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-slate-400">
        Loading model grants…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Model Access</h1>
          <p className="mt-1 text-sm text-slate-400">
            Grant specific users access to specific models. Users who aren't granted a model can't
            see it in the CLI, IDE, or chat — even if the org has the provider key configured.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRevert}
            disabled={!isDirty || saving}
            className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-40"
          >
            Revert
          </button>
          <button
            onClick={() => void load()}
            disabled={saving}
            className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-40"
          >
            <ArrowPathIcon className="h-4 w-4" /> Reload
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={!canEdit || !isDirty || saving}
            className="inline-flex items-center gap-1 rounded bg-emerald-500 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-600 disabled:opacity-40"
          >
            {saving ? "Saving…" : "Save grants"}
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

      {/* Provider tabs */}
      <div className="flex flex-wrap gap-1 border-b border-slate-800">
        {PROVIDER_CATALOGUE.map((p) => (
          <button
            key={p.slug}
            onClick={() => setActiveProvider(p.slug)}
            className={`rounded-t px-3 py-2 text-xs font-medium transition ${
              activeProvider === p.slug
                ? "bg-slate-800 text-emerald-300"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {p.title}
          </button>
        ))}
      </div>

      {/* Grant matrix */}
      <div className="overflow-x-auto rounded border border-slate-800 bg-slate-900/40">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800 text-left text-xs text-slate-400">
              <th className="sticky left-0 bg-slate-900/80 px-4 py-3">User</th>
              <th className="px-3 py-3 text-center" title="Grant all models from this provider">
                All ({provider.title})
              </th>
              {provider.models.map((m) => (
                <th
                  key={m.model}
                  className="px-3 py-3 text-center"
                  title={m.description ?? m.model}
                >
                  <div className="font-medium text-slate-300">{m.displayName}</div>
                  <div className="font-mono text-[10px] text-slate-500">{m.model}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.length === 0 && (
              <tr>
                <td colSpan={provider.models.length + 2} className="p-8 text-center text-slate-500">
                  No users in this org yet. Invite users first, then come back to grant model
                  access.
                </td>
              </tr>
            )}
            {users.map((user) => {
              const wildcardKey = matrixKey(user.id, provider.slug, "*");
              const hasWildcard = checkedKeys.has(wildcardKey);
              return (
                <tr key={user.id} className="border-b border-slate-800/60 hover:bg-slate-800/30">
                  <td className="sticky left-0 bg-slate-900/80 px-4 py-3">
                    <div className="font-medium text-slate-200">{user.name || user.email}</div>
                    {user.name && <div className="text-xs text-slate-500">{user.email}</div>}
                  </td>
                  <td className="px-3 py-3 text-center">
                    <input
                      type="checkbox"
                      checked={hasWildcard}
                      disabled={!canEdit}
                      onChange={() => toggleWildcardRow(user.id)}
                      className="h-4 w-4 rounded border-slate-600 bg-slate-800 text-emerald-500 focus:ring-emerald-500"
                    />
                  </td>
                  {provider.models.map((m) => {
                    const key = matrixKey(user.id, provider.slug, m.model);
                    const checked = checkedKeys.has(key) || hasWildcard;
                    return (
                      <td key={m.model} className="px-3 py-3 text-center">
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={!canEdit || hasWildcard}
                          onChange={() => toggleCell(user.id, m)}
                          className="h-4 w-4 rounded border-slate-600 bg-slate-800 text-emerald-500 focus:ring-emerald-500 disabled:opacity-40"
                        />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-slate-500">
        <strong className="text-slate-400">Tip:</strong> check the{" "}
        <span className="font-mono">All ({provider.title})</span> column to grant every model this
        provider catalogues. Useful for platform-team roles who should always get the full list
        without manual bookkeeping when new models are added.
      </p>
    </div>
  );
}
