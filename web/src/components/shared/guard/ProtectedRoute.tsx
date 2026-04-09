import { ReactNode } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { useAppSelector } from "../../../store/hooks";
import { selectPermissionsFetched } from "../../../store/selectors/permissions.selectors";
import { usePermission } from "../../../hooks/usePermission";
import { LoadingSpinner } from "../../ui/LoadingSpinner";
import type { Action, Module } from "../../../constants/permissions.constants";

export interface ProtectedRouteProps {
  module: Module;
  action: Action;
  /** Where to send the user if they lack permission. Default: `/403`. */
  redirectTo?: string;
  /** Optional custom loading indicator. */
  loadingFallback?: ReactNode;
  /** When used as a wrapper element, pass children instead of using Outlet. */
  children?: ReactNode;
}

/**
 * React Router route-level permission guard.
 *
 * Usage (as an element wrapper in a route definition):
 *   {
 *     path: "/users",
 *     element: (
 *       <ProtectedRoute module={MODULES.USERS} action={ACTIONS.VIEW}>
 *         <UsersPage />
 *       </ProtectedRoute>
 *     ),
 *   }
 *
 * Or as a layout route with child routes:
 *   {
 *     element: <ProtectedRoute module={MODULES.USERS} action={ACTIONS.VIEW} />,
 *     children: [{ path: "users", element: <UsersPage /> }],
 *   }
 *
 * Behaviour:
 *   1. Wait for `permissions.isFetched` before deciding — renders a
 *      spinner during the initial load.
 *   2. Allowed → render children / outlet.
 *   3. Not allowed → <Navigate to={redirectTo}> (default `/403`).
 *
 * Never renders a blank page; always either content, spinner, or a
 * redirect.
 */
export function ProtectedRoute({
  module,
  action,
  redirectTo = "/403",
  loadingFallback,
  children,
}: ProtectedRouteProps) {
  const fetched = useAppSelector(selectPermissionsFetched);
  const allowed = usePermission(module, action);

  if (!fetched) {
    return (
      <>
        {loadingFallback ?? (
          <div className="bg-background flex h-screen items-center justify-center">
            <LoadingSpinner />
          </div>
        )}
      </>
    );
  }

  if (!allowed) {
    return <Navigate to={redirectTo} replace />;
  }

  if (children !== undefined) return <>{children}</>;
  return <Outlet />;
}

export default ProtectedRoute;
