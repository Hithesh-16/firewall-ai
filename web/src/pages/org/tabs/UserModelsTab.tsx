import {
  ChevronDownIcon,
  ChevronRightIcon,
  CubeTransparentIcon,
  PlusIcon,
  TrashIcon,
  UsersIcon,
} from "@heroicons/react/24/outline";
import { useCallback, useEffect, useMemo, useState } from "react";

import { apiClient } from "../../../api/client";
import { ENDPOINTS } from "../../../api/endpoints";
import type { User } from "../../../api/types";
import { Avatar } from "../../../components/ui/Avatar";
import { Badge } from "../../../components/ui/Badge";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import { EmptyState } from "../../../components/ui/EmptyState";
import { ErrorBanner } from "../../../components/ui/ErrorBanner";
import { LoadingSpinner } from "../../../components/ui/LoadingSpinner";
import { Pagination } from "../../../components/ui/Pagination";
import { SearchInput } from "../../../components/ui/SearchInput";
import { SkeletonList } from "../../../components/ui/Skeleton";
import { useAppDispatch, useAppSelector } from "../../../store/hooks";
import { showToast } from "../../../store/slices/uiSlice";

/**
 * Org-admin surface for granting LLM models to members of the org.
 *
 * Backend: /api/orgs/:orgId/model-grants — a (user, providerSlug,
 * modelSlug) triple. The gateway resolves the API key from the org's
 * stored provider at request time via resolveProviderForUser, so the
 * admin NEVER re-enters a key here — they just pick a model from the
 * set the org has already configured (Org Settings > Providers).
 *
 * UX model (mirrors OrgSettingsPage > Providers):
 *   - Card-per-user, collapsed by default.
 *   - Expand to see grants this user has + an "Assign model" form.
 *   - The assign dropdown is bounded by the org's configured
 *     providers + their cataloged models. Picking a model that isn't
 *     on any org provider is impossible by construction.
 *   - Trash icon on each row → confirm dialog → DELETE grant.
 *
 * The granted (providerSlug, modelSlug) pair also shows up on the
 * target user's /settings/models page with an "Assigned by org"
 * badge (rendered by the extended /api/me/models/list handler in
 * userModels.route.ts).
 */

// ─── Types ────────────────────────────────────────────────────────────────

interface Grant {
  id: number;
  orgId: number;
  granteeType: "user" | "team";
  granteeId: number;
  providerSlug: string;
  modelSlug: string;
  grantedAt: number;
  grantedBy: number | null;
}

interface OrgProvider {
  id: number;
  name: string;
  slug: string;
  baseUrl: string;
  enabled: boolean;
}

interface OrgProviderModel {
  id: number;
  providerId: number;
  modelName: string;
  displayName: string | null;
  inputCostPer1k?: number;
  outputCostPer1k?: number;
  enabled?: boolean;
}

interface UserWithGrants extends User {
  grants?: Grant[];
  loading?: boolean;
  showAddForm?: boolean;
}

// ─── Main component ───────────────────────────────────────────────────────

