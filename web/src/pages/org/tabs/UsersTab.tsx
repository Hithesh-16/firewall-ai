import { useEffect, useState } from "react";
import { UsersIcon, PlusIcon } from "@heroicons/react/24/outline";
import { apiClient } from "../../../api/client";
import { useAppDispatch } from "../../../store/hooks";
import { showToast } from "../../../store/slices/uiSlice";
import type { User } from "../../../api/types";
import { Card } from "../../../components/ui/Card";
import { Button } from "../../../components/ui/Button";
import { Badge } from "../../../components/ui/Badge";
import { Avatar } from "../../../components/ui/Avatar";
import { LoadingSpinner } from "../../../components/ui/LoadingSpinner";
import { ErrorBanner } from "../../../components/ui/ErrorBanner";
import { EmptyState } from "../../../components/ui/EmptyState";

const ROLES = ["admin", "security_lead", "developer", "auditor"] as const;

const roleVariant: Record<string, "error" | "warning" | "info" | "success" | "default"> = {
  admin: "error",
  security_lead: "warning",
  developer: "info",
  auditor: "default",
};

export function UsersTab() {
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
      const data = await apiClient.get<{ users: User[] } | User[]>("/api/admin/users");
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
        prev.map((u) => (u.id === userId ? { ...u, role: role as User["role"] } : u)),
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
      )}
    </div>
  );
}
