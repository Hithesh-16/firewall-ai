/**
 * Web Navigation Sidebar
 *
 * Persistent sidebar for the standalone web dashboard.
 * Only rendered when the GUI is NOT running inside an IDE webview.
 * In IDE mode, the IDE provides its own navigation (sidebar, command palette).
 */

import { useLocation, useNavigate } from "react-router-dom";
import { ROUTES } from "../util/navigation";
import { isStandaloneWeb } from "../util";

interface NavItem {
  path: string;
  label: string;
  icon: React.ReactNode;
  section: "main" | "admin";
}

const NAV_ITEMS: NavItem[] = [
  // Main section
  {
    path: ROUTES.HOME,
    label: "Chat",
    section: "main",
    icon: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <path
          d="M2 3h12v8H4l-2 2V3z"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    path: "/history",
    label: "History",
    section: "main",
    icon: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <circle cx="8" cy="8" r="6" />
        <path d="M8 5v3l2 2" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    path: ROUTES.CONFIG,
    label: "Settings",
    section: "main",
    icon: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <path d="M6.5 2h3l.5 2 1.5.5L13 3l2 2-1.5 1.5.5 1.5 2 .5v3l-2 .5-.5 1.5L15 13l-2 2-1.5-1.5-1.5.5-.5 2h-3l-.5-2-1.5-.5L3 15l-2-2 1.5-1.5L2 10l-2-.5v-3l2-.5.5-1.5L1 3l2-2 1.5 1.5L6 2l.5-2z" />
        <circle cx="8" cy="8" r="2" />
      </svg>
    ),
  },
  // Admin section (web-only)
  {
    path: ROUTES.SECURITY,
    label: "Security",
    section: "admin",
    icon: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <path
          d="M8 1L2 4v4c0 3.5 2.5 6.5 6 7.5 3.5-1 6-4 6-7.5V4L8 1z"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    path: "/rbac",
    label: "Roles",
    section: "admin",
    icon: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <circle cx="6" cy="5" r="2.5" />
        <path d="M1 14c0-2.8 2.2-5 5-5s5 2.2 5 5" strokeLinecap="round" />
        <path d="M12 7l2 2 2-2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    path: ROUTES.ORG,
    label: "Organization",
    section: "admin",
    icon: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <rect x="2" y="7" width="4" height="7" rx="1" />
        <rect x="6" y="2" width="4" height="12" rx="1" />
        <rect x="10" y="5" width="4" height="9" rx="1" />
      </svg>
    ),
  },
  {
    path: ROUTES.TEAM,
    label: "Teams",
    section: "admin",
    icon: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <circle cx="5" cy="5" r="2" />
        <circle cx="11" cy="5" r="2" />
        <path
          d="M1 13c0-2.2 1.8-4 4-4s4 1.8 4 4M7 13c0-2.2 1.8-4 4-4s4 1.8 4 4"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
  {
    path: ROUTES.AGENTS,
    label: "Agents",
    section: "admin",
    icon: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <rect x="3" y="3" width="10" height="10" rx="2" />
        <circle cx="6.5" cy="7" r="1" fill="currentColor" />
        <circle cx="9.5" cy="7" r="1" fill="currentColor" />
        <path d="M6 10c0 1.1.9 2 2 2s2-.9 2-2" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    path: ROUTES.TASKS,
    label: "Tasks",
    section: "admin",
    icon: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <rect x="2" y="2" width="12" height="12" rx="2" />
        <path d="M5 8l2 2 4-4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    path: ROUTES.MEMORY,
    label: "Memory",
    section: "admin",
    icon: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <path d="M3 2h10a1 1 0 011 1v10a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1z" />
        <path d="M5 6h6M5 9h4" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    path: ROUTES.PLUGINS,
    label: "Plugins",
    section: "admin",
    icon: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <path
          d="M6 2v3H4a1 1 0 00-1 1v2h2v6h6V8h2V6a1 1 0 00-1-1h-2V2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    path: ROUTES.SKILLS,
    label: "Skills",
    section: "admin",
    icon: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <path
          d="M8 1l2 5h5l-4 3.5 1.5 5L8 11.5 3.5 14.5 5 9.5 1 6h5l2-5z"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    path: ROUTES.PRIVACY,
    label: "Privacy",
    section: "admin",
    icon: (
      <svg
        width="16"
        height="16"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <circle cx="8" cy="7" r="3" />
        <path d="M2 14c0-3.3 2.7-6 6-6s6 2.7 6 6" strokeLinecap="round" />
        <path d="M12 4l1-1M13 7h1.5" strokeLinecap="round" />
      </svg>
    ),
  },
];

export default function WebNavSidebar() {
  const location = useLocation();
  const navigate = useNavigate();

  // Only render in standalone web mode
  if (!isStandaloneWeb()) return null;

  const mainItems = NAV_ITEMS.filter((item) => item.section === "main");
  const adminItems = NAV_ITEMS.filter((item) => item.section === "admin");

  const isActive = (path: string) => {
    if (path === ROUTES.HOME)
      return location.pathname === "/" || location.pathname === "/index.html";
    return location.pathname === path;
  };

  return (
    <nav className="border-border bg-secondary-background flex min-h-0 w-48 shrink-0 flex-col overflow-y-auto border-r">
      {/* Logo / Brand */}
      <div className="border-border border-b px-3 py-3">
        <span className="text-description text-xs font-semibold uppercase tracking-wider">
          AI Firewall
        </span>
      </div>

      {/* Main navigation */}
      <div className="py-1.5">
        {mainItems.map((item) => (
          <SidebarItem
            key={item.path}
            item={item}
            active={isActive(item.path)}
            onClick={() => navigate(item.path)}
          />
        ))}
      </div>

      {/* Admin section */}
      <div className="border-border border-t py-1.5">
        <div className="px-3 py-1.5">
          <span className="text-2xs text-description-muted uppercase tracking-wider">
            Administration
          </span>
        </div>
        {adminItems.map((item) => (
          <SidebarItem
            key={item.path}
            item={item}
            active={isActive(item.path)}
            onClick={() => navigate(item.path)}
          />
        ))}
      </div>
    </nav>
  );
}

function SidebarItem({
  item,
  active,
  onClick,
}: {
  item: NavItem;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-xs transition-colors ${
        active
          ? "bg-list-active text-list-active-foreground"
          : "text-description hover:text-foreground hover:bg-list-hover"
      }`}
    >
      <span className="shrink-0 opacity-70">{item.icon}</span>
      {item.label}
    </button>
  );
}
