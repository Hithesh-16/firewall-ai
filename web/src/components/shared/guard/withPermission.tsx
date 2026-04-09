import { ComponentType, ReactNode } from "react";
import { usePermission } from "../../../hooks/usePermission";
import type { Action, Module } from "../../../constants/permissions.constants";

export interface WithPermissionOptions {
  module: Module;
  action: Action;
  /** Rendered when the user lacks the permission. Default: null. */
  fallback?: ReactNode;
}

/**
 * HOC version of {@link PermissionGate} for use in non-hook contexts
 * (class components, conditional-imports, route-level guards that
 * don't want to wrap JSX).
 *
 * Example:
 *   const ProtectedExportBtn = withPermission(ExportButton, {
 *     module: MODULES.AUDIT_LOGS,
 *     action: ACTIONS.EXPORT,
 *   });
 */
export function withPermission<P extends object>(
  Wrapped: ComponentType<P>,
  opts: WithPermissionOptions,
): ComponentType<P> {
  const { module, action, fallback = null } = opts;
  const WithPermission = (props: P) => {
    const allowed = usePermission(module, action);
    if (!allowed) return <>{fallback}</>;
    return <Wrapped {...props} />;
  };
  WithPermission.displayName = `withPermission(${Wrapped.displayName ?? Wrapped.name ?? "Component"})`;
  return WithPermission;
}

export default withPermission;
