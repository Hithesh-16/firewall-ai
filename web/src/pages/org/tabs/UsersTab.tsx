import { useState } from "react";
import { UsersIcon, PlusIcon } from "@heroicons/react/24/outline";
import { apiClient } from "../../../api/client";
import { ENDPOINTS } from "../../../api/endpoints";
import { useAppDispatch } from "../../../store/hooks";
import { showToast } from "../../../store/slices/uiSlice";
import type { User } from "../../../api/types";
import { Card } from "../../../components/ui/Card";
import { Button } from "../../../components/ui/Button";
import { Badge } from "../../../components/ui/Badge";
import { Avatar } from "../../../components/ui/Avatar";
import { SkeletonList } from "../../../components/ui/Skeleton";
import { ErrorBanner } from "../../../components/ui/ErrorBanner";
import { EmptyState } from "../../../components/ui/EmptyState";
import { Pagination } from "../../../components/ui/Pagination";
import { SearchInput } from "../../../components/ui/SearchInput";
import { useServerTable } from "../../../hooks/useServerTable";

const ROLES = ["admin", "security_lead", "developer", "auditor"] as const;

const roleVariant: Record<string, "error" | "warning" | "info" | "success" | "default"> = {
  admin: "error",
  security_lead: "warning",
  developer: "info",
  auditor: "default",
};

export function UsersTab() {
  const dispatch = useAppDispatch();
  const [showInvite, setShowInvite] = useState(false);
  const [inviteForm, setInviteForm] = useState({
    email: "",
    name: "",
    password: "",
    role: "developer" as string,
  });
  const [inviting, setInviting] = useState(false);

  // P11-SERVER: server-driven pagination + search. Backend returns
  // {items, total, page, pageSize} for /api/admin/users, scoped to
  // the caller's org. Default 20/page; search debounced at 300ms,
  // matches email / name / role on the proxy side.
  const {
    items: users,
    total,
    page,
    totalPages,
    setPage,
    search,
    setSearch,
    loading,
    error,
    refetch,
  } = useServerTable<User>({
    endpoint: ENDPOINTS.admin.users,
    pageSize: 20,
    legacyKey: "users",
  });

  async function changeRole(userId: string, role: string) {
    try {
      await apiClient.put(ENDPOINTS.admin.userRole(String(userId)), { role });
      // Re-fetch the current page so the role badge + dropdown reflect
      // the new value (also picks up any concurrent edits from other
      // admins).
      refetch();
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
      await apiClient.post(ENDPOINTS.auth.register, inviteForm);
      dispatch(
        showToast({
          id: `invite-${Date.now()}`,
          type: "success",
          message: `Invited ${inviteForm.email}`,
        }),
      );
      setInviteForm({ email: "", name: "", password: "", role: "developer" });
      setShowInvite(false);
      refetch();
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

  // Skeleton only on first load (no data yet). On subsequent refetches
  // we keep the old rows visible and rely on the fetch to resolve.
  if (loading && users.length === 0 && search.length === 0) {
    return <SkeletonList count={4} withAvatar />;
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
          <h3 className="text-foreground mb-3 text-sm font-semibold">Invite User</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <input
              type="email"
              placeholder="Email"
              value={inviteForm.email}
              onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
              className="border-input-border bg-input text-input-foreground placeholder:text-input-placeholder focus:border-border-focus focus:ring-border-focus rounded-md border px-3 py-1.5 text-sm focus:outline-none focus:ring-1"
            />
            <input
              type="text"
              placeholder="Name"
              value={inviteForm.name}
              onChange={(e) => setInviteForm({ ...inviteForm, name: e.target.value })}
              className="border-input-border bg-input text-input-foreground placeholder:text-input-placeholder focus:border-border-focus focus:ring-border-focus rounded-md border px-3 py-1.5 text-sm focus:outline-none focus:ring-1"
            />
            <input
              type="password"
              placeholder="Password"
              value={inviteForm.password}
              onChange={(e) => setInviteForm({ ...inviteForm, password: e.target.value })}
              className="border-input-border bg-input text-input-foreground placeholder:text-input-placeholder focus:border-border-focus focus:ring-border-focus rounded-md border px-3 py-1.5 text-sm focus:outline-none focus:ring-1"
            />
            <select
              value={inviteForm.role}
              onChange={(e) => setInviteForm({ ...inviteForm, role: e.target.value })}
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
            <Button variant="ghost" size="sm" onClick={() => setShowInvite(false)}>
              Cancel
            </Button>
            <Button size="sm" loading={inviting} onClick={handleInvite}>
              Send Invite
            </Button>
          </div>
        </Card>
      )}

      <SearchInput
        placeholder="Search by email, name, or role…"
        value={search}
        onChange={setSearch}
      />

      {users.length === 0 ? (
        <EmptyState
          icon={<UsersIcon className="h-12 w-12" />}
          title={search ? "No matching users" : "No users"}
          description={
            search
              ? `No users match "${search}". Try a different term.`
              : "Invite users to your organization."
          }
        />
      ) : (
        <>
          <div className="space-y-2">
            {users.map((u) => (
              <Card key={u.id} className="flex items-center gap-3">
                <Avatar name={u.name || u.email} />
                <div className="min-w-0 flex-1">
                  <p className="text-foreground truncate text-sm font-medium">{u.name}</p>
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
                <Badge variant={roleVariant[u.role] ?? "default"}>{u.role.replace("_", " ")}</Badge>
              </Card>
            ))}
          </div>
          <Pagination
            page={page}
            totalPages={totalPages}
            total={total}
            itemLabel="users"
            onPageChange={setPage}
          />
        </>
      )}
    </div>
  );
}
