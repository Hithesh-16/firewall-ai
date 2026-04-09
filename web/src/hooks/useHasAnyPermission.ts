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
 * `useHasAnyPermission(MODULES.ORDERS, [ACTIONS.VIEW, ACTIONS.EXPORT])`
 * → true if the user has ANY of the listed actions (or full_access).
 *
 * Primary use case: deciding whether a sidebar item should render.
 * A "Reports" link should appear if the user can view OR export
 * reports — even if they can't do both.
 */
export function useHasAnyPermission(
  module: Module,
  actions: readonly Action[],
): boolean {
  const set = useAppSelector(selectPermissionSet);
  return useMemo(() => {
    if (set.has(makePermissionKey(module, ACTIONS.FULL_ACCESS))) return true;
    for (const a of actions) {
      if (set.has(makePermissionKey(module, a))) return true;
    }
    return false;
  }, [set, module, actions]);
}
