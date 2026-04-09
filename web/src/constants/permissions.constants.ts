/**
 * Central RBAC constants. Every `module` / `action` string used by the
 * frontend MUST come from this file — no raw literals at call sites.
 *
 * Rule from the spec:
 *   WRONG:  usePermission('users', 'create')
 *   RIGHT:  usePermission(MODULES.USERS, ACTIONS.CREATE)
 *
 * The module list mirrors the resources the backend seeds in
 * `proxy/src/db/database.ts` (`capabilities.resource` column) under
 * the uniform-action model:
 *   view | create | edit | delete | export | full_access
 */

export const MODULES = {
  USERS: "users",
  ROLES: "roles",
  TEAMS: "teams",
  ORG_SETTINGS: "org_settings",
  BILLING: "billing",
  POLICIES: "policies",
  PROVIDERS: "providers",
  AUDIT_LOGS: "audit_logs",
  APPROVALS: "approvals",
  FILE_RESTRICTIONS: "file_restrictions",
  CHAT: "chat",
  AGENTS: "agents",
  MCP_TOOLS: "mcp_tools",
} as const;

export type Module = (typeof MODULES)[keyof typeof MODULES];

export const ACTIONS = {
  VIEW: "view",
  CREATE: "create",
  EDIT: "edit",
  DELETE: "delete",
  EXPORT: "export",
  FULL_ACCESS: "full_access",
} as const;

export type Action = (typeof ACTIONS)[keyof typeof ACTIONS];

/** Actions that require `view` on the same module (dependency rule). */
export const ACTIONS_REQUIRING_VIEW: readonly Action[] = [
  ACTIONS.CREATE,
  ACTIONS.EDIT,
  ACTIONS.DELETE,
  ACTIONS.EXPORT,
] as const;

/** The five real permission actions (NOT full_access — that's virtual). */
export const ALL_INDIVIDUAL_ACTIONS: readonly Action[] = [
  ACTIONS.VIEW,
  ACTIONS.CREATE,
  ACTIONS.EDIT,
  ACTIONS.DELETE,
  ACTIONS.EXPORT,
] as const;

/** Actions that are rendered as columns in the role matrix UI. */
export const MATRIX_ACTIONS: readonly Action[] = [
  ACTIONS.FULL_ACCESS,
  ACTIONS.VIEW,
  ACTIONS.CREATE,
  ACTIONS.EDIT,
  ACTIONS.DELETE,
  ACTIONS.EXPORT,
] as const;

/**
 * Resource metadata for the matrix UI — label, category, and which
 * actions are actually supported. `supported` keeps rare combinations
 * from rendering useless cells (e.g. `chat:delete` isn't a thing).
 */
export interface ModuleMeta {
  label: string;
  category:
    | "Identity"
    | "Organisation"
    | "Security"
    | "Vault"
    | "Audit"
    | "Developer";
  supported: readonly Action[];
}

export const MODULE_META: Record<Module, ModuleMeta> = {
  [MODULES.USERS]: {
    label: "Users",
    category: "Identity",
    supported: ALL_INDIVIDUAL_ACTIONS,
  },
  [MODULES.ROLES]: {
    label: "Roles",
    category: "Identity",
    supported: [
      ACTIONS.VIEW,
      ACTIONS.CREATE,
      ACTIONS.EDIT,
      ACTIONS.DELETE,
    ],
  },
  [MODULES.TEAMS]: {
    label: "Teams",
    category: "Organisation",
    supported: ALL_INDIVIDUAL_ACTIONS,
  },
  [MODULES.ORG_SETTINGS]: {
    label: "Org Settings",
    category: "Organisation",
    supported: [ACTIONS.VIEW, ACTIONS.EDIT],
  },
  [MODULES.BILLING]: {
    label: "Billing",
    category: "Organisation",
    supported: [ACTIONS.VIEW, ACTIONS.EDIT, ACTIONS.EXPORT],
  },
  [MODULES.POLICIES]: {
    label: "Policies",
    category: "Security",
    supported: [ACTIONS.VIEW, ACTIONS.EDIT, ACTIONS.EXPORT],
  },
  [MODULES.PROVIDERS]: {
    label: "Providers (BYOK)",
    category: "Vault",
    supported: [
      ACTIONS.VIEW,
      ACTIONS.CREATE,
      ACTIONS.EDIT,
      ACTIONS.DELETE,
    ],
  },
  [MODULES.AUDIT_LOGS]: {
    label: "Audit Logs",
    category: "Audit",
    supported: [ACTIONS.VIEW, ACTIONS.EXPORT],
  },
  [MODULES.APPROVALS]: {
    label: "Approvals",
    category: "Security",
    supported: [ACTIONS.VIEW, ACTIONS.EDIT],
  },
  [MODULES.FILE_RESTRICTIONS]: {
    label: "File Restrictions",
    category: "Security",
    supported: [ACTIONS.VIEW, ACTIONS.EDIT],
  },
  [MODULES.CHAT]: {
    label: "Chat",
    category: "Developer",
    supported: [ACTIONS.VIEW, ACTIONS.CREATE],
  },
  [MODULES.AGENTS]: {
    label: "Agents",
    category: "Developer",
    supported: [ACTIONS.VIEW, ACTIONS.CREATE],
  },
  [MODULES.MCP_TOOLS]: {
    label: "MCP Tools",
    category: "Developer",
    supported: [ACTIONS.VIEW, ACTIONS.CREATE, ACTIONS.DELETE],
  },
};

/**
 * Pre-built lookup so callers can write
 *   PERMISSION_KEYS.USERS.CREATE    // 'users:create'
 * instead of interpolating strings manually.
 */
type PermissionKeysShape = {
  [K in Module]: { [A in Action]: `${Module}:${Action}` };
};
function buildPermissionKeys(): PermissionKeysShape {
  const out = {} as PermissionKeysShape;
  for (const moduleKey of Object.values(MODULES)) {
    const inner = {} as { [A in Action]: `${Module}:${Action}` };
    for (const actionKey of Object.values(ACTIONS)) {
      inner[actionKey] = `${moduleKey}:${actionKey}` as `${Module}:${Action}`;
    }
    out[moduleKey] = inner;
  }
  return out;
}
export const PERMISSION_KEYS: PermissionKeysShape = buildPermissionKeys();

/** Build a `${module}:${action}` string from constants. */
export function makePermissionKey(m: Module, a: Action): string {
  return `${m}:${a}`;
}

/** Parse a permission atom like `users:view` → `{ module, action }`. */
export function parsePermissionKey(
  key: string,
): { module: string; action: string } | null {
  const idx = key.indexOf(":");
  if (idx <= 0) return null;
  return { module: key.slice(0, idx), action: key.slice(idx + 1) };
}
