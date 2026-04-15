import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ShieldCheckIcon,
  PlusIcon,
  TrashIcon,
  LockClosedIcon,
  CheckBadgeIcon,
  AdjustmentsHorizontalIcon,
  CodeBracketIcon,
} from "@heroicons/react/24/outline";
import { apiClient } from "../../api/client";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import { showToast } from "../../store/slices/uiSlice";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { LoadingSpinner } from "../../components/ui/LoadingSpinner";
import { ErrorBanner } from "../../components/ui/ErrorBanner";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { UnderlineTabs } from "../../components/ui/UnderlineTabs";
import { PermissionGate } from "../../components/shared/guard/PermissionGate";
import { selectPermissionsFetched } from "../../store/selectors/permissions.selectors";
import { fetchUserPermissions } from "../../store/slices/permissionsSlice";
import {
  MODULES,
  ACTIONS,
  MODULE_META,
  MATRIX_ACTIONS,
  ALL_INDIVIDUAL_ACTIONS,
  type Module,
  type Action,
} from "../../constants/permissions.constants";
import {
  atomsToMatrix,
  matrixToAtoms,
  togglePermission,
  buildSummary,
  isFullAccess,
  validateMatrix,
  type UniformAction,
  type PermissionRow,
} from "./permissionMatrix";
import { stripJsonComments } from "../../utils/jsonc";
import { cn } from "../../utils/cn";

/**
 * RBAC page — permission matrix + role editor + per-role policy tab.
 *
 * Structure (3-panel):
 *   ┌──────────────────┬──────────────────────────────────────────┐
 *   │ Role list sidebar│ Role editor                              │
 *   │  System roles    │  Header + tabs: Permissions | Policy |   │
 *   │  Custom roles    │  Users                                    │
 *   │  + New role      │  Permission matrix OR JSON policy OR     │
 *   │                  │  users list                              │
 *   └──────────────────┴──────────────────────────────────────────┘
 *
 * Rules enforced (spec):
 *   - System roles show read-only matrix; no save/delete buttons.
 *   - Custom roles: full edit, delete (blocked if users assigned).
 *   - Every checkbox respects the create→view dependency.
 *   - Live "This role can:" summary under the matrix.
 */

interface RoleCapRow {
  capabilityName: string;
  scope: string;
  granted: number;
}

interface Role {
  id: number;
  orgId: number | null;
  name: string;
  displayName: string;
  description?: string;
  isSystem: number;
  isCustom: number;
  capabilities: RoleCapRow[];
}

interface UserWithRole {
  id: number;
  email: string;
  name: string;
  role: {
    id: number | null;
    name: string;
    displayName: string;
    isSystem: boolean;
  };
  createdAt: number;
}

type EditorTab = "permissions" | "policy" | "users";

