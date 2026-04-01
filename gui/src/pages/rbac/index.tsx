import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useProxyApi } from "../../hooks/useProxyApi";
import { ROUTES } from "../../util/navigation";

// ── Types ─────────────────────────────────────────────────────────────

interface Capability {
  name: string;
  resource: string;
  action: string;
  description: string | null;
  category: string;
  riskLevel: string;
}

interface RoleCapability {
  capability_name: string;
  scope: string;
  granted: number;
}

interface Role {
  id: number;
  orgId: number | null;
  name: string;
  displayName: string;
  description: string | null;
  isSystem: number;
  isCustom: number;
  capabilities: RoleCapability[];
}

// ── Category config ───────────────────────────────────────────────────

const CATEGORY_ORDER = [
  "Organisation",
  "Teams",
  "Identity",
  "Security",
  "Vault",
  "Audit",
  "Developer",
];

const RISK_COLORS: Record<string, string> = {
  low: "text-success",
  medium: "text-warning",
  high: "text-error",
  critical: "text-error",
};

const RISK_BG: Record<string, string> = {
  low: "bg-success/10",
  medium: "bg-warning/10",
  high: "bg-error/10",
  critical: "bg-error/15",
};

// ── Component ─────────────────────────────────────────────────────────

function RbacPage() {
  const navigate = useNavigate();
  const api = useProxyApi();

  const [roles, setRoles] = useState<Role[]>([]);
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Editing state for selected role
  const [editCaps, setEditCaps] = useState<Set<string>>(new Set());
  const [showNewRole, setShowNewRole] = useState(false);
  const [newRoleName, setNewRoleName] = useState("");
  const [newRoleDisplay, setNewRoleDisplay] = useState("");

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const [rolesRes, capsRes] = await Promise.all([
        api.get<{ roles: Role[] }>("/api/roles"),
        api.get<{ capabilities: Capability[] }>("/api/capabilities"),
      ]);
      setRoles(rolesRes.roles);
      setCapabilities(capsRes.capabilities);

      if (rolesRes.roles.length > 0 && !selectedRole) {
        selectRole(rolesRes.roles[0]);
      }
    } catch (err: unknown) {
      console.error("Failed to load RBAC data:", err);
      setError(err instanceof Error ? err.message : "Failed to load roles");
    } finally {
      setLoading(false);
    }
  }

  function selectRole(role: Role) {
    setSelectedRole(role);
    setEditCaps(new Set(role.capabilities.map((c) => c.capability_name)));
  }

  const toggleCapability = useCallback((capName: string) => {
    setEditCaps((prev) => {
      const next = new Set(prev);
      if (next.has(capName)) {
        next.delete(capName);
      } else {
        next.add(capName);
      }
      return next;
    });
  }, []);

  const toggleCategory = useCallback((category: string) => {
    const categoryCaps = capabilities
      .filter((c) => c.category === category)
      .map((c) => c.name);
    const allSelected = categoryCaps.every((c) => editCaps.has(c));

    setEditCaps((prev) => {
      const next = new Set(prev);
      for (const cap of categoryCaps) {
        if (allSelected) {
          next.delete(cap);
        } else {
          next.add(cap);
        }
      }
      return next;
    });
  }, [capabilities, editCaps]);

  async function saveRole() {
    if (!selectedRole) return;
    setSaving(true);
    setError(null);

    try {
      await api.put(`/api/roles/${selectedRole.id}`, {
        capabilities: Array.from(editCaps),
      });
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to save role");
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateRole() {
    if (!newRoleName.trim() || !newRoleDisplay.trim()) return;
    setSaving(true);
    setError(null);

    try {
      const role = await api.post<Role>("/api/roles", {
        name: newRoleName.trim(),
        displayName: newRoleDisplay.trim(),
        description: "",
        capabilities: Array.from(editCaps),
      });
      setShowNewRole(false);
      setNewRoleName("");
      setNewRoleDisplay("");
      await loadData();
      selectRole(role);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create role");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteRole(roleId: number) {
    try {
      await api.del(`/api/roles/${roleId}`);
      setSelectedRole(null);
      await loadData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to delete role");
    }
  }

  // Group capabilities by category
  const groupedCaps = CATEGORY_ORDER.map((category) => ({
    category,
    items: capabilities.filter((c) => c.category === category),
  })).filter((g) => g.items.length > 0);

  const hasChanges = selectedRole
    ? (() => {
        const current = new Set(selectedRole.capabilities.map((c) => c.capability_name));
        return editCaps.size !== current.size || [...editCaps].some((c) => !current.has(c));
      })()
    : false;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-4 py-4 border-b border-border bg-background">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(ROUTES.SECURITY)}
            className="text-description hover:text-foreground transition-colors focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:outline-none"
            aria-label="Back"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5" /><path d="m12 19-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h1 className="text-lg font-bold text-foreground">Roles & Permissions</h1>
            <p className="text-xs text-description">Manage roles, capabilities, and access control</p>
          </div>
        </div>
      </div>

      {error && (
        <div className="mx-4 mt-3 bg-error/5 border border-error/30 rounded-lg px-3 py-2">
          <p className="text-xs text-error">{error}</p>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Left: Role list */}
        <div className="w-56 flex-shrink-0 border-r border-border overflow-y-auto">
          <div className="p-3 space-y-1">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-description mb-2 px-2">
              Roles
            </p>

            {roles.map((role) => (
              <button
                key={role.id}
                onClick={() => selectRole(role)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-all text-sm focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:outline-none ${
                  selectedRole?.id === role.id
                    ? "bg-list-active text-list-active-foreground"
                    : "text-foreground hover:bg-list-hover"
                }`}
              >
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  role.isSystem ? "bg-primary" : "bg-success"
                }`} />
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate text-xs">{role.displayName}</p>
                  <p className="text-[10px] text-description truncate">
                    {role.capabilities.length} capabilities
                  </p>
                </div>
                {role.isSystem ? (
                  <span className="text-[9px] text-description bg-secondary px-1.5 py-0.5 rounded">
                    System
                  </span>
                ) : null}
              </button>
            ))}

            <button
              onClick={() => {
                setShowNewRole(true);
                setEditCaps(new Set());
                setSelectedRole(null);
              }}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-primary hover:bg-primary/5 transition-colors focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:outline-none"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Create custom role
            </button>
          </div>
        </div>

        {/* Right: Capability editor */}
        <div className="flex-1 overflow-y-auto">
          {showNewRole ? (
            <div className="p-4 space-y-4">
              <h2 className="text-sm font-semibold text-foreground">New Custom Role</h2>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-medium text-description uppercase tracking-wider">
                    Role name (slug)
                  </label>
                  <input
                    type="text"
                    value={newRoleName}
                    onChange={(e) => setNewRoleName(e.target.value.toLowerCase().replace(/[^a-z0-9-_]/g, ""))}
                    placeholder="team-lead"
                    className="w-full px-3 py-2 rounded-lg bg-input text-input-foreground border border-border placeholder:text-input-placeholder focus:border-border-focus focus:outline-none text-sm"
                    autoFocus
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-medium text-description uppercase tracking-wider">
                    Display name
                  </label>
                  <input
                    type="text"
                    value={newRoleDisplay}
                    onChange={(e) => setNewRoleDisplay(e.target.value)}
                    placeholder="Team Lead"
                    className="w-full px-3 py-2 rounded-lg bg-input text-input-foreground border border-border placeholder:text-input-placeholder focus:border-border-focus focus:outline-none text-sm"
                  />
                </div>
              </div>

              <p className="text-xs text-description">Select capabilities below, then click Create.</p>
            </div>
          ) : selectedRole ? (
            <div className="p-4">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-sm font-semibold text-foreground">
                    {selectedRole.displayName}
                  </h2>
                  <p className="text-xs text-description">
                    {selectedRole.description || `${selectedRole.capabilities.length} capabilities assigned`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {selectedRole.isCustom === 1 && (
                    <button
                      onClick={() => handleDeleteRole(selectedRole.id)}
                      className="text-xs text-error hover:text-error/80 px-2 py-1 rounded border border-error/20 hover:bg-error/5 transition-colors focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:outline-none"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-description text-sm">
              Select a role to view its capabilities
            </div>
          )}

          {/* Capability grid */}
          {(selectedRole || showNewRole) && (
            <div className="px-4 pb-4 space-y-4">
              {groupedCaps.map(({ category, items }) => {
                const allSelected = items.every((c) => editCaps.has(c.name));
                const someSelected = items.some((c) => editCaps.has(c.name));

                return (
                  <div key={category}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-description">
                        {category}
                      </span>
                      <button
                        onClick={() => toggleCategory(category)}
                        disabled={selectedRole?.isSystem === 1}
                        className="text-[10px] text-primary hover:text-primary-hover disabled:text-description disabled:cursor-not-allowed transition-colors focus-visible:outline-none"
                      >
                        {allSelected ? "Deselect all" : someSelected ? "Select all" : "Select all"}
                      </button>
                    </div>

                    <div className="grid grid-cols-1 gap-1">
                      {items.map((cap) => {
                        const isEnabled = editCaps.has(cap.name);
                        const isSystem = selectedRole?.isSystem === 1;

                        return (
                          <button
                            key={cap.name}
                            onClick={() => !isSystem && toggleCapability(cap.name)}
                            disabled={isSystem}
                            className={`flex items-center gap-3 px-3 py-2 rounded-lg border transition-all text-left disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:outline-none ${
                              isEnabled
                                ? "border-primary/30 bg-primary/5"
                                : "border-border hover:border-border"
                            }`}
                          >
                            {/* Toggle */}
                            <div className={`w-4 h-4 rounded flex items-center justify-center flex-shrink-0 transition-colors ${
                              isEnabled ? "bg-primary" : "bg-secondary border border-border"
                            }`}>
                              {isEnabled && (
                                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" className="text-primary-foreground">
                                  <polyline points="20 6 9 17 4 12" />
                                </svg>
                              )}
                            </div>

                            {/* Info */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <code className="text-xs font-mono text-foreground">{cap.name}</code>
                                <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${RISK_BG[cap.riskLevel]} ${RISK_COLORS[cap.riskLevel]}`}>
                                  {cap.riskLevel}
                                </span>
                              </div>
                              <p className="text-[11px] text-description truncate">{cap.description}</p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Footer: Save bar */}
      {(hasChanges || showNewRole) && (
        <div className="px-4 py-3 border-t border-border bg-background flex items-center justify-between">
          <p className="text-xs text-description">
            {showNewRole
              ? `${editCaps.size} capabilities selected for new role`
              : `${editCaps.size} capabilities (unsaved changes)`}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                if (showNewRole) {
                  setShowNewRole(false);
                } else if (selectedRole) {
                  selectRole(selectedRole);
                }
              }}
              className="px-3 py-1.5 text-xs text-description hover:text-foreground border border-border rounded-lg transition-colors focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:outline-none"
            >
              Cancel
            </button>
            <button
              onClick={showNewRole ? handleCreateRole : saveRole}
              disabled={saving || (showNewRole && (!newRoleName.trim() || !newRoleDisplay.trim()))}
              className="px-4 py-1.5 text-xs font-semibold bg-primary text-primary-foreground rounded-lg hover:bg-primary-hover disabled:opacity-50 transition-colors focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:outline-none"
            >
              {saving ? "Saving..." : showNewRole ? "Create Role" : "Save Changes"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default RbacPage;
