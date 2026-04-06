import { useEffect, useState } from "react";
import { Outlet, Navigate } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { MobileNav } from "./MobileNav";
import { ToastContainer } from "../ui/Toast";
import { useAppSelector, useAppDispatch } from "../../store/hooks";
import { setCredentials, logout } from "../../store/slices/authSlice";
import { getToken } from "../../utils/storage";
import { apiClient } from "../../api/client";
import { ROUTES } from "../../utils/routes";
import { LoadingSpinner } from "../ui/LoadingSpinner";
import type { User } from "../../api/types";

export function AppShell() {
  const dispatch = useAppDispatch();
  const isAuthenticated = useAppSelector((s) => s.auth.isAuthenticated);
  const [checking, setChecking] = useState(!isAuthenticated);

  useEffect(() => {
    if (isAuthenticated) return;

    const token = getToken();
    if (!token) {
      setChecking(false);
      return;
    }

    apiClient
      .get<{ user: User }>("/api/auth/me")
      .then((res) => {
        dispatch(setCredentials({ user: res.user, token }));
      })
      .catch(() => {
        dispatch(logout());
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
    return <Navigate to={ROUTES.LOGIN} replace />;
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
