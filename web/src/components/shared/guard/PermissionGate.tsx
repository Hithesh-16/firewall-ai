import { ReactNode } from "react";
import { usePermission } from "../../../hooks/usePermission";
import type { Action, Module } from "../../../constants/permissions.constants";

export interface PermissionGateProps {
  module: Module;
  action: Action;
  /** Rendered when the user lacks the permission. Default: null (hidden). */
  fallback?: ReactNode;
  children: ReactNode;
}

/**
 * Conditionally render a subtree based on a single permission.
 *
 * Spec rule: NEVER render a disabled button when the user lacks a
 * permission — hide it completely. This component enforces that by
 * returning `null` (or the optional fallback) when the check fails,
 * so the markup simply doesn't exist in the DOM.
 *
 * Usage:
 *   <PermissionGate module={MODULES.USERS} action={ACTIONS.CREATE}>
 *     <Button>Invite user</Button>
 *   </PermissionGate>
 */
export function PermissionGate({
  module,
  action,
  fallback = null,
  children,
}: PermissionGateProps) {
  const allowed = usePermission(module, action);
  if (!allowed) return <>{fallback}</>;
  return <>{children}</>;
}

export default PermissionGate;
