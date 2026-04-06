import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ServerIcon,
  UsersIcon,
  ClipboardDocumentListIcon,
  TrashIcon,
  PlusIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ArrowDownTrayIcon,
} from "@heroicons/react/24/outline";
import { apiClient } from "../../api/client";
import { useAppDispatch } from "../../store/hooks";
import { ROUTES } from "../../utils/routes";
import { showToast } from "../../store/slices/uiSlice";
import type { Provider, AuditLog, User } from "../../api/types";
import { cn } from "../../utils/cn";
import { UnderlineTabs } from "../../components/ui/UnderlineTabs";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { Avatar } from "../../components/ui/Avatar";
import { StatCard } from "../../components/ui/StatCard";
import { LoadingSpinner } from "../../components/ui/LoadingSpinner";
import { ErrorBanner } from "../../components/ui/ErrorBanner";
import { EmptyState } from "../../components/ui/EmptyState";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";

const tabs = [
  { id: "providers", label: "Providers" },
  { id: "users", label: "Users" },
  { id: "credits", label: "Credits" },
  { id: "audit", label: "Audit Log" },
];

const ROLES = ["admin", "security_lead", "developer", "auditor"] as const;

const roleVariant: Record<
  string,
  "error" | "warning" | "info" | "success" | "default"
> = {
  admin: "error",
  security_lead: "warning",
  developer: "info",
  auditor: "default",
};

export function OrgSettingsPage() {
  const [activeTab, setActiveTab] = useState("providers");

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-foreground text-2xl font-bold">
        Organization Settings
      </h1>
      <UnderlineTabs
        tabs={tabs}
        activeTab={activeTab}
        onChange={setActiveTab}
      />

      {activeTab === "providers" && <ProvidersTab />}
      {activeTab === "users" && <UsersTab />}
      {activeTab === "credits" && <CreditsTab />}
      {activeTab === "audit" && <AuditTab />}
    </div>
  );
}

/* ──────────── Providers Tab ──────────── */

interface ProviderModel {
  id: string;
  modelName: string;
  displayName: string;
  inputCostPer1k: number;
  outputCostPer1k: number;
}

interface ProviderWithModels extends Provider {
  models?: ProviderModel[];
}

