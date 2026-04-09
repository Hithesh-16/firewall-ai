import { ReactNode, useEffect } from "react";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import { getToken } from "../../utils/storage";
import { fetchUserPermissions } from "../../store/slices/permissionsSlice";
import {
  selectPermissionsFetched,
  selectPermissionsLoading,
} from "../../store/selectors/permissions.selectors";

/**
 * Fetches the current user's permissions into Redux exactly once per
 * app boot. Wraps the root router so every page can rely on the
 * permission list being present (or at least confirmed-absent for
 * signed-out users).
 *
 * Rules from the spec:
 *   - On mount: if a token exists AND permissions aren't fetched yet,
 *     dispatch fetchUserPermissions().
 *   - Don't block the UI indefinitely — ProtectedRoute waits for
 *     `isFetched`, so unauthenticated public pages (landing, login)
 *     render immediately even while a background fetch is running.
 *   - On logout, `clearPermissions()` resets `isFetched` back to
 *     false, which triggers a re-fetch on the next login.
 */
export function AppInitializer({ children }: { children: ReactNode }) {
  const dispatch = useAppDispatch();
  const isFetched = useAppSelector(selectPermissionsFetched);
  const isLoading = useAppSelector(selectPermissionsLoading);

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    if (isFetched || isLoading) return;
    dispatch(fetchUserPermissions());
  }, [dispatch, isFetched, isLoading]);

  return <>{children}</>;
}

export default AppInitializer;
