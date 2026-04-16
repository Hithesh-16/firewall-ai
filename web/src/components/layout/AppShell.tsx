import { useEffect, useState } from "react";
import { Outlet, Navigate, useLocation } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { MobileNav } from "./MobileNav";
import { ToastContainer } from "../ui/Toast";
import { useAppSelector, useAppDispatch } from "../../store/hooks";
import { setCredentials, logout } from "../../store/slices/authSlice";
import { clearPermissions, fetchUserPermissions } from "../../store/slices/permissionsSlice";
import { getToken } from "../../utils/storage";
import { apiClient } from "../../api/client";
import { ENDPOINTS } from "../../api/endpoints";
import { ROUTES } from "../../utils/routes";
import { LoadingSpinner } from "../ui/LoadingSpinner";
import type { User } from "../../api/types";

export function AppShell() {
  const dispatch = useAppDispatch();
  const location = useLocation();
  const isAuthenticated = useAppSelector((s) => s.auth.isAuthenticated);
  const user = useAppSelector((s) => s.auth.user);
  const [checking, setChecking] = useState(!isAuthenticated);

  useEffect(() => {
    if (isAuthenticated) return;

    const token = getToken();
    if (!token) {
      setChecking(false);
      return;
    }

    apiClient
      .get<{ user: User }>(ENDPOINTS.auth.me)
      .then((res) => {
        dispatch(setCredentials({ user: res.user, token }));
        // Page refresh: rehydrate the permission cache too so
        // ProtectedRoute doesn't redirect authorised users to /403.
        dispatch(fetchUserPermissions());
      })
      .catch(() => {
        dispatch(logout());
        dispatch(clearPermissions());
      })
      .finally(() => {
        setChecking(false);
      });
  }, [isAuthenticated, dispatch]);

  if (checking) {
    return (
      <div className="bg-background flex h-screen items-center justify-center">
        <LoadingSpinner />
      </div>
    );
  }

  if (!isAuthenticated) {
    // Send unauthenticated visitors to the login page; they can click
    // "Back to home" from there to reach the public landing page.
    return <Navigate to={ROUTES.LOGIN} replace />;
  }

  // First-time users land here with onboardingComplete === false. Force
  // them through the wizard before they can reach any other authed route.
  // The /onboarding routes are themselves NOT inside this AppShell so the
  // redirect doesn't loop.
  const needsOnboarding = user?.onboardingComplete === false;
  const onOnboardingRoute = location.pathname.startsWith(ROUTES.ONBOARDING);
  if (needsOnboarding && !onOnboardingRoute) {
    return <Navigate to={ROUTES.ONBOARDING} replace />;
  }

  return (
    <div className="bg-background text-foreground flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar />
        <main className="flex-1 overflow-auto">
          <Outlet />
        </main>
        <MobileNav />
      </div>
      <ToastContainer />
    </div>
  );
}
