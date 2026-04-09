/**
 * Pure helpers for the RBAC permission matrix UI.
 *
 * Encodes the dependency rules from the spec:
 *   - create / edit / delete / export require view
 *   - full_access = view + create + edit + delete + export
 *   - unchecking view cascades-unchecks create/edit/delete/export
 *   - unchecking any single action when full_access is active removes
 *     full_access
 *
 * The matrix state is a `Map<resource, Set<Action>>` where Action is
 * one of the uniform atoms. `full_access` is a VIRTUAL column the UI
 * renders but never stores server-side — it's derived from the other
 * five and expands back to the 5 when saved.
 */

export const UNIFORM_ACTIONS = [
  "view",
  "create",
  "edit",
  "delete",
  "export",
] as const;

export type UniformAction = (typeof UNIFORM_ACTIONS)[number];

const DEPENDS_ON_VIEW: ReadonlySet<UniformAction> = new Set<UniformAction>([
  "create",
  "edit",
  "delete",
  "export",
]);

export interface PermissionRow {
  /** Machine-readable resource name, e.g. `users` */
  resource: string;
  /** Human label rendered in the row header */
  label: string;
  /** Category/grouping for the matrix sections */
  category: string;
  /** Which actions this resource actually supports (from the backend) */
  supported: UniformAction[];
}

/** `users:view` → `{ resource: 'users', action: 'view' }` */
export function parseAtom(
  atom: string,
): { resource: string; action: string } | null {
  const idx = atom.indexOf(":");
  if (idx <= 0) return null;
  return {
    resource: atom.slice(0, idx),
    action: atom.slice(idx + 1),
  };
}

/** `users`, `view` → `users:view` */
export function makeAtom(resource: string, action: UniformAction): string {
  return `${resource}:${action}`;
}

/**
 * Build a sparse `Map<resource, Set<action>>` from a flat atom list.
 * Ignores legacy atoms that don't use the uniform action set.
 */
export function atomsToMatrix(atoms: string[]): Map<string, Set<UniformAction>> {
  const map = new Map<string, Set<UniformAction>>();
  for (const atom of atoms) {
    const parsed = parseAtom(atom);
    if (!parsed) continue;
    if (!UNIFORM_ACTIONS.includes(parsed.action as UniformAction)) continue;
    const set = map.get(parsed.resource) ?? new Set<UniformAction>();
    set.add(parsed.action as UniformAction);
    map.set(parsed.resource, set);
  }
  return map;
}

/**
 * Flatten `Map<resource, Set<action>>` back into a sorted atom list
 * suitable for sending to `PUT /api/roles/:id`.
 *
 * Legacy atoms from the original caps array are passed through
 * untouched so we don't accidentally strip developer tool grants
 * or other non-uniform capabilities.
 */
export function matrixToAtoms(
  matrix: Map<string, Set<UniformAction>>,
  legacyAtoms: string[] = [],
): string[] {
  const out: string[] = [...legacyAtoms];
  for (const [resource, actions] of matrix) {
    for (const action of UNIFORM_ACTIONS) {
      if (actions.has(action)) out.push(makeAtom(resource, action));
    }
  }
  return Array.from(new Set(out)).sort();
}

/**
 * Compute whether a row is in "full access" mode — i.e. all five
 * uniform actions are currently granted.
 */
export function isFullAccess(actions: Set<UniformAction>): boolean {
  return UNIFORM_ACTIONS.every((a) => actions.has(a));
}

/**
 * Toggle a single cell in the matrix. Returns a NEW Set — the caller
 * is responsible for writing it back to the Map.
 *
 * Implements the full set of dependency rules from the spec:
 *
 *   • full_access checked → grant every action
 *   • full_access unchecked → revoke every action
 *   • any of create/edit/delete/export checked → auto-check view
 *   • view unchecked → auto-uncheck the 4 dependents
 *
 * After the mutation we DON'T store a synthetic `full_access` action —
 * the matrix only has the 5 real atoms. The UI reads `isFullAccess()`
 * to decide whether to show the Full Access column as checked.
 */
export function togglePermission(
  current: Set<UniformAction>,
  action: UniformAction | "full_access",
  checked: boolean,
): Set<UniformAction> {
  const next = new Set<UniformAction>(current);

  if (action === "full_access") {
    if (checked) {
      for (const a of UNIFORM_ACTIONS) next.add(a);
    } else {
      for (const a of UNIFORM_ACTIONS) next.delete(a);
    }
    return next;
  }

  if (checked) {
    next.add(action);
    if (DEPENDS_ON_VIEW.has(action)) next.add("view");
  } else {
    next.delete(action);
    if (action === "view") {
      for (const dep of DEPENDS_ON_VIEW) next.delete(dep);
    }
  }
  return next;
}

/**
 * Human-friendly summary line for one resource.
 *
 * Examples:
 *   full access → "full access to Users"
 *   view only  → "view-only on Users"
 *   view + create → "view and create Users"
 *   view + create + edit → "view, create and edit Users"
 */
function summariseResource(row: PermissionRow, actions: Set<UniformAction>): string {
  if (actions.size === 0) return "";
  if (isFullAccess(actions)) return `full access to ${row.label}`;
  const onlyView = actions.size === 1 && actions.has("view");
  if (onlyView) return `view-only on ${row.label}`;
  const sorted: UniformAction[] = UNIFORM_ACTIONS.filter((a) => actions.has(a));
  if (sorted.length === 1) return `${sorted[0]} on ${row.label}`;
  if (sorted.length === 2) return `${sorted[0]} and ${sorted[1]} ${row.label}`;
  const last = sorted[sorted.length - 1];
  return `${sorted.slice(0, -1).join(", ")} and ${last} ${row.label}`;
}

/**
 * Build the live summary line shown below the matrix. Groups resources
 * that share the same permission pattern for brevity.
 */
export function buildSummary(
  rows: PermissionRow[],
  matrix: Map<string, Set<UniformAction>>,
): string {
  const parts: string[] = [];
  for (const row of rows) {
    const actions = matrix.get(row.resource);
    if (!actions || actions.size === 0) continue;
    parts.push(summariseResource(row, actions));
  }
  if (parts.length === 0) return "No permissions granted yet.";
  return `This role can: ${parts.join(", ")}.`;
}

/**
 * Validate dependency rules client-side BEFORE calling the backend.
 * The backend also enforces these and will return 422 — this is just
 * fast UI feedback so the user doesn't hit a round-trip error.
 */
export function validateMatrix(
  matrix: Map<string, Set<UniformAction>>,
): string[] {
  const problems: string[] = [];
  for (const [resource, actions] of matrix) {
    if (actions.has("view")) continue;
    for (const dep of DEPENDS_ON_VIEW) {
      if (actions.has(dep)) {
        problems.push(`${resource}:${dep} requires ${resource}:view`);
      }
    }
  }
  return problems;
}
