import { useMemo } from "react";
import { useAppSelector } from "../store/hooks";
import { selectPermissionSet } from "../store/selectors/permissions.selectors";
import {
  ACTIONS,
  type Action,
  type Module,
  makePermissionKey,
} from "../constants/permissions.constants";

/**
 * `usePermission(MODULES.USERS, ACTIONS.CREATE)` → boolean
 *
 * Resolution rules (from the spec):
 *   1. If the user has `${module}:full_access` they pass any action.
 *   2. Otherwise they pass iff the exact `${module}:${action}` atom
 *      is present.
 *
 * `full_access` is treated as a synthetic atom — the server never
 * emits it explicitly today, but if a future policy feature grants
 * it this hook already handles it.
 */
export function usePermission(module: Module, action: Action): boolean {
  const set = useAppSelector(selectPermissionSet);
  return useMemo(() => {
    if (set.has(makePermissionKey(module, ACTIONS.FULL_ACCESS))) return true;
    return set.has(makePermissionKey(module, action));
  }, [set, module, action]);
}