export function UserModelsTab() {
  const dispatch = useAppDispatch();
  const currentUser = useAppSelector((s) => s.auth.user);
  const orgId = useMemo(() => {
    const raw = currentUser?.orgId;
    if (raw == null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? String(n) : null;
  }, [currentUser]);

  const [users, setUsers] = useState<UserWithGrants[]>([]);
  const [providers, setProviders] = useState<OrgProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    userId: string;
    grant: Grant;
  } | null>(null);

  // P11-SERVER: pagination + search state driven by the backend.
  // The /api/admin/users endpoint accepts ?page&pageSize&search and
  // returns {items, total, page, pageSize} — we pipe these into local
  // state so the per-user expand/collapse + grant-loading logic below
  // keeps working unchanged. Search is debounced at 300ms.
  const PAGE_SIZE = 20;
  const [page, setPage] = useState(1);
  const [search, setSearchImmediate] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [totalUsers, setTotalUsers] = useState(0);
  const totalPages = Math.max(1, Math.ceil(totalUsers / PAGE_SIZE));

  const setSearch = useCallback((next: string) => {
    setSearchImmediate(next);
    setPage(1); // reset to first page on new query
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  // ── Data loading ────────────────────────────────────────────────────────

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("pageSize", String(PAGE_SIZE));
      if (debouncedSearch.length > 0) params.set("search", debouncedSearch);
      const [userRes, providerRes] = await Promise.all([
        apiClient.get<
          | {
              items?: User[];
              users?: User[];
              total?: number;
            }
          | User[]
        >(`${ENDPOINTS.admin.users}?${params.toString()}`),
        apiClient.get<OrgProvider[]>(ENDPOINTS.providers.root),
      ]);
      const fetchedUsers: User[] = Array.isArray(userRes)
        ? userRes
        : (userRes.items ?? userRes.users ?? []);
      setUsers(fetchedUsers);
      setTotalUsers(
        Array.isArray(userRes) ? fetchedUsers.length : (userRes.total ?? fetchedUsers.length),
      );
      setProviders(providerRes);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load org data");
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  async function loadUserGrants(userId: string) {
    if (!orgId) return;
    setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, loading: true } : u)));
    try {
      const data = await apiClient.get<{ grants: Grant[] }>(
        ENDPOINTS.orgs.modelGrantsByUser(orgId, userId),
      );
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, grants: data.grants, loading: false } : u)),
      );
    } catch (err) {
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, loading: false } : u)));
      dispatch(
        showToast({
          id: `grants-err-${Date.now()}`,
          type: "error",
          message: err instanceof Error ? err.message : "Failed to load grants",
        }),
      );
    }
  }

  function toggleExpand(userId: string) {
    const willOpen = expandedId !== userId;
    setExpandedId(willOpen ? userId : null);
    const alreadyLoaded = users.find((u) => u.id === userId)?.grants;
    if (willOpen && !alreadyLoaded) {
      void loadUserGrants(userId);
    }
  }

  async function handleRevoke(userId: string, grant: Grant) {
    if (!orgId) return;
    try {
      await apiClient.del(ENDPOINTS.orgs.modelGrant(orgId, String(grant.id)));
      setUsers((prev) =>
        prev.map((u) =>
          u.id === userId
            ? {
                ...u,
                grants: (u.grants ?? []).filter((g) => g.id !== grant.id),
              }
            : u,
        ),
      );
      dispatch(
        showToast({
          id: `grant-del-${Date.now()}`,
          type: "success",
          message: `Revoked ${grant.providerSlug}/${grant.modelSlug}`,
        }),
      );
    } catch (err) {
      dispatch(
        showToast({
          id: `grant-derr-${Date.now()}`,
          type: "error",
          message: err instanceof Error ? err.message : "Failed to revoke",
        }),
      );
    } finally {
      setDeleteTarget(null);
    }
  }

  function setUserField<K extends keyof UserWithGrants>(
    userId: string,
    key: K,
    value: UserWithGrants[K],
  ) {
    setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, [key]: value } : u)));
  }

  // ── Render ──────────────────────────────────────────────────────────────

  if (loading) {
    // P3 polish: skeleton placeholders; keep LoadingSpinner for the
    // per-user expand state (finer-grained UX).
    return <SkeletonList count={4} withAvatar />;
  }

  if (error) return <ErrorBanner message={error} />;

  if (!orgId) {
    return (
      <EmptyState
        icon={<UsersIcon className="h-12 w-12" />}
        title="No org context"
        description="Your account isn't attached to an organization, so there are no org-scoped models to assign."
      />
    );
  }

  if (providers.length === 0) {
    return (
      <EmptyState
        icon={<CubeTransparentIcon className="h-12 w-12" />}
        title="No providers configured yet"
        description="Configure providers for your org on the Providers tab first. Once a provider + its models are set up, you can grant them to users here without sharing the API key."
      />
    );
  }

  if (users.length === 0) {
    return (
      <EmptyState
        icon={<UsersIcon className="h-12 w-12" />}
        title="No users"
        description="Invite users from the Users tab first, then grant model access here."
      />
    );
  }

  const isFiltered = debouncedSearch.length > 0 && users.length === 0;

  return (
    <>
      <SearchInput
        placeholder="Search users by email, name, or role…"
        value={search}
        onChange={setSearch}
      />

      {isFiltered ? (
        <EmptyState
          icon={<UsersIcon className="h-12 w-12" />}
          title="No matching users"
          description={`No users match "${search}". Try a different term.`}
        />
      ) : (
        <>
          <div className="mt-3 space-y-3">
            {users.map((u) => {
              const isOpen = expandedId === u.id;
              const grants = u.grants ?? [];
              return (
                <Card key={u.id} padding={false}>
                  <div className="flex items-center justify-between px-4 py-3">
                    <button
                      className="flex flex-1 items-center gap-3 text-left"
                      onClick={() => toggleExpand(u.id)}
                    >
                      {isOpen ? (
                        <ChevronDownIcon className="text-description h-4 w-4" />
                      ) : (
                        <ChevronRightIcon className="text-description h-4 w-4" />
                      )}
                      <Avatar name={u.name || u.email} />
                      <div className="min-w-0">
                        <p className="text-foreground truncate text-sm font-medium">
                          {u.name || u.email}
                        </p>
                        <p className="text-description truncate text-xs">{u.email}</p>
                      </div>
                    </button>
                    <div className="flex items-center gap-2">
                      <Badge variant="default">{u.role.replace("_", " ")}</Badge>
                      {u.grants !== undefined && (
                        <span className="text-description text-xs">
                          {u.grants.length} grant{u.grants.length !== 1 ? "s" : ""}
                        </span>
                      )}
                    </div>
                  </div>

                  {isOpen && (
                    <div className="border-border border-t px-4 py-3">
                      {u.loading ? (
                        <div className="flex h-20 items-center justify-center">
                          <LoadingSpinner size="sm" />
                        </div>
                      ) : (
                        <>
                          {grants.length > 0 ? (
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-description-muted text-left">
                                  <th className="pb-1 font-medium">Model</th>
                                  <th className="pb-1 font-medium">Provider</th>
                                  <th className="pb-1 font-medium">Granted</th>
                                  <th className="w-8 pb-1" />
                                </tr>
                              </thead>
                              <tbody>
                                {grants.map((g) => (
                                  <tr
                                    key={g.id}
                                    className="text-foreground border-border/40 border-t"
                                  >
                                    <td className="py-1.5 font-mono text-[11px]">
                                      {g.modelSlug === "*"
                                        ? `${g.providerSlug}/* (all)`
                                        : g.modelSlug}
                                    </td>
                                    <td className="py-1.5 font-mono text-[11px]">
                                      {g.providerSlug}
                                    </td>
                                    <td className="text-description-muted py-1.5 text-[11px]">
                                      {new Date(g.grantedAt).toLocaleDateString()}
                                    </td>
                                    <td className="py-1.5 text-right">
                                      <Button
                                        variant="icon"
                                        aria-label={`Revoke ${g.modelSlug}`}
                                        onClick={() =>
                                          setDeleteTarget({
                                            userId: u.id,
                                            grant: g,
                                          })
                                        }
                                      >
                                        <TrashIcon className="h-4 w-4" />
                                      </Button>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          ) : (
                            <p className="text-description-muted py-2 text-xs italic">
                              No models granted yet.
                            </p>
                          )}

                          <div className="mt-3 flex justify-end">
                            {u.showAddForm ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setUserField(u.id, "showAddForm", false)}
                              >
                                Cancel
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                onClick={() => setUserField(u.id, "showAddForm", true)}
                              >
                                <PlusIcon className="h-4 w-4" />
                                Assign model
                              </Button>
                            )}
                          </div>

                          {u.showAddForm && (
                            <GrantModelForm
                              orgId={orgId}
                              userId={u.id}
                              providers={providers}
                              existingGrants={grants}
                              onCancel={() => setUserField(u.id, "showAddForm", false)}
                              onSuccess={(grant) => {
                                setUserField(u.id, "showAddForm", false);
                                setUsers((prev) =>
                                  prev.map((p) =>
                                    p.id === u.id
                                      ? {
                                          ...p,
                                          grants: [...(p.grants ?? []), grant],
                                        }
                                      : p,
                                  ),
                                );
                                dispatch(
                                  showToast({
                                    id: `grant-add-${Date.now()}`,
                                    type: "success",
                                    message: `Granted ${grant.modelSlug} to ${u.email}`,
                                  }),
                                );
                              }}
                              onError={(msg) =>
                                dispatch(
                                  showToast({
                                    id: `grant-aerr-${Date.now()}`,
                                    type: "error",
                                    message: msg,
                                  }),
                                )
                              }
                            />
                          )}
                        </>
                      )}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
          <Pagination
            page={page}
            totalPages={totalPages}
            total={totalUsers}
            itemLabel="users"
            onPageChange={setPage}
          />
        </>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && handleRevoke(deleteTarget.userId, deleteTarget.grant)}
        title="Revoke grant"
        message={
          deleteTarget
            ? `Revoke access to "${deleteTarget.grant.modelSlug}" for this user? They'll lose the ability to call this model immediately.`
            : ""
        }
        confirmLabel="Revoke"
        variant="danger"
      />
    </>
  );
}

// ─── GrantModelForm ───────────────────────────────────────────────────────

function GrantModelForm({
  orgId,
  userId,
  providers,
  existingGrants,
  onCancel,
  onSuccess,
  onError,
}: {
  orgId: string;
  userId: string;
  providers: OrgProvider[];
  existingGrants: Grant[];
  onCancel: () => void;
  onSuccess: (grant: Grant) => void;
  onError: (message: string) => void;
}) {
  // Narrow to enabled providers only — granting against a disabled
  // provider would create a grant that can't be resolved.
  const enabledProviders = useMemo(() => providers.filter((p) => p.enabled), [providers]);

  const [providerId, setProviderId] = useState<number | null>(enabledProviders[0]?.id ?? null);
  const [models, setModels] = useState<OrgProviderModel[]>([]);
  const [modelSlug, setModelSlug] = useState<string>("*");
  const [loadingModels, setLoadingModels] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const selectedProvider = useMemo(
    () => enabledProviders.find((p) => p.id === providerId) ?? null,
    [enabledProviders, providerId],
  );

  // Fetch models whenever the selected provider changes.
  useEffect(() => {
    if (!providerId) {
      setModels([]);
      return;
    }
    let cancelled = false;
    setLoadingModels(true);
    apiClient
      .get<OrgProviderModel[]>(ENDPOINTS.providers.models(String(providerId)))
      .then((res) => {
        if (cancelled) return;
        setModels(res);
        // Default to wildcard so the admin can grant "any model from
        // this provider" in one click; they can narrow it if they
        // want by picking a specific row.
        setModelSlug("*");
      })
      .catch((err) => {
        if (!cancelled) {
          onError(err instanceof Error ? err.message : "Failed to load models");
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingModels(false);
      });
    return () => {
      cancelled = true;
    };
  }, [providerId, onError]);

  // Redundancy check: if the user already has a grant for this exact
  // (provider, model) pair OR a wildcard for the provider, the submit
  // button explains why nothing would change.
  const wouldBeRedundant = useMemo(() => {
    if (!selectedProvider) return false;
    const existingForProvider = existingGrants.filter(
      (g) => g.providerSlug === selectedProvider.slug,
    );
    if (existingForProvider.some((g) => g.modelSlug === "*")) return true;
    if (modelSlug === "*") {
      // Granting wildcard when specific grants exist is still a useful
      // broadening, so don't flag it.
      return false;
    }
    return existingForProvider.some((g) => g.modelSlug === modelSlug);
  }, [existingGrants, selectedProvider, modelSlug]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedProvider) return;
    setSubmitting(true);
    try {
      const res = await apiClient.post<{ grant: Grant }>(ENDPOINTS.orgs.modelGrants(orgId), {
        granteeType: "user",
        granteeId: Number(userId),
        providerSlug: selectedProvider.slug,
        modelSlug,
      });
      onSuccess(res.grant);
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to grant model");
    } finally {
      setSubmitting(false);
    }
  }

  if (enabledProviders.length === 0) {
    return (
      <div className="bg-secondary-background border-border mt-3 rounded-md border p-3">
        <p className="text-description-muted text-xs">
          No enabled providers in this org. Enable a provider on the Providers tab before granting
          access.
        </p>
        <div className="mt-2 flex justify-end">
          <Button size="sm" variant="ghost" onClick={onCancel}>
            Close
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-secondary-background border-border mt-3 space-y-3 rounded-md border p-3"
    >
      <div className="flex items-center gap-2">
        <CubeTransparentIcon className="text-description h-4 w-4" />
        <span className="text-foreground text-xs font-medium">
          Grant access to an org-configured model
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="text-description-muted mb-0.5 block text-[11px] font-medium">
            Provider
          </label>
          <select
            value={providerId ?? ""}
            onChange={(e) => setProviderId(Number(e.target.value))}
            className="border-input-border bg-input text-input-foreground focus:border-border-focus focus:ring-border-focus w-full rounded-md border px-2 py-1.5 text-sm focus:outline-none focus:ring-1"
          >
            {enabledProviders.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.slug})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-description-muted mb-0.5 block text-[11px] font-medium">
            Model
          </label>
          <select
            value={modelSlug}
            onChange={(e) => setModelSlug(e.target.value)}
            disabled={loadingModels}
            className="border-input-border bg-input text-input-foreground focus:border-border-focus focus:ring-border-focus w-full rounded-md border px-2 py-1.5 text-sm focus:outline-none focus:ring-1 disabled:opacity-50"
          >
            <option value="*">All models from this provider (*)</option>
            {models.map((m) => (
              <option key={m.id} value={m.modelName}>
                {m.displayName || m.modelName}
              </option>
            ))}
          </select>
          {loadingModels && (
            <p className="text-description-muted mt-1 text-[10px]">Loading models…</p>
          )}
          {!loadingModels && models.length === 0 && providerId && (
            <p className="text-warning mt-1 text-[10px]">
              This provider has no models configured. Add models on the Providers tab first, or pick
              wildcard to grant access to whatever gets added later.
            </p>
          )}
        </div>
      </div>

      <p className="text-description-muted text-[10px] leading-relaxed">
        The user will inherit the org's stored API key for this provider. You don't need to share
        keys — the gateway resolves them at request time. Revoke any time from the list above.
      </p>

      {wouldBeRedundant && (
        <p className="text-warning text-[11px]">
          ⚠ This user already has an equivalent or broader grant for this provider. Submitting will
          be a no-op.
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
        <Button
          type="submit"
          size="sm"
          loading={submitting}
          disabled={!selectedProvider || loadingModels}
        >
          Grant
        </Button>
      </div>
    </form>
  );
}
