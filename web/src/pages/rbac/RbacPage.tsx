import { useEffect, useState } from "react";
import {
  ShieldCheckIcon,
  PlusIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import { apiClient } from "../../api/client";
import { useAppDispatch } from "../../store/hooks";
import { showToast } from "../../store/slices/uiSlice";
import { cn } from "../../utils/cn";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { LoadingSpinner } from "../../components/ui/LoadingSpinner";
import { ErrorBanner } from "../../components/ui/ErrorBanner";
import { EmptyState } from "../../components/ui/EmptyState";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";

interface Capability {
  id: string;
  name: string;
  category: string;
  riskLevel: "low" | "medium" | "high" | "critical";
}

interface Role {
  id: string;
  name: string;
  description?: string;
  isSystem: boolean;
  capabilities: string[];
}

const CATEGORIES = [
  "Organisation",
  "Teams",
  "Identity",
  "Security",
  "Vault",
  "Audit",
  "Developer",
] as const;

const riskVariant: Record<string, "success" | "info" | "warning" | "error"> = {
  low: "success",
  medium: "info",
  high: "warning",
  critical: "error",
};

export function RbacPage() {
  const dispatch = useAppDispatch();
  const [roles, setRoles] = useState<Role[]>([]);
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState<string | null>(null);
  const [editedCaps, setEditedCaps] = useState<Set<string>>(new Set());
  const [originalCaps, setOriginalCaps] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newRoleName, setNewRoleName] = useState("");
  const [newRoleDesc, setNewRoleDesc] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Role | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [rolesRes, capsRes] = await Promise.all([
          apiClient.get<{ roles: Role[] } | Role[]>("/api/roles"),
          apiClient.get<{ capabilities: Capability[] } | Capability[]>(
            "/api/capabilities",
          ),
        ]);
        const rolesData = Array.isArray(rolesRes) ? rolesRes : rolesRes.roles;
        const capsData = Array.isArray(capsRes)
          ? capsRes
          : capsRes.capabilities;
        setRoles(rolesData);
        setCapabilities(capsData);
        if (rolesData.length > 0 && !selectedRoleId) {
          selectRole(rolesData[0]);
        }
      } catch (err: unknown) {
        if (err instanceof Error) setError(err.message);
        else setError("Failed to load RBAC data");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function selectRole(role: Role) {
    setSelectedRoleId(role.id);
    const caps = new Set(role.capabilities);
    setEditedCaps(new Set(caps));
    setOriginalCaps(new Set(caps));
  }

  const selectedRole = roles.find((r) => r.id === selectedRoleId);
  const hasChanges =
    editedCaps.size !== originalCaps.size ||
    [...editedCaps].some((c) => !originalCaps.has(c));

  function toggleCap(capId: string) {
    setEditedCaps((prev) => {
      const next = new Set(prev);
      if (next.has(capId)) next.delete(capId);
      else next.add(capId);
      return next;
    });
  }

  function toggleCategory(category: string) {
    const catCaps = capabilities
      .filter((c) => c.category === category)
      .map((c) => c.id);
    const allSelected = catCaps.every((id) => editedCaps.has(id));

    setEditedCaps((prev) => {
      const next = new Set(prev);
      for (const id of catCaps) {
        if (allSelected) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }

  async function handleSave() {
    if (!selectedRoleId) return;
    setSaving(true);
    try {
      await apiClient.put(`/api/roles/${selectedRoleId}`, {
        capabilities: [...editedCaps],
      });
      setOriginalCaps(new Set(editedCaps));
      setRoles((prev) =>
        prev.map((r) =>
          r.id === selectedRoleId ? { ...r, capabilities: [...editedCaps] } : r,
        ),
      );
      dispatch(
        showToast({
          id: `rbac-save-${Date.now()}`,
          type: "success",
          message: "Role capabilities saved",
        }),
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to save role";
      dispatch(
        showToast({
          id: `rbac-err-${Date.now()}`,
          type: "error",
          message: msg,
        }),
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleCreate() {
    if (!newRoleName.trim()) return;
    try {
      const created = await apiClient.post<Role>("/api/roles", {
        name: newRoleName.trim(),
        description: newRoleDesc.trim(),
      });
      setRoles((prev) => [...prev, created]);
      selectRole(created);
      setShowCreate(false);
      setNewRoleName("");
      setNewRoleDesc("");
      dispatch(
        showToast({
          id: `rbac-create-${Date.now()}`,
          type: "success",
          message: `Role "${created.name}" created`,
        }),
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to create role";
      dispatch(
        showToast({
          id: `rbac-err-${Date.now()}`,
          type: "error",
          message: msg,
        }),
      );
    }
  }

  async function handleDelete(role: Role) {
    try {
      await apiClient.del(`/api/roles/${role.id}`);
      setRoles((prev) => prev.filter((r) => r.id !== role.id));
      if (selectedRoleId === role.id) {
        setSelectedRoleId(null);
      }
      dispatch(
        showToast({
          id: `rbac-del-${Date.now()}`,
          type: "success",
          message: `Role "${role.name}" deleted`,
        }),
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to delete role";
      dispatch(
        showToast({
          id: `rbac-err-${Date.now()}`,
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

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-foreground text-2xl font-bold">
        Roles & Permissions
      </h1>

      <div className="flex flex-col gap-6 lg:flex-row">
        {/* Left pane: Role list */}
        <div className="w-full space-y-2 lg:w-1/3">
          <div className="flex items-center justify-between">
            <h2 className="text-foreground text-sm font-semibold">Roles</h2>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowCreate(true)}
            >
              <PlusIcon className="h-3.5 w-3.5" />
              Create Role
            </Button>
          </div>

          {showCreate && (
            <Card>
              <div className="space-y-2">
                <input
                  type="text"
                  placeholder="Role name"
                  value={newRoleName}
                  onChange={(e) => setNewRoleName(e.target.value)}
                  className="border-input-border bg-input text-input-foreground placeholder:text-input-placeholder focus:border-border-focus focus:ring-border-focus w-full rounded-md border px-3 py-1.5 text-sm focus:outline-none focus:ring-1"
                />
                <input
                  type="text"
                  placeholder="Description (optional)"
                  value={newRoleDesc}
                  onChange={(e) => setNewRoleDesc(e.target.value)}
                  className="border-input-border bg-input text-input-foreground placeholder:text-input-placeholder focus:border-border-focus focus:ring-border-focus w-full rounded-md border px-3 py-1.5 text-sm focus:outline-none focus:ring-1"
                />
                <div className="flex justify-end gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowCreate(false)}
                  >
                    Cancel
                  </Button>
                  <Button size="sm" onClick={handleCreate}>
                    Create
                  </Button>
                </div>
              </div>
            </Card>
          )}

          {roles.length === 0 ? (
            <EmptyState
              icon={<ShieldCheckIcon className="h-10 w-10" />}
              title="No roles"
              description="Create your first role to manage permissions."
            />
          ) : (
            roles.map((role) => (
              <button
                key={role.id}
                onClick={() => selectRole(role)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors",
                  selectedRoleId === role.id
                    ? "border-primary bg-primary/5"
                    : "border-border bg-editor hover:bg-list-hover",
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-foreground text-sm font-medium">
                      {role.name}
                    </span>
                    {role.isSystem && <Badge variant="default">System</Badge>}
                  </div>
                  <span className="text-description text-xs">
                    {role.capabilities.length} capabilities
                  </span>
                </div>
              </button>
            ))
          )}
        </div>

        {/* Right pane: Capability editor */}
        <div className="flex-1">
          {selectedRole ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-foreground text-lg font-semibold">
                    {selectedRole.name}
                  </h2>
                  {selectedRole.description && (
                    <p className="text-description text-sm">
                      {selectedRole.description}
                    </p>
                  )}
                </div>
                {!selectedRole.isSystem && (
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => setDeleteTarget(selectedRole)}
                  >
                    <TrashIcon className="h-4 w-4" />
                    Delete
                  </Button>
                )}
              </div>

              {CATEGORIES.map((category) => {
                const catCaps = capabilities.filter(
                  (c) => c.category === category,
                );
                if (catCaps.length === 0) return null;
                const allSelected = catCaps.every((c) => editedCaps.has(c.id));

                return (
                  <Card key={category}>
                    <div className="mb-3 flex items-center justify-between">
                      <h3 className="text-foreground text-sm font-semibold">
                        {category}
                      </h3>
                      <label className="text-description flex cursor-pointer items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked={allSelected}
                          onChange={() => toggleCategory(category)}
                          className="border-input-border text-primary focus:ring-primary h-3.5 w-3.5 rounded"
                        />
                        Select all
                      </label>
                    </div>
                    <div className="space-y-2">
                      {catCaps.map((cap) => (
                        <label
                          key={cap.id}
                          className="hover:bg-list-hover flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 transition-colors"
                        >
                          <input
                            type="checkbox"
                            checked={editedCaps.has(cap.id)}
                            onChange={() => toggleCap(cap.id)}
                            className="border-input-border text-primary focus:ring-primary h-4 w-4 rounded"
                          />
                          <span className="text-foreground flex-1 text-sm">
                            {cap.name}
                          </span>
                          <Badge
                            variant={riskVariant[cap.riskLevel] ?? "default"}
                          >
                            {cap.riskLevel}
                          </Badge>
                        </label>
                      ))}
                    </div>
                  </Card>
                );
              })}

              {/* Save bar */}
              {hasChanges && (
                <div className="border-border bg-editor sticky bottom-4 flex items-center justify-end gap-3 rounded-lg border p-4 shadow-lg">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditedCaps(new Set(originalCaps))}
                  >
                    Discard
                  </Button>
                  <Button size="sm" loading={saving} onClick={handleSave}>
                    Save Changes
                  </Button>
                </div>
              )}
            </div>
          ) : (
            <EmptyState
              icon={<ShieldCheckIcon className="h-12 w-12" />}
              title="Select a role"
              description="Choose a role from the list to view and edit its capabilities."
            />
          )}
        </div>
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && handleDelete(deleteTarget)}
        title="Delete Role"
        message={`Are you sure you want to delete "${deleteTarget?.name}"? This cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
      />
    </div>
  );
}
