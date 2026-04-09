import { Fragment } from "react";
import { useLocation, Link, useNavigate } from "react-router-dom";
import { Menu, Transition } from "@headlessui/react";
import {
  SunIcon,
  MoonIcon,
  BellIcon,
  Bars3Icon,
} from "@heroicons/react/24/outline";
import { cn } from "../../utils/cn";
import { useTheme } from "../../theme/useTheme";
import { useAppSelector, useAppDispatch } from "../../store/hooks";
import { setSidebarOpen } from "../../store/slices/uiSlice";
import { logout } from "../../store/slices/authSlice";
import { clearPermissions } from "../../store/slices/permissionsSlice";
import { apiClient } from "../../api/client";
import { clearToken } from "../../utils/storage";
import { ROUTES } from "../../utils/routes";
import { Breadcrumb } from "../ui/Breadcrumb";
import { Avatar } from "../ui/Avatar";

const routeLabels: Record<string, string> = {
  "/": "Chat",
  "/security": "Security",
  "/security/audit": "Security Audit",
  "/policy": "Policy",
  "/rbac": "Roles & Permissions",
  "/org": "Organization",
  "/team": "Teams",
  "/agents": "Agents",
  "/tasks": "Tasks",
  "/memory": "Memory",
  "/skills": "Skills",
  "/commands": "Commands",
  "/plugins": "Plugins",
  "/privacy": "Privacy",
  "/notifications": "Notifications",
  "/cron": "Scheduled Jobs",
  "/usage": "Usage & Billing",
  "/settings": "Settings",
};

function buildBreadcrumbs(pathname: string) {
  const items = [{ label: "Home", href: "/" }];
  if (pathname === "/") return items;

  const segments = pathname.split("/").filter(Boolean);
  let path = "";
  for (const segment of segments) {
    path += `/${segment}`;
    const label =
      routeLabels[path] ?? segment.charAt(0).toUpperCase() + segment.slice(1);
    items.push({ label, href: path });
  }
  return items;
}

export function TopBar() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { theme, setTheme } = useTheme();
  const location = useLocation();
  const user = useAppSelector((s) => s.auth.user);

  const breadcrumbs = buildBreadcrumbs(location.pathname);

  function handleThemeToggle() {
    setTheme(theme === "dark" ? "light" : "dark");
  }

  return (
    <header className="border-border bg-editor flex h-12 shrink-0 items-center gap-3 border-b px-4">
      {/* Mobile menu button */}
      <button
        onClick={() => dispatch(setSidebarOpen(true))}
        className="text-description hover:text-foreground rounded p-1 md:hidden"
        aria-label="Open sidebar"
      >
        <Bars3Icon className="h-5 w-5" />
      </button>

      {/* Breadcrumb */}
      <div className="flex-1">
        <Breadcrumb items={breadcrumbs} />
      </div>

      {/* Right side controls */}
      <div className="flex items-center gap-1">
        {/* Theme toggle */}
        <button
          onClick={handleThemeToggle}
          className="text-description hover:bg-list-hover hover:text-foreground rounded p-1.5"
          aria-label="Toggle theme"
        >
          {theme === "dark" ? (
            <SunIcon className="h-4 w-4" />
          ) : (
            <MoonIcon className="h-4 w-4" />
          )}
        </button>

        {/* Notification bell */}
        <Link
          to={ROUTES.NOTIFICATIONS}
          className="text-description hover:bg-list-hover hover:text-foreground rounded p-1.5"
          aria-label="Notifications"
        >
          <BellIcon className="h-4 w-4" />
        </Link>

        {/* User menu */}
        <Menu as="div" className="relative">
          <Menu.Button className="focus:ring-primary/50 rounded-full focus:outline-none focus:ring-2">
            <Avatar name={user?.name ?? "User"} size="sm" />
          </Menu.Button>
          <Transition
            as={Fragment}
            enter="ease-out duration-150"
            enterFrom="opacity-0 scale-95"
            enterTo="opacity-100 scale-100"
            leave="ease-in duration-100"
            leaveFrom="opacity-100 scale-100"
            leaveTo="opacity-0 scale-95"
          >
            <Menu.Items className="border-border bg-editor absolute right-0 z-30 mt-2 w-48 rounded-md border py-1 shadow-lg">
              <Menu.Item>
                {({ active }) => (
                  <Link
                    to={ROUTES.SETTINGS}
                    className={cn(
                      "block px-4 py-2 text-sm",
                      active
                        ? "bg-list-hover text-foreground"
                        : "text-description",
                    )}
                  >
                    Profile & Settings
                  </Link>
                )}
              </Menu.Item>
              <Menu.Item>
                {({ active }) => (
                  <button
                    onClick={async () => {
                      // Three-step sign-out:
                      //   1. Revoke the proxy token (so the server stops
                      //      accepting it).
                      //   2. Delete the local shared auth file (so the
                      //      CLI / VS Code / JetBrains lose it too — only
                      //      effective when proxy is local).
                      //   3. Local cleanup: clear localStorage + Redux.
                      try {
                        await apiClient.post("/api/auth/logout");
                      } catch {
                        /* token may already be invalid — ignore */
                      }
                      try {
                        await apiClient.del("/api/auth/handoff");
                      } catch {
                        /* remote proxy returns 403 — ignore */
                      }
                      clearToken();
                      dispatch(logout());
                      dispatch(clearPermissions());
                      navigate(ROUTES.LOGIN);
                    }}
                    className={cn(
                      "block w-full px-4 py-2 text-left text-sm",
                      active ? "bg-list-hover text-error" : "text-description",
                    )}
                  >
                    Sign out
                  </button>
                )}
              </Menu.Item>
            </Menu.Items>
          </Transition>
        </Menu>
      </div>
    </header>
  );
}
