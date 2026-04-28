import {
  ArrowPathIcon,
  BuildingOfficeIcon,
  CubeTransparentIcon,
  PlusIcon,
  TrashIcon,
  UserIcon,
} from "@heroicons/react/24/outline";
import { useEffect, useMemo, useState } from "react";

import { apiClient } from "../../api/client";
import { ENDPOINTS } from "../../api/endpoints";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { EmptyState } from "../../components/ui/EmptyState";
import { ErrorBanner } from "../../components/ui/ErrorBanner";
import { Pagination } from "../../components/ui/Pagination";
import { SearchInput } from "../../components/ui/SearchInput";
import { SkeletonList } from "../../components/ui/Skeleton";
import {
  findProvider,
  POPULAR_PROVIDERS,
  type CatalogueModel,
  type CatalogueProvider,
} from "../../data/providerCatalogue";
import { ModelPicker, ProviderPicker } from "../../components/shared/ModelPickers";
import { UnifiedModelForm } from "../../components/shared/UnifiedModelForm";
import { useServerTable } from "../../hooks/useServerTable";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import { showToast } from "../../store/slices/uiSlice";

/**
 * Unified Models page — the single self-serve surface where a user
 * adds, views, and removes models they have access to.
 *
 * Two sources feed this list:
 *   1. Models the user added themselves    (createdBy === self.id)
 *   2. Models the org admin assigned       (createdBy !== self.id)
 *
 * Styling mirrors the Organisation > Providers tab (Card + Button +
 * Badge + ConfirmDialog + EmptyState) so the two surfaces feel like
 * one product. Admin-assigned rows get an "Assigned by org" badge and
 * a disabled delete button — only the admin can revoke them, via
 * Organisation Settings > Model Access.
 *
 * Data flows through the unified user_models table:
 *   GET    /api/me/models/list       → list (now includes createdBy)
 *   POST   /api/me/models/add        → add self-serve
 *   DELETE /api/me/models/:id        → remove self-added only
 *
 * The gateway reads the same table on every /v1/chat/completions
 * request, so adding a model here makes it usable immediately in
 * the CLI, VS Code, JetBrains, and web chat.
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
  updatedAt: number;
  createdBy: number | null;
}

export default function ModelsPage() {
  const dispatch = useAppDispatch();
  const currentUser = useAppSelector((s) => s.auth.user);
  const currentUserId = useMemo<number | null>(() => {
    if (!currentUser?.id) return null;
    const n = Number(currentUser.id);
    return Number.isFinite(n) ? n : null;
  }, [currentUser]);

  // BE-driven pagination + search via the shared hook.
  // `/api/me/models/list` returns `{items, total, page, pageSize, hasMore}`
  // when `page` is in the query string (legacy callers that don't
  // send pagination still get the unpaged `{models, hasAny}` shape).
  const {
    items: models,
    total,
    page,
    totalPages,
    loading,
    error,
    search,
    setPage,
    setSearch,
    refetch,
  } = useServerTable<UserModelRow>({
    endpoint: ENDPOINTS.me.modelsList,
    pageSize: 20,
  });

  // Auto-open the add form on the very first visit so the page is
  // not a dead "No models" screen.
  const [showForm, setShowForm] = useState(false);
  useEffect(() => {
    if (!loading && total === 0 && !search) {
      setShowForm(true);
    }
  }, [loading, total, search]);

  const [deleteTarget, setDeleteTarget] = useState<UserModelRow | null>(null);

  async function handleDelete(m: UserModelRow) {
    try {
      await apiClient.del(ENDPOINTS.me.model(String(m.id)));
      refetch();
      dispatch(
        showToast({
          id: `model-del-${Date.now()}`,
          type: "success",
          message: `Removed ${m.displayName || m.modelSlug}`,
        }),
      );
    } catch (err) {
      dispatch(
        showToast({
          id: `model-derr-${Date.now()}`,
          type: "error",
          message: err instanceof Error ? err.message : "Failed to remove",
        }),
      );
    } finally {
      setDeleteTarget(null);
    }
  }

  function isAssignedByOrg(m: UserModelRow): boolean {
    // createdBy is null when the row predates the createdBy column
    // (very old rows — treat as self-added to avoid locking users out
    // of deleting their own models). An explicit createdBy that
    // matches the current user is also self-serve.
    if (m.createdBy == null) return false;
    if (currentUserId == null) return false;
    return m.createdBy !== currentUserId;
  }

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-foreground text-2xl font-bold">Models</h1>
          <p className="text-description mt-1 text-sm">
            LLM providers and models you can use from the CLI, VS Code, JetBrains, and web chat.
            Models marked{" "}
            <Badge variant="info" className="mx-1 inline-flex align-middle">
              Assigned by org
            </Badge>
            were granted by your org admin.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => refetch()}>
            <ArrowPathIcon className="h-4 w-4" />
            Refresh
          </Button>
          <Button size="sm" onClick={() => setShowForm((v) => !v)}>
            <PlusIcon className="h-4 w-4" />
            Add Model
          </Button>
        </div>
      </div>

      {error && <ErrorBanner message={error} />}

      {/* Single-source-of-truth banner — make it unambiguous that
          this page is where models are stored, and the assistant
          YAML is only for rules / MCP / context / system message. */}
      <div className="border-info/30 bg-info/5 text-description rounded-md border px-3 py-2 text-xs leading-relaxed">
        <span className="text-foreground font-medium">Models live with your account.</span> What you
        add here is used everywhere — web chat, VS Code, JetBrains, and the CLI (
        <span className="font-mono">cn</span>). Rules, MCP servers, context providers, and system
        messages are a separate concern and belong under{" "}
        <span className="font-mono">Settings → Assistant</span>.
      </div>

      <div className="flex items-center gap-3">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search models…"
          className="max-w-sm flex-1"
        />
        <span className="text-description-muted text-xs">
          {total} {total === 1 ? "model" : "models"}
        </span>
      </div>

      {showForm && (
        <UnifiedModelForm
          onCancel={() => setShowForm(false)}
          onSave={async (values) => {
            try {
              const res = await apiClient.post<{ model: UserModelRow }>(ENDPOINTS.me.modelsAdd, {
                providerSlug: values.providerSlug,
                modelSlug: values.modelSlug,
                displayName: values.name,
                apiKey: values.apiKey,
                apiBase: values.apiBase,
                roles: values.roles,
              });
              setShowForm(false);
              refetch();
              dispatch(
                showToast({
                  id: `model-add-${Date.now()}`,
                  type: "success",
                  message: `Added ${res.model.displayName || res.model.modelSlug}`,
                }),
              );
            } catch (err) {
              dispatch(
                showToast({
                  id: `model-aerr-${Date.now()}`,
                  type: "error",
                  message: err instanceof Error ? err.message : "Failed to add model",
                }),
              );
            }
          }}
        />
      )}

      {loading ? (
        <SkeletonList count={4} withAvatar={false} />
      ) : models.length === 0 && !showForm ? (
        <EmptyState
          icon={<CubeTransparentIcon className="h-12 w-12" />}
          title={search ? `No models match "${search}"` : "No models yet"}
          description={
            search
              ? "Try a different search term, or clear the search to see everything."
              : "Add your first provider + model, or ask your org admin to assign you access."
          }
        />
      ) : (
        <div className="space-y-3">
          {models.map((m) => {
            const assigned = isAssignedByOrg(m);
            return (
              <Card key={m.id} padding={false}>
                <div className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-3">
                    {assigned ? (
                      <BuildingOfficeIcon className="text-info h-4 w-4 flex-shrink-0" />
                    ) : (
                      <UserIcon className="text-description h-4 w-4 flex-shrink-0" />
                    )}
                    <div>
                      <p className="text-foreground text-sm font-medium">
                        {m.displayName || m.modelSlug}
                      </p>
                      <div className="mt-0.5 flex items-center gap-2 text-xs">
                        <span className="text-description-muted rounded bg-badge/40 px-1.5 py-0.5 font-mono">
                          {m.providerSlug}
                        </span>
                        <span className="text-description-muted font-mono">{m.modelSlug}</span>
                        {m.apiBase && <span className="text-description-muted">@ {m.apiBase}</span>}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {assigned ? (
                      <Badge variant="info">Assigned by org</Badge>
                    ) : (
                      <Badge variant="success">Added by you</Badge>
                    )}
                    <Button
                      variant="icon"
                      aria-label={`Remove ${m.modelSlug}`}
                      disabled={assigned}
                      title={
                        assigned
                          ? "This model was assigned by your org admin. Contact them to revoke it."
                          : "Remove model"
                      }
                      onClick={() => !assigned && setDeleteTarget(m)}
                    >
                      <TrashIcon className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {totalPages > 1 && (
        <Pagination page={page} totalPages={totalPages} onPageChange={setPage} total={total} />
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && handleDelete(deleteTarget)}
        title="Remove model"
        message={
          deleteTarget
            ? `Remove "${deleteTarget.displayName || deleteTarget.modelSlug}"? This will delete its API key from your account.`
            : ""
        }
        confirmLabel="Remove"
        variant="danger"
      />

      <p className="text-description-muted text-xs">
        Models are stored per-user in the proxy database (AES-256-GCM encrypted). Use{" "}
        <span className="font-mono">/sync</span> in the CLI to pull new models into a running
        session.
      </p>
    </div>
  );
}
