import { useMemo } from "react";
import { useAppSelector } from "../store/hooks";
import { selectPermissionSet } from "../store/selectors/permissions.selectors";
import {
  ACTIONS,
  type Action,
  type Module,
  makePermissionKey,
} from "../constants/permissions.constants";

export interface PermissionQuery {
  module: Module;
  action: Action;
}

/**
 * Bulk permission check. Single selector hit, single useMemo pass.
 * Useful when a single component needs 5 independent permission
 * booleans — one `usePermissions` beats five `usePermission` calls.
 *
 * Returns an object keyed by `${module}:${action}`:
 *   const perms = usePermissions([
 *     { module: MODULES.ORDERS, action: ACTIONS.CREATE },
 *     { module: MODULES.ORDERS, action: ACTIONS.DELETE },
 *   ]);
 *   perms['orders:create']  // true | false
 */
export function usePermissions(
  queries: readonly PermissionQuery[],
): Record<string, boolean> {
  const set = useAppSelector(selectPermissionSet);
  return useMemo(() => {
    const out: Record<string, boolean> = {};
    for (const q of queries) {
      const key = makePermissionKey(q.module, q.action);
      const fullKey = makePermissionKey(q.module, ACTIONS.FULL_ACCESS);
      out[key] = set.has(fullKey) || set.has(key);
    }
    return out;
    // Re-run only when the permission set reference or the queries
    // identity changes. Callers should memoise the `queries` array.
  }, [set, queries]);
}