export function RbacPage() {
  const dispatch = useAppDispatch();
  const permsFetched = useAppSelector(selectPermissionsFetched);

  const [roles, setRoles] = useState<Role[]>([]);
  const [users, setUsers] = useState<UserWithRole[]>([]);
  const [selectedRoleId, setSelectedRoleId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [rolesResp, usersResp] = await Promise.all([
        apiClient.get<{ roles: Role[] }>("/api/roles"),
        apiClient
          .get<{ users: UserWithRole[] }>("/api/users")
          .catch(() => ({ users: [] as UserWithRole[] })),
      ]);
      setRoles(rolesResp.roles);
      setUsers(usersResp.users ?? []);
      if (rolesResp.roles.length > 0 && selectedRoleId === null) {
        setSelectedRoleId(rolesResp.roles[0].id);
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load roles");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const refreshPerms = useCallback(() => {
    if (permsFetched) dispatch(fetchUserPermissions());
  }, [dispatch, permsFetched]);

  const selectedRole = useMemo(
    () => roles.find((r) => r.id === selectedRoleId) ?? null,
    [roles, selectedRoleId],
  );

  const systemRoles = roles.filter((r) => r.isSystem === 1);
  const customRoles = roles.filter((r) => r.isSystem !== 1);

  return (
    <div className="text-foreground mx-auto max-w-7xl p-6">
      <header className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Roles & Permissions</h1>
          <p className="text-description mt-1 text-sm">
            Control what every member of your organisation can see and do. System roles are
            read-only; create custom roles to fit your team.
          </p>
        </div>
        <PermissionGate module={MODULES.ROLES} action={ACTIONS.CREATE}>
          <NewRoleButton roles={roles} onCreated={load} />
        </PermissionGate>
      </header>

      {loadError && <ErrorBanner message={loadError} className="mb-4" />}

      {loading ? (
        <div className="flex h-64 items-center justify-center">
          <LoadingSpinner />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[260px_1fr]">
          <RoleSidebar
            systemRoles={systemRoles}
            customRoles={customRoles}
            selectedRoleId={selectedRoleId}
            onSelect={setSelectedRoleId}
          />

          {selectedRole ? (
            <RoleEditor
              key={selectedRole.id}
              role={selectedRole}
              users={users}
              onSaved={() => {
                load();
                refreshPerms();
              }}
              onDeleted={() => {
                setSelectedRoleId(null);
                load();
              }}
            />
          ) : (
            <Card className="flex h-64 items-center justify-center">
              <p className="text-description text-sm">
                Select a role to view or edit its permissions.
              </p>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Role sidebar ───────────────────────────────────────────────────

function RoleSidebar({
  systemRoles,
  customRoles,
  selectedRoleId,
  onSelect,
}: {
  systemRoles: Role[];
  customRoles: Role[];
  selectedRoleId: number | null;
  onSelect: (id: number) => void;
}) {
  return (
    <aside className="space-y-4">
      <RoleGroup
        label="System Roles"
        icon={<LockClosedIcon className="h-4 w-4" />}
        roles={systemRoles}
        selectedRoleId={selectedRoleId}
        onSelect={onSelect}
      />
      <RoleGroup
        label="Custom Roles"
        icon={<ShieldCheckIcon className="h-4 w-4" />}
        roles={customRoles}
        selectedRoleId={selectedRoleId}
        onSelect={onSelect}
        emptyMessage="No custom roles yet. Click “New role” above."
      />
    </aside>
  );
}

function RoleGroup({
  label,
  icon,
  roles,
  selectedRoleId,
  onSelect,
  emptyMessage,
}: {
  label: string;
  icon: ReactNode;
  roles: Role[];
  selectedRoleId: number | null;
  onSelect: (id: number) => void;
  emptyMessage?: string;
}) {
  return (
    <Card padding={false}>
      <div className="border-border text-description flex items-center gap-2 border-b px-4 py-2 text-xs font-semibold uppercase tracking-wider">
        {icon}
        {label}
      </div>
      {roles.length === 0 && emptyMessage && (
        <p className="text-description-muted px-4 py-3 text-xs">{emptyMessage}</p>
      )}
      <ul>
        {roles.map((r) => {
          const selected = r.id === selectedRoleId;
          return (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => onSelect(r.id)}
                className={cn(
                  "flex w-full items-center justify-between px-4 py-2.5 text-left text-sm transition-colors",
                  selected
                    ? "bg-list-active text-list-active-foreground"
                    : "hover:bg-list-hover text-foreground",
                )}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-medium">{r.displayName}</span>
                </div>
                {r.isSystem === 1 ? (
                  <Badge variant="info" className="ml-2 shrink-0">
                    System
                  </Badge>
                ) : (
                  <Badge variant="success" className="ml-2 shrink-0">
                    Custom
                  </Badge>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

// ─── Role editor ────────────────────────────────────────────────────

function RoleEditor({
  role,
  users,
  onSaved,
  onDeleted,
}: {
  role: Role;
  users: UserWithRole[];
  onSaved: () => void;
  onDeleted: () => void;
}) {
  const dispatch = useAppDispatch();
  const isSystem = role.isSystem === 1;
  const [tab, setTab] = useState<EditorTab>("permissions");

  const { matrix: initialMatrix, legacyAtoms } = useMemo(() => {
    const atoms = role.capabilities.map((c) => c.capabilityName);
    const legacy = atoms.filter((a) => {
      const [, action] = a.split(":");
      return !ALL_INDIVIDUAL_ACTIONS.includes(action as Action);
    });
    return { matrix: atomsToMatrix(atoms), legacyAtoms: legacy };
  }, [role]);

  const [matrix, setMatrix] = useState(initialMatrix);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [userCount, setUserCount] = useState<number | null>(null);

  useEffect(() => {
    setMatrix(initialMatrix);
    setSaveError(null);
  }, [initialMatrix, role.id]);

  const dirty = useMemo(() => {
    const a = JSON.stringify(
      Array.from(initialMatrix.entries()).map(([k, v]) => [k, Array.from(v).sort()]),
    );
    const b = JSON.stringify(
      Array.from(matrix.entries()).map(([k, v]) => [k, Array.from(v).sort()]),
    );
    return a !== b;
  }, [initialMatrix, matrix]);

  const problems = useMemo(() => validateMatrix(matrix), [matrix]);

  async function handleSave() {
    if (isSystem) return;
    if (problems.length > 0) {
      setSaveError(problems.join("; "));
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const atoms = matrixToAtoms(matrix, legacyAtoms);
      await apiClient.put(`/api/roles/${role.id}`, { capabilities: atoms });
      dispatch(
        showToast({
          id: `role-save-${Date.now()}`,
          type: "success",
          message: "Role updated",
        }),
      );
      onSaved();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save role");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteConfirm() {
    setSaving(true);
    setSaveError(null);
    try {
      const countResp = await apiClient.get<{ count: number }>(`/api/roles/${role.id}/users-count`);
      if (countResp.count > 0) {
        setUserCount(countResp.count);
        setSaveError(
          `${countResp.count} user${countResp.count === 1 ? " is" : "s are"} still assigned this role — reassign them first.`,
        );
        setConfirmDelete(false);
        return;
      }
      await apiClient.del(`/api/roles/${role.id}`);
      dispatch(
        showToast({
          id: `role-del-${Date.now()}`,
          type: "success",
          message: `Deleted ${role.displayName}`,
        }),
      );
      onDeleted();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to delete role");
    } finally {
      setSaving(false);
      setConfirmDelete(false);
    }
  }

  const tabs = [
    { id: "permissions", label: "Permissions" },
    { id: "policy", label: "Policy" },
    { id: "users", label: "Users" },
  ] as const;

  return (
    <Card padding={false}>
      <div className="border-border flex items-start justify-between gap-4 border-b px-6 py-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">{role.displayName}</h2>
            {isSystem ? (
              <Badge variant="info">System</Badge>
            ) : (
              <Badge variant="success">Custom</Badge>
            )}
          </div>
          {role.description && <p className="text-description mt-1 text-sm">{role.description}</p>}
        </div>
        {!isSystem && (
          <PermissionGate module={MODULES.ROLES} action={ACTIONS.DELETE}>
            <Button
              variant="danger"
              size="sm"
              onClick={() => setConfirmDelete(true)}
              disabled={saving}
            >
              <TrashIcon className="mr-1 h-4 w-4" />
              Delete
            </Button>
          </PermissionGate>
        )}
      </div>

      <UnderlineTabs
        tabs={[...tabs]}
        activeTab={tab}
        onChange={(id) => setTab(id as EditorTab)}
        className="px-6"
      />

      <div className="px-6 py-5">
        {tab === "permissions" && (
          <PermissionsMatrix matrix={matrix} onChange={setMatrix} readOnly={isSystem} />
        )}
        {tab === "policy" && <PolicyTab roleName={role.name} />}
        {tab === "users" && <UsersTab role={role} users={users} />}
      </div>

      {saveError && <ErrorBanner message={saveError} className="mx-6 mb-3" />}

      {!isSystem && tab === "permissions" && (
        <div className="border-border flex items-center justify-between border-t px-6 py-4">
          <div className="text-description text-xs">
            {dirty ? "Unsaved changes" : "No changes"}
            {userCount !== null && userCount > 0 && (
              <span className="text-warning ml-2">
                · {userCount} user{userCount === 1 ? "" : "s"} will be affected
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setMatrix(initialMatrix)}
              disabled={!dirty || saving}
            >
              Reset
            </Button>
            <PermissionGate module={MODULES.ROLES} action={ACTIONS.EDIT}>
              <Button
                variant="primary"
                size="sm"
                loading={saving}
                disabled={!dirty || problems.length > 0}
                onClick={handleSave}
              >
                Save permissions
              </Button>
            </PermissionGate>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title={`Delete ${role.displayName}?`}
        message="This is permanent. Users assigned this role will lose it."
        confirmLabel="Delete role"
        variant="danger"
        onConfirm={handleDeleteConfirm}
        onCancel={() => setConfirmDelete(false)}
      />
    </Card>
  );
}

// ─── Permissions matrix ─────────────────────────────────────────────

function PermissionsMatrix({
  matrix,
  onChange,
  readOnly,
}: {
  matrix: Map<string, Set<UniformAction>>;
  onChange: (next: Map<string, Set<UniformAction>>) => void;
  readOnly: boolean;
}) {
  const categories = useMemo(() => {
    const groups = new Map<string, PermissionRow[]>();
    for (const mod of Object.values(MODULES)) {
      const meta = MODULE_META[mod as Module];
      const row: PermissionRow = {
        resource: mod,
        label: meta.label,
        category: meta.category,
        supported: meta.supported.filter((a) => a !== ACTIONS.FULL_ACCESS) as UniformAction[],
      };
      const existing = groups.get(meta.category) ?? [];
      existing.push(row);
      groups.set(meta.category, existing);
    }
    return groups;
  }, []);

  const allRows = useMemo(() => Array.from(categories.values()).flat(), [categories]);

  const summary = useMemo(() => buildSummary(allRows, matrix), [allRows, matrix]);

  function toggle(row: PermissionRow, action: UniformAction | "full_access", checked: boolean) {
    if (readOnly) return;
    const current = matrix.get(row.resource) ?? new Set<UniformAction>();
    const next = togglePermission(current, action, checked);
    const newMatrix = new Map(matrix);
    if (next.size === 0) newMatrix.delete(row.resource);
    else newMatrix.set(row.resource, next);
    onChange(newMatrix);
  }

  return (
    <div className="space-y-6">
      {Array.from(categories.entries()).map(([category, rows]) => (
        <section key={category}>
          <h3 className="text-description mb-2 text-xs font-semibold uppercase tracking-wider">
            {category}
          </h3>
          <div className="border-border overflow-hidden rounded-lg border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-border bg-secondary border-b">
                  <th className="text-description px-4 py-2 text-left text-xs font-semibold uppercase">
                    Resource
                  </th>
                  {MATRIX_ACTIONS.map((a) => (
                    <th
                      key={a}
                      className="text-description w-24 px-2 py-2 text-center text-xs font-semibold uppercase"
                    >
                      {a === ACTIONS.FULL_ACCESS ? "Full" : a}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const actions = matrix.get(row.resource) ?? new Set<UniformAction>();
                  const full = isFullAccess(actions);
                  return (
                    <tr
                      key={row.resource}
                      className="border-border even:bg-table-oddRow/30 border-b last:border-0"
                    >
                      <td className="text-foreground px-4 py-2 font-medium">
                        {row.label}
                        <span className="text-description-muted ml-2 text-xs font-normal">
                          {row.resource}
                        </span>
                      </td>
                      {MATRIX_ACTIONS.map((a) => {
                        const isFullCol = a === ACTIONS.FULL_ACCESS;
                        const supported = isFullCol || row.supported.includes(a as UniformAction);
                        if (!supported) {
                          return (
                            <td key={a} className="text-description-muted px-2 py-2 text-center">
                              —
                            </td>
                          );
                        }
                        const checked = isFullCol ? full : actions.has(a as UniformAction);
                        const viewForced =
                          a === ACTIONS.VIEW &&
                          ["create", "edit", "delete", "export"].some((d) =>
                            actions.has(d as UniformAction),
                          );
                        return (
                          <td key={a} className="px-2 py-2 text-center">
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={readOnly || (a === ACTIONS.VIEW && viewForced)}
                              onChange={(e) => toggle(row, a, e.target.checked)}
                              className="accent-primary h-4 w-4"
                              aria-label={`${row.label} ${a}`}
                              title={
                                viewForced
                                  ? "View is required while another action is granted"
                                  : undefined
                              }
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
        </section>
      ))}

      <div className="border-primary/30 bg-primary/5 text-description flex items-start gap-2 rounded-lg border px-4 py-3 text-sm">
        <CheckBadgeIcon className="text-primary mt-0.5 h-4 w-4 shrink-0" />
        <span>{summary}</span>
      </div>
    </div>
  );
}

// ─── Users tab ──────────────────────────────────────────────────────

function UsersTab({ role, users }: { role: Role; users: UserWithRole[] }) {
  const assigned = users.filter((u) => u.role.id === role.id);

  if (assigned.length === 0) {
    return (
      <div className="py-10 text-center">
        <p className="text-description text-sm">
          No users are currently assigned the <strong>{role.displayName}</strong> role.
        </p>
      </div>
    );
  }

  return (
    <div className="border-border overflow-hidden rounded-lg border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-border bg-secondary border-b">
            <th className="text-description px-4 py-2 text-left text-xs font-semibold uppercase">
              Name
            </th>
            <th className="text-description px-4 py-2 text-left text-xs font-semibold uppercase">
              Email
            </th>
            <th className="text-description px-4 py-2 text-left text-xs font-semibold uppercase">
              Joined
            </th>
          </tr>
        </thead>
        <tbody>
          {assigned.map((u) => (
            <tr key={u.id} className="border-border even:bg-table-oddRow/30 border-b last:border-0">
              <td className="text-foreground px-4 py-2 font-medium">{u.name}</td>
              <td className="text-description px-4 py-2">{u.email}</td>
              <td className="text-description-muted px-4 py-2 text-xs">
                {new Date(u.createdAt).toLocaleDateString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Policy tab (per-role policy overlay) ──────────────────────────

interface WizardPolicyShape {
  rules?: Record<string, boolean>;
  severity_threshold?: "medium" | "high" | "critical";
  prompt_injection?: { enabled?: boolean; threshold?: number };
  response_scanning?: { enabled?: boolean };
  [key: string]: unknown;
}

function PolicyTab({ roleName }: { roleName: string }) {
  const dispatch = useAppDispatch();
  const [loading, setLoading] = useState(true);
  const [jsonText, setJsonText] = useState("{}");
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [hasOverride, setHasOverride] = useState(false);
  const [isTemplate, setIsTemplate] = useState(false);
  const [saving, setSaving] = useState(false);

  /**
   * Load strategy:
   *   1. GET /api/policies/role/:roleName
   *      - System roles with no override get lazy-seeded server-side
   *        (returns `hasOverride: true, policy: <defaults>`)
   *      - Custom roles with no override return `hasOverride: false,
   *        policy: null` — we then fetch the commented JSONC template
   *        so the user can learn the shape by reading it.
   *   2. GET /api/policies/role-template (only when we need the template)
   *
   * On save we strip // comments from the textarea via stripJsonComments
   * before calling JSON.parse, so the user can leave the comments in
   * place without breaking the persist flow.
   */
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await apiClient.get<{
        role: string;
        hasOverride: boolean;
        policy: WizardPolicyShape | null;
        updatedAt: number | null;
      }>(`/api/policies/role/${roleName}`);

      setHasOverride(resp.hasOverride);

      const policyIsEmpty = !resp.policy || Object.keys(resp.policy).length === 0;

      if (resp.hasOverride && !policyIsEmpty) {
        // Populate the editor with the stored policy — plain JSON,
        // no comments. Safe to JSON.stringify directly.
        setJsonText(JSON.stringify(resp.policy, null, 2));
        setIsTemplate(false);
      } else {
        // No override, OR override is empty (e.g. Admin's default
        // `{}`). Show the commented JSONC template so admins can see
        // every available field with inline explanations. The
        // existing stored values (if any) don't conflict because
        // `{}` has no fields to lose — saving the template just
        // replaces the empty override with real values.
        try {
          const tmpl = await apiClient.get<{ template: string }>("/api/policies/role-template");
          setJsonText(tmpl.template);
          setIsTemplate(true);
        } catch {
          setJsonText("{}");
          setIsTemplate(false);
        }
      }
      setJsonError(null);
    } catch (err) {
      console.warn("[PolicyTab] load failed:", err);
    } finally {
      setLoading(false);
    }
  }, [roleName]);

  useEffect(() => {
    load();
  }, [load]);

  function handleJsonChange(text: string) {
    setJsonText(text);
    setIsTemplate(false);
    if (!text.trim()) {
      setJsonError(null);
      return;
    }
    try {
      // Strip // comments before validating so the textarea can hold
      // the JSONC template unchanged.
      const stripped = stripJsonComments(text);
      if (!stripped.trim()) {
        setJsonError(null);
        return;
      }
      const parsed = JSON.parse(stripped);
      if (typeof parsed !== "object" || Array.isArray(parsed)) {
        setJsonError("Policy must be a JSON object.");
        return;
      }
      setJsonError(null);
    } catch (err) {
      setJsonError(err instanceof Error ? err.message : "Invalid JSON");
    }
  }

  async function save() {
    if (jsonError) return;
    setSaving(true);
    try {
      // Strip comments then parse. Empty body is stored as {}.
      const stripped = stripJsonComments(jsonText || "{}").trim();
      const policy = stripped.length > 0 ? JSON.parse(stripped) : {};
      await apiClient.put(`/api/policies/role/${roleName}`, policy);
      dispatch(
        showToast({
          id: `role-policy-save-${Date.now()}`,
          type: "success",
          message: "Policy override saved",
        }),
      );
      await load();
    } catch (err) {
      dispatch(
        showToast({
          id: `role-policy-err-${Date.now()}`,
          type: "error",
          message: err instanceof Error ? err.message : "Failed to save",
        }),
      );
    } finally {
      setSaving(false);
    }
  }

  async function removeOverride() {
    setSaving(true);
    try {
      await apiClient.del(`/api/policies/role/${roleName}`);
      dispatch(
        showToast({
          id: `role-policy-del-${Date.now()}`,
          type: "success",
          message: "Override removed",
        }),
      );
      await load();
    } catch (err) {
      dispatch(
        showToast({
          id: `role-policy-err-${Date.now()}`,
          type: "error",
          message: err instanceof Error ? err.message : "Failed to remove",
        }),
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="text-description flex items-start gap-2 text-xs">
        <AdjustmentsHorizontalIcon className="h-3.5 w-3.5 shrink-0" />
        <span>
          Policy overrides <strong>tighten</strong> the org baseline for this role only. Leave a
          field unset to inherit.
        </span>
      </div>

      <div className="text-description-muted flex items-center gap-2 text-xs">
        <CodeBracketIcon className="h-3.5 w-3.5" />
        Partial PolicyConfig JSON — {isTemplate ? "JSONC template — " : ""}
        comments are allowed, stripped before save.
      </div>

      {isTemplate && (
        <div className="border-warning/30 bg-warning/5 text-warning flex items-start gap-2 rounded-lg border px-3 py-2 text-xs">
          <CheckBadgeIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {hasOverride
              ? "This role uses the org baseline (no custom overrides). "
              : "No override yet. "}
            Below is the <strong>full policy template</strong> with every editable field and an
            explanation of what it does. Uncomment or edit the fields you want to tighten for this
            role, then click <strong>Save policy</strong>.
          </span>
        </div>
      )}

      {/* Quick summary of configured values */}
      {!isTemplate && !policyIsEffectivelyEmpty(jsonText) && (
        <PolicySummaryStrip jsonText={jsonText} />
      )}

      <textarea
        value={jsonText}
        onChange={(e) => handleJsonChange(e.target.value)}
        spellCheck={false}
        className={cn(
          "bg-editor text-foreground border-border focus:border-border-focus w-full rounded-md border p-3 font-mono text-xs focus:outline-none focus:ring-1 focus:ring-border-focus",
          "min-h-[280px]",
          jsonError && "border-error focus:border-error focus:ring-error",
        )}
      />

      {jsonError && <p className="text-error text-xs">{jsonError}</p>}

      <div className="flex items-center justify-between">
        <div>
          {hasOverride && (
            <Button variant="danger" size="sm" onClick={removeOverride} disabled={saving}>
              <TrashIcon className="mr-1 h-4 w-4" />
              Remove override
            </Button>
          )}
        </div>
        <Button variant="primary" size="sm" onClick={save} loading={saving} disabled={!!jsonError}>
          Save policy
        </Button>
      </div>
    </div>
  );
}

// ─── "New role" modal ───────────────────────────────────────────────

function NewRoleButton({ roles, onCreated }: { roles: Role[]; onCreated: () => void }) {
  const dispatch = useAppDispatch();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [cloneFromId, setCloneFromId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    if (!displayName.trim()) {
      setError("Display name required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const source = cloneFromId ? roles.find((r) => r.id === cloneFromId) : null;
      const caps = source?.capabilities.map((c) => c.capabilityName) ?? ["chat:view"];

      await apiClient.post("/api/roles", {
        name: name.trim() || displayName.trim().toLowerCase(),
        displayName: displayName.trim(),
        description: description.trim(),
        capabilities: caps,
      });
      dispatch(
        showToast({
          id: `role-new-${Date.now()}`,
          type: "success",
          message: "Role created",
        }),
      );
      setOpen(false);
      setName("");
      setDisplayName("");
      setDescription("");
      setCloneFromId(null);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create role");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        <PlusIcon className="mr-1 h-4 w-4" />
        New role
      </Button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <div className="pointer-events-none fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8">
            <Card className="pointer-events-auto w-full max-w-md" padding={false}>
              <div className="border-border border-b px-6 py-4">
                <h2 className="text-foreground text-base font-semibold">Create custom role</h2>
                <p className="text-description mt-0.5 text-xs">
                  Clone from an existing role to save time. You can edit permissions right after
                  creating it.
                </p>
              </div>

              <div className="space-y-4 px-6 py-5">
                <div>
                  <label className="text-description mb-1 block text-xs font-medium uppercase tracking-wider">
                    Display name
                  </label>
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="e.g. Support Engineer"
                    className="bg-input border-input-border text-input-foreground placeholder:text-input-placeholder focus:border-border-focus focus:ring-border-focus w-full rounded-lg border px-3 py-2 focus:outline-none focus:ring-1"
                  />
                </div>
                <div>
                  <label className="text-description mb-1 block text-xs font-medium uppercase tracking-wider">
                    Slug <span className="text-description-muted">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) =>
                      setName(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))
                    }
                    placeholder="support-engineer"
                    className="bg-input border-input-border text-input-foreground placeholder:text-input-placeholder focus:border-border-focus focus:ring-border-focus w-full rounded-lg border px-3 py-2 focus:outline-none focus:ring-1"
                  />
                </div>
                <div>
                  <label className="text-description mb-1 block text-xs font-medium uppercase tracking-wider">
                    Description
                  </label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="What is this role for?"
                    rows={2}
                    className="bg-input border-input-border text-input-foreground placeholder:text-input-placeholder focus:border-border-focus focus:ring-border-focus w-full rounded-lg border px-3 py-2 focus:outline-none focus:ring-1"
                  />
                </div>
                <div>
                  <label className="text-description mb-1 block text-xs font-medium uppercase tracking-wider">
                    Clone from
                  </label>
                  <select
                    value={cloneFromId ?? ""}
                    onChange={(e) => setCloneFromId(e.target.value ? Number(e.target.value) : null)}
                    className="bg-input border-input-border text-input-foreground focus:border-border-focus focus:ring-border-focus w-full rounded-lg border px-3 py-2 focus:outline-none focus:ring-1"
                  >
                    <option value="">(start empty)</option>
                    {roles.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.displayName} {r.isSystem === 1 ? "(system)" : ""}
                      </option>
                    ))}
                  </select>
                </div>

                {error && <ErrorBanner message={error} />}
              </div>

              <div className="border-border flex items-center justify-end gap-2 border-t px-6 py-4">
                <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
                  Cancel
                </Button>
                <Button variant="primary" onClick={create} loading={saving}>
                  Create
                </Button>
              </div>
            </Card>
          </div>
        </>
      )}
    </>
  );
}

// ─── Policy summary helpers ──────────────────────────────────────────

function policyIsEffectivelyEmpty(jsonText: string): boolean {
  try {
    const stripped = stripJsonComments(jsonText || "{}").trim();
    if (!stripped || stripped === "{}") return true;
    const parsed = JSON.parse(stripped);
    return typeof parsed === "object" && Object.keys(parsed).length === 0;
  } catch {
    return true;
  }
}

function PolicySummaryStrip({ jsonText }: { jsonText: string }) {
  let policy: Record<string, unknown>;
  try {
    policy = JSON.parse(stripJsonComments(jsonText || "{}"));
    if (!policy || typeof policy !== "object") return null;
  } catch {
    return null;
  }

  const rules = policy.rules as Record<string, boolean> | undefined;
  const activeRules = rules ? Object.entries(rules).filter(([, v]) => v === true) : [];
  const blockedPaths = (policy.blocked_paths ?? []) as string[];
  const fileBlocklist = ((policy.file_scope as Record<string, unknown>)?.blocklist ??
    []) as string[];
  const injThreshold = (policy.prompt_injection as Record<string, unknown> | undefined)
    ?.threshold as number | undefined;
  const severity = policy.severity_threshold as string | undefined;
  const respScan = (policy.response_scanning as Record<string, unknown> | undefined)?.enabled as
    | boolean
    | undefined;

  const chips: Array<{ label: string; color: string }> = [];

  if (activeRules.length > 0) {
    chips.push({
      label: `${activeRules.length} rule${activeRules.length > 1 ? "s" : ""} active`,
      color: "bg-success/10 text-success",
    });
  }
  if (blockedPaths.length > 0 || fileBlocklist.length > 0) {
    const total = blockedPaths.length + fileBlocklist.length;
    chips.push({
      label: `${total} path${total > 1 ? "s" : ""} blocked`,
      color: "bg-error/10 text-error",
    });
  }
  if (injThreshold !== undefined) {
    chips.push({
      label: `injection: ${injThreshold}`,
      color: "bg-warning/10 text-warning",
    });
  }
  if (severity) {
    chips.push({
      label: `severity: ${severity}`,
      color: "bg-info/10 text-info",
    });
  }
  if (respScan === true) {
    chips.push({
      label: "response scan ON",
      color: "bg-primary/10 text-primary",
    });
  }

  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((c) => (
        <span
          key={c.label}
          className={cn("rounded-md px-2 py-0.5 text-[10px] font-semibold", c.color)}
        >
          {c.label}
        </span>
      ))}
    </div>
  );
}

export default RbacPage;
