import { ReactNode } from "react";
import { PermissionGate } from "./PermissionGate";
import type { Action, Module } from "../../../constants/permissions.constants";

export interface CanProps {
  /** The action being attempted — e.g. ACTIONS.CREATE */
  do: Action;
  /** The module being acted upon — e.g. MODULES.USERS */
  on: Module;
  fallback?: ReactNode;
  children: ReactNode;
}

/**
 * Shorthand wrapper around {@link PermissionGate} that reads like
 * English at the call site:
 *
 *   <Can do={ACTIONS.EXPORT} on={MODULES.REPORTS}>
 *     <ExportButton />
 *   </Can>
 *
 * Prefer this in presentation-heavy components where the `do`/`on`
 * naming is clearer. In service-y code, use PermissionGate directly.
 */
export function Can({
  do: action,
  on: module,
  fallback,
  children,
}: CanProps) {
  return (
    <PermissionGate module={module} action={action} fallback={fallback}>
      {children}
    </PermissionGate>
  );
}

export default Can;
