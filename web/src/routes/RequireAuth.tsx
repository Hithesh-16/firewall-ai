import { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { ROUTES } from "../utils/routes";
import { getToken } from "../utils/storage";

interface RequireAuthProps {
  children: ReactNode;
}

/**
 * Guard for private route trees. If no auth token is present in
 * localStorage, redirects to `/login` and preserves the attempted
 * destination in a `?next=` query param so post-login can route back.
 *
 * We check the token (localStorage), not the Redux `isAuthenticated`
 * flag: Redux is hydrated asynchronously by `AppInitializer`, and
 * during the first render it's still `false` even for a logged-in
 * user. localStorage is synchronous, so this gate never flickers.
 */
export function RequireAuth({ children }: RequireAuthProps) {
  const location = useLocation();
  const token = getToken();

  if (!token) {
    const next = encodeURIComponent(`${location.pathname}${location.search}${location.hash}`);
    return <Navigate to={`${ROUTES.LOGIN}?next=${next}`} replace />;
  }

  return <>{children}</>;
}
