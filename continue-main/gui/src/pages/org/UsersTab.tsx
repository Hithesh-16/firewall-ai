import { useCallback, useEffect, useState } from "react";
import { useProxyApi } from "../../hooks/useProxyApi";

interface User {
  id: number;
  email: string;
  name: string;
  role: string;
  org_id: number | null;
  created_at: string;
}

const ROLES = ["admin", "security_lead", "developer", "auditor"] as const;

const ROLE_DESCRIPTIONS: Record<string, string> = {
  admin: "Full access to all settings, users, and policies",
  security_lead: "Manage policies, view audit logs, configure providers",
  developer: "Use AI agent, view own scan results",
  auditor: "Read-only access to logs, stats, and compliance reports",
};

const ROLE_COLORS: Record<string, string> = {
  admin: "bg-badge text-badge-foreground",
  security_lead: "bg-info/15 text-info",
  developer: "bg-success/15 text-success",
  auditor: "bg-warning/15 text-warning",
};

export function UsersTab() {
  const api = useProxyApi();
  const [users, setUsers] = useState<User[]>([]);
  const [showInvite, setShowInvite] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState(false);

  // Invite form
  const [invEmail, setInvEmail] = useState("");
  const [invName, setInvName] = useState("");
  const [invPassword, setInvPassword] = useState("");
  const [invRole, setInvRole] = useState<string>("developer");

  const fetchUsers = useCallback(async () => {
    try {
      const data = await api.get<User[]>("/api/admin/users");
      setUsers(data);
    } catch {
      setError("Could not reach AI Firewall proxy");
    }
  }, [api]);

  useEffect(() => {
    fetchUsers().finally(() => setLoading(false));
  }, []);

  const handleInvite = async () => {
    setError(null);
    setMutating(true);
    try {
      await api.post("/api/auth/register", {
        email: invEmail,
        name: invName,
        password: invPassword,
        role: invRole,
      });
      setShowInvite(false);
      setInvEmail("");
      setInvName("");
      setInvPassword("");
      await fetchUsers();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setMutating(false);
    }
  };

  const handleRoleChange = async (userId: number, newRole: string) => {
    setError(null);
    setMutating(true);
    try {
      await api.put(`/api/admin/users/${userId}/role`, { role: newRole });
      await fetchUsers();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setMutating(false);
    }
  };

  if (loading) {
    return <div className="p-4 text-sm text-description">Loading users...</div>;
  }

  return (
    <div className={`flex flex-col gap-3 ${mutating ? "opacity-60 pointer-events-none" : ""}`}>
      {error && (
        <div className="bg-error/5 border border-error/30 rounded-lg px-3 py-2 text-sm text-error">
          {error}
        </div>
      )}

      {/* Role legend */}
      <div className="flex flex-wrap gap-2 mb-1">
        {ROLES.map((role) => (
          <div key={role} className="flex items-center gap-1.5" title={ROLE_DESCRIPTIONS[role]}>
            <span
              className={`px-2 py-0.5 rounded text-xs font-medium ${ROLE_COLORS[role]}`}
            >
              {role}
            </span>
          </div>
        ))}
      </div>

      {/* User list */}
      {users.length === 0 ? (
        <p className="text-sm text-description text-center py-6">
          No users registered. Create the first user below.
        </p>
      ) : (
        users.map((u) => (
          <div
            key={u.id}
            className="flex items-center gap-3 bg-secondary-background rounded-lg px-4 py-3"
          >
            <div className="w-8 h-8 rounded-full bg-background flex items-center justify-center text-sm font-medium text-foreground">
              {u.name?.[0]?.toUpperCase() ?? "?"}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">{u.name}</p>
              <p className="text-xs text-description">{u.email}</p>
            </div>
            <select
              className="bg-input-background text-input-foreground border border-input-border rounded px-2 py-1 text-xs"
              value={u.role}
              onChange={(e) => handleRoleChange(u.id, e.target.value)}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>
        ))
      )}

      {/* Invite form */}
      {!showInvite ? (
        <button
          onClick={() => setShowInvite(true)}
          className="border border-dashed border-border rounded-lg px-4 py-3 text-sm text-description hover:text-foreground hover:border-border-focus transition-colors focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:outline-none"
        >
          + Invite User
        </button>
      ) : (
        <div className="bg-secondary-background rounded-lg p-4 flex flex-col gap-3">
          <p className="text-sm font-medium text-foreground">Invite User</p>

          <input
            className="bg-input-background text-input-foreground border border-input-border rounded px-2 py-1 text-sm"
            placeholder="Email"
            value={invEmail}
            onChange={(e) => setInvEmail(e.target.value)}
          />
          <input
            className="bg-input-background text-input-foreground border border-input-border rounded px-2 py-1 text-sm"
            placeholder="Full name"
            value={invName}
            onChange={(e) => setInvName(e.target.value)}
          />
          <input
            className="bg-input-background text-input-foreground border border-input-border rounded px-2 py-1 text-sm"
            placeholder="Temporary password"
            type="password"
            value={invPassword}
            onChange={(e) => setInvPassword(e.target.value)}
          />
          <select
            className="bg-input-background text-input-foreground border border-input-border rounded px-2 py-1.5 text-sm"
            value={invRole}
            onChange={(e) => setInvRole(e.target.value)}
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r} — {ROLE_DESCRIPTIONS[r]}
              </option>
            ))}
          </select>

          <div className="flex gap-2">
            <button
              onClick={handleInvite}
              className="bg-primary-background text-primary-foreground rounded px-3 py-1.5 text-sm hover:bg-primary-hover flex-1 focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:outline-none"
            >
              Create User
            </button>
            <button
              onClick={() => setShowInvite(false)}
              className="bg-secondary-background text-description rounded px-3 py-1.5 text-sm hover:text-foreground border border-border focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:outline-none"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