function ProvidersTab() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [providers, setProviders] = useState<ProviderWithModels[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProviderWithModels | null>(
    null,
  );

  useEffect(() => {
    loadProviders();
  }, []);

  async function loadProviders() {
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.get<ProviderWithModels[]>("/api/providers");
      setProviders(data);
    } catch (err: unknown) {
      if (err instanceof Error) setError(err.message);
      else setError("Failed to load providers");
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(provider: ProviderWithModels) {
    try {
      await apiClient.del(`/api/providers/${provider.id}`);
      setProviders((prev) => prev.filter((p) => p.id !== provider.id));
      dispatch(
        showToast({
          id: `prov-del-${Date.now()}`,
          type: "success",
          message: `${provider.name} removed`,
        }),
      );
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Failed to delete provider";
      dispatch(
        showToast({
          id: `prov-err-${Date.now()}`,
          type: "error",
          message: msg,
        }),
      );
    }
    setDeleteTarget(null);
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (error) return <ErrorBanner message={error} />;

  if (providers.length === 0) {
    return (
      <div className="space-y-4">
        <EmptyState
          icon={<ServerIcon className="h-12 w-12" />}
          title="No providers"
          description="Configure AI providers to start routing requests."
        />
        <div className="flex justify-center">
          <Button onClick={() => navigate(ROUTES.ADD_PROVIDER)}>
            <PlusIcon className="h-4 w-4" />
            Add Provider
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="mb-3 flex justify-end">
        <Button size="sm" onClick={() => navigate(ROUTES.ADD_PROVIDER)}>
          <PlusIcon className="h-4 w-4" />
          Add Provider
        </Button>
      </div>
      <div className="space-y-3">
        {providers.map((p) => (
          <Card key={p.id} padding={false}>
            <div className="flex items-center justify-between px-4 py-3">
              <button
                className="flex flex-1 items-center gap-3 text-left"
                onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}
              >
                {expandedId === p.id ? (
                  <ChevronDownIcon className="text-description h-4 w-4" />
                ) : (
                  <ChevronRightIcon className="text-description h-4 w-4" />
                )}
                <div>
                  <p className="text-foreground text-sm font-medium">
                    {p.name}
                  </p>
                  <p className="text-description text-xs">
                    {p.baseUrl || "Default endpoint"}
                  </p>
                </div>
              </button>
              <div className="flex items-center gap-2">
                <Badge variant={p.enabled ? "success" : "default"}>
                  {p.enabled ? "Enabled" : "Disabled"}
                </Badge>
                {p.models && (
                  <span className="text-description text-xs">
                    {p.models.length} model{p.models.length !== 1 ? "s" : ""}
                  </span>
                )}
                <Button
                  variant="icon"
                  onClick={() => setDeleteTarget(p)}
                  aria-label={`Delete ${p.name}`}
                >
                  <TrashIcon className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {expandedId === p.id && p.models && p.models.length > 0 && (
              <div className="border-border border-t px-4 py-3">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-description-muted text-left">
                      <th className="pb-1 font-medium">Model</th>
                      <th className="pb-1 font-medium">Input $/1K</th>
                      <th className="pb-1 font-medium">Output $/1K</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.models.map((m) => (
                      <tr key={m.id} className="text-foreground">
                        <td className="py-0.5">
                          {m.displayName || m.modelName}
                        </td>
                        <td className="py-0.5">
                          ${m.inputCostPer1k.toFixed(4)}
                        </td>
                        <td className="py-0.5">
                          ${m.outputCostPer1k.toFixed(4)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        ))}
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && handleDelete(deleteTarget)}
        title="Remove Provider"
        message={`Are you sure you want to remove ${deleteTarget?.name}? This cannot be undone.`}
        confirmLabel="Remove"
        variant="danger"
      />
    </>
  );
}

/* ──────────── Users Tab ──────────── */

function UsersTab() {
  const dispatch = useAppDispatch();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [inviteForm, setInviteForm] = useState({
    email: "",
    name: "",
    password: "",
    role: "developer" as string,
  });
  const [inviting, setInviting] = useState(false);

  useEffect(() => {
    loadUsers();
  }, []);

  async function loadUsers() {
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.get<{ users: User[] } | User[]>(
        "/api/admin/users",
      );
      setUsers(Array.isArray(data) ? data : data.users);
    } catch (err: unknown) {
      if (err instanceof Error) setError(err.message);
      else setError("Failed to load users");
    } finally {
      setLoading(false);
    }
  }

  async function changeRole(userId: string, role: string) {
    try {
      await apiClient.put(`/api/admin/users/${userId}/role`, { role });
      setUsers((prev) =>
        prev.map((u) =>
          u.id === userId ? { ...u, role: role as User["role"] } : u,
        ),
      );
      dispatch(
        showToast({
          id: `role-${Date.now()}`,
          type: "success",
          message: "Role updated",
        }),
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to update role";
      dispatch(
        showToast({
          id: `role-err-${Date.now()}`,
          type: "error",
          message: msg,
        }),
      );
    }
  }

  async function handleInvite() {
    if (!inviteForm.email || !inviteForm.name || !inviteForm.password) return;
    setInviting(true);
    try {
      await apiClient.post("/api/auth/register", inviteForm);
      dispatch(
        showToast({
          id: `invite-${Date.now()}`,
          type: "success",
          message: `Invited ${inviteForm.email}`,
        }),
      );
      setInviteForm({ email: "", name: "", password: "", role: "developer" });
      setShowInvite(false);
      await loadUsers();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to invite user";
      dispatch(
        showToast({
          id: `invite-err-${Date.now()}`,
          type: "error",
          message: msg,
        }),
      );
    } finally {
      setInviting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (error) return <ErrorBanner message={error} />;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setShowInvite((p) => !p)}>
          <PlusIcon className="h-4 w-4" />
          Invite User
        </Button>
      </div>

      {showInvite && (
        <Card>
          <h3 className="text-foreground mb-3 text-sm font-semibold">
            Invite User
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <input
              type="email"
              placeholder="Email"
              value={inviteForm.email}
              onChange={(e) =>
                setInviteForm({ ...inviteForm, email: e.target.value })
              }
              className="border-input-border bg-input text-input-foreground placeholder:text-input-placeholder focus:border-border-focus focus:ring-border-focus rounded-md border px-3 py-1.5 text-sm focus:outline-none focus:ring-1"
            />
            <input
              type="text"
              placeholder="Name"
              value={inviteForm.name}
              onChange={(e) =>
                setInviteForm({ ...inviteForm, name: e.target.value })
              }
              className="border-input-border bg-input text-input-foreground placeholder:text-input-placeholder focus:border-border-focus focus:ring-border-focus rounded-md border px-3 py-1.5 text-sm focus:outline-none focus:ring-1"
            />
            <input
              type="password"
              placeholder="Password"
              value={inviteForm.password}
              onChange={(e) =>
                setInviteForm({ ...inviteForm, password: e.target.value })
              }
              className="border-input-border bg-input text-input-foreground placeholder:text-input-placeholder focus:border-border-focus focus:ring-border-focus rounded-md border px-3 py-1.5 text-sm focus:outline-none focus:ring-1"
            />
            <select
              value={inviteForm.role}
              onChange={(e) =>
                setInviteForm({ ...inviteForm, role: e.target.value })
              }
              className="border-input-border bg-input text-input-foreground focus:border-border-focus focus:ring-border-focus rounded-md border px-3 py-1.5 text-sm focus:outline-none focus:ring-1"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r.replace("_", " ")}
                </option>
              ))}
            </select>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowInvite(false)}
            >
              Cancel
            </Button>
            <Button size="sm" loading={inviting} onClick={handleInvite}>
              Send Invite
            </Button>
          </div>
        </Card>
      )}

      {users.length === 0 ? (
        <EmptyState
          icon={<UsersIcon className="h-12 w-12" />}
          title="No users"
          description="Invite users to your organization."
        />
      ) : (
        <div className="space-y-2">
          {users.map((u) => (
            <Card key={u.id} className="flex items-center gap-3">
              <Avatar name={u.name || u.email} />
              <div className="min-w-0 flex-1">
                <p className="text-foreground truncate text-sm font-medium">
                  {u.name}
                </p>
                <p className="text-description truncate text-xs">{u.email}</p>
              </div>
              <select
                value={u.role}
                onChange={(e) => changeRole(u.id, e.target.value)}
                className="border-input-border bg-input text-input-foreground focus:border-border-focus focus:ring-border-focus rounded-md border px-2 py-1 text-xs focus:outline-none focus:ring-1"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r.replace("_", " ")}
                  </option>
                ))}
              </select>
              <Badge variant={roleVariant[u.role] ?? "default"}>
                {u.role.replace("_", " ")}
              </Badge>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

/* ──────────── Credits Tab ──────────── */

interface UsageSummary {
  totalRequests: number;
  totalTokens: number;
  totalCost: number;
}

interface CreditLimit {
  id: string;
  provider: string;
  maxRequests?: number;
  maxTokens?: number;
  maxDollars?: number;
  usedRequests: number;
  usedTokens: number;
  usedDollars: number;
}

function CreditsTab() {
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [credits, setCredits] = useState<CreditLimit[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const [u, c] = await Promise.allSettled([
        apiClient.get<UsageSummary>("/api/usage/summary"),
        apiClient.get<CreditLimit[]>("/api/credits"),
      ]);
      if (u.status === "fulfilled") setUsage(u.value);
      if (c.status === "fulfilled") setCredits(c.value);
      setLoading(false);
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {usage && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard
            label="Total Requests"
            value={usage.totalRequests.toLocaleString()}
          />
          <StatCard
            label="Total Tokens"
            value={usage.totalTokens.toLocaleString()}
          />
          <StatCard
            label="Total Cost"
            value={`$${usage.totalCost.toFixed(4)}`}
          />
        </div>
      )}

      {credits.length > 0 && (
        <div className="space-y-3">
          {credits.map((c) => {
            const pct =
              c.maxDollars && c.maxDollars > 0
                ? Math.min(
                    100,
                    Math.round((c.usedDollars / c.maxDollars) * 100),
                  )
                : 0;
            const color =
              pct >= 90 ? "bg-error" : pct >= 70 ? "bg-warning" : "bg-success";

            return (
              <Card key={c.id}>
                <div className="mb-2 flex justify-between text-sm">
                  <span className="text-foreground font-medium">
                    {c.provider}
                  </span>
                  <span className="text-description">
                    ${c.usedDollars.toFixed(2)} / $
                    {(c.maxDollars ?? 0).toFixed(2)}
                  </span>
                </div>
                <div className="bg-secondary h-2 w-full overflow-hidden rounded-full">
                  <div
                    className={cn("h-full rounded-full transition-all", color)}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ──────────── Audit Tab ──────────── */

function AuditTab() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const [offset, setOffset] = useState(0);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const limit = 25;

  useEffect(() => {
    loadLogs();
  }, [offset, filter]);

  async function loadLogs() {
    setLoading(true);
    setError(null);
    try {
      const actionParam = filter !== "all" ? `&action=${filter}` : "";
      const data = await apiClient.get<{ logs: AuditLog[] }>(
        `/api/logs?limit=${limit}&offset=${offset}${actionParam}`,
      );
      setLogs(data.logs ?? []);
    } catch (err: unknown) {
      if (err instanceof Error) setError(err.message);
      else setError("Failed to load audit logs");
    } finally {
      setLoading(false);
    }
  }

  const actionVariant: Record<string, "success" | "warning" | "error"> = {
    ALLOW: "success",
    REDACT: "warning",
    BLOCK: "error",
  };

  async function handleExport(format: "json" | "csv") {
    try {
      const blob = await fetch(`/api/export/${format}`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem("token") ?? ""}`,
        },
      }).then((r) => r.blob());
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `audit-export.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      /* export unavailable */
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {["all", "BLOCK", "REDACT", "ALLOW"].map((f) => (
          <button
            key={f}
            onClick={() => {
              setFilter(f);
              setOffset(0);
            }}
            className={cn(
              "rounded-md px-3 py-1 text-xs font-medium transition-colors",
              filter === f
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-secondary-foreground hover:bg-secondary-hover",
            )}
          >
            {f === "all" ? "All" : f}
          </button>
        ))}
        <div className="ml-auto flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleExport("json")}
          >
            <ArrowDownTrayIcon className="h-3.5 w-3.5" />
            JSON
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleExport("csv")}
          >
            <ArrowDownTrayIcon className="h-3.5 w-3.5" />
            CSV
          </Button>
        </div>
      </div>

      {error && <ErrorBanner message={error} />}

      {loading ? (
        <div className="flex h-32 items-center justify-center">
          <LoadingSpinner />
        </div>
      ) : logs.length === 0 ? (
        <EmptyState
          icon={<ClipboardDocumentListIcon className="h-12 w-12" />}
          title="No audit logs"
          description="Audit entries will appear here after scan activity."
        />
      ) : (
        <div className="space-y-1">
          {logs.map((log) => (
            <Card key={log.id} padding={false} className="cursor-pointer">
              <button
                className="flex w-full items-center gap-3 px-4 py-2 text-left text-sm"
                onClick={() =>
                  setExpandedId(expandedId === log.id ? null : log.id)
                }
              >
                <span className="text-description-muted shrink-0 font-mono text-xs">
                  {new Date(log.timestamp).toLocaleString()}
                </span>
                <span className="text-description truncate">{log.model}</span>
                <Badge variant={actionVariant[log.action] ?? "default"}>
                  {log.action}
                </Badge>
                <span className="text-description ml-auto text-xs">
                  Risk: {log.riskScore}
                </span>
              </button>
              {expandedId === log.id && (
                <div className="border-border text-description border-t px-4 py-2 text-xs">
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <span className="text-description-muted">Secrets: </span>
                      {log.secretsFound}
                    </div>
                    <div>
                      <span className="text-description-muted">PII: </span>
                      {log.piiFound}
                    </div>
                    <div>
                      <span className="text-description-muted">Risk: </span>
                      {log.riskScore}
                    </div>
                  </div>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          size="sm"
          disabled={offset === 0}
          onClick={() => setOffset(Math.max(0, offset - limit))}
        >
          Previous
        </Button>
        <span className="text-description text-xs">
          Showing {offset + 1} - {offset + logs.length}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={logs.length < limit}
          onClick={() => setOffset(offset + limit)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
