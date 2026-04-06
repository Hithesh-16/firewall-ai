import { Fragment, useCallback } from "react";
import { Transition } from "@headlessui/react";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  Cog6ToothIcon,
} from "@heroicons/react/24/outline";
import { Link } from "react-router-dom";
import { cn } from "../../utils/cn";
import { useAppSelector, useAppDispatch } from "../../store/hooks";
import {
  setSidebarOpen,
  setSidebarCollapsed,
} from "../../store/slices/uiSlice";
import { ROUTES } from "../../utils/routes";
import { Avatar } from "../ui/Avatar";
import { SidebarNav } from "./SidebarNav";
import { SidebarOrgSwitcher } from "./SidebarOrgSwitcher";
import { SidebarConversations } from "./SidebarConversations";

export function Sidebar() {
  const dispatch = useAppDispatch();
  const open = useAppSelector((s) => s.ui.sidebarOpen);
  const collapsed = useAppSelector((s) => s.ui.sidebarCollapsed);
  const user = useAppSelector((s) => s.auth.user);

  const closeMobile = useCallback(() => {
    dispatch(setSidebarOpen(false));
  }, [dispatch]);

  const toggleCollapse = useCallback(() => {
    dispatch(setSidebarCollapsed(!collapsed));
  }, [dispatch, collapsed]);

  const sidebarWidth = collapsed ? "w-16" : "w-[260px]";

  const sidebarContent = (
    <div className="bg-editor border-border flex h-full flex-col border-r">
      {/* Org switcher */}
      <SidebarOrgSwitcher collapsed={collapsed} />

      {/* Divider */}
      <div className="border-border mx-3 border-b" />

      {/* Navigation */}
      <div className="thin-scrollbar overflow-y-auto py-3">
        <SidebarNav collapsed={collapsed} />
      </div>

      {/* Conversations */}
      {!collapsed && (
        <>
          <div className="border-border mx-3 border-b" />
          <div className="thin-scrollbar flex-1 overflow-y-auto py-2">
            <SidebarConversations />
          </div>
        </>
      )}

      {/* Divider */}
      <div className="border-border mx-3 border-b" />

      {/* Bottom: user + settings + collapse toggle */}
      <div className="flex items-center gap-2 px-3 py-3">
        {!collapsed && user && (
          <>
            <Avatar name={user.name} size="sm" />
            <span className="text-foreground flex-1 truncate text-sm">
              {user.name}
            </span>
          </>
        )}
        {collapsed && user && <Avatar name={user.name} size="sm" />}
        {!collapsed && (
          <Link
            to={ROUTES.SETTINGS}
            className="text-description hover:bg-list-hover hover:text-foreground rounded p-1"
            aria-label="Settings"
          >
            <Cog6ToothIcon className="h-4 w-4" />
          </Link>
        )}
        <button
          onClick={toggleCollapse}
          className="text-description hover:bg-list-hover hover:text-foreground hidden rounded p-1 md:block"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? (
            <ChevronRightIcon className="h-4 w-4" />
          ) : (
            <ChevronLeftIcon className="h-4 w-4" />
          )}
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className={cn(
          "hidden shrink-0 transition-all duration-200 md:block",
          sidebarWidth,
        )}
      >
        {sidebarContent}
      </aside>

      {/* Mobile overlay */}
      <Transition show={open} as={Fragment}>
        <div className="fixed inset-0 z-40 md:hidden">
          <Transition.Child
            as={Fragment}
            enter="ease-out duration-200"
            enterFrom="opacity-0"
            enterTo="opacity-100"
            leave="ease-in duration-150"
            leaveFrom="opacity-100"
            leaveTo="opacity-0"
          >
            <div
              className="bg-background/60 fixed inset-0"
              onClick={closeMobile}
              aria-hidden="true"
            />
          </Transition.Child>

          <Transition.Child
            as={Fragment}
            enter="ease-out duration-200"
            enterFrom="-translate-x-full"
            enterTo="translate-x-0"
            leave="ease-in duration-150"
            leaveFrom="translate-x-0"
            leaveTo="-translate-x-full"
          >
            <div className="fixed inset-y-0 left-0 w-[260px]">
              {sidebarContent}
            </div>
          </Transition.Child>
        </div>
      </Transition>
    </>
  );
}
