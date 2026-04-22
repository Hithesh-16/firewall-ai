import React, { useMemo } from "react";
import { NavLink } from "react-router-dom";
import {
  ChatBubbleLeftRightIcon,
  ShieldCheckIcon,
  ChartBarIcon,
  BuildingOfficeIcon,
  KeyIcon,
  UsersIcon,
  CpuChipIcon,
  ClipboardDocumentListIcon,
  CircleStackIcon,
  BoltIcon,
  CommandLineIcon,
  PuzzlePieceIcon,
  DocumentTextIcon,
  EyeSlashIcon,
  BellIcon,
  ClockIcon,
  CodeBracketSquareIcon,
  CubeIcon,
  AcademicCapIcon,
} from "@heroicons/react/24/outline";
import { cn } from "../../utils/cn";
import { ROUTES } from "../../utils/routes";
import { useAppSelector } from "../../store/hooks";

interface NavItem {
  label: string;
  to: string;
  icon: React.ForwardRefExoticComponent<
    React.SVGProps<SVGSVGElement> & { title?: string; titleId?: string }
  >;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

const sections: NavSection[] = [
  {
    title: "Main",
    items: [
      { label: "Chat", to: ROUTES.CHAT, icon: ChatBubbleLeftRightIcon },
      { label: "Security", to: ROUTES.SECURITY, icon: ShieldCheckIcon },
      { label: "Usage", to: ROUTES.USAGE, icon: ChartBarIcon },
    ],
  },
  {
    title: "Management",
    items: [
      { label: "Organization", to: ROUTES.ORG, icon: BuildingOfficeIcon },
      { label: "Roles", to: ROUTES.RBAC, icon: KeyIcon },
      { label: "Teams", to: ROUTES.TEAM, icon: UsersIcon },
    ],
  },
  {
    title: "Tools",
    items: [
      { label: "Agents", to: ROUTES.AGENTS, icon: CpuChipIcon },
      { label: "Tasks", to: ROUTES.TASKS, icon: ClipboardDocumentListIcon },
      { label: "Memory", to: ROUTES.MEMORY, icon: CircleStackIcon },
      { label: "Skills", to: ROUTES.SKILLS, icon: BoltIcon },
      { label: "Commands", to: ROUTES.COMMANDS, icon: CommandLineIcon },
      { label: "Plugins", to: ROUTES.PLUGINS, icon: PuzzlePieceIcon },
    ],
  },
  {
    title: "System",
    items: [
      {
        label: "Models",
        to: "/settings/models",
        icon: CubeIcon,
      },
      {
        label: "Rules",
        to: "/settings/rules",
        icon: DocumentTextIcon,
      },
      {
        label: "Skills",
        to: "/settings/skills",
        icon: BoltIcon,
      },
      {
        label: "Assistant",
        to: "/settings/assistant",
        icon: CodeBracketSquareIcon,
      },
      { label: "Policy", to: ROUTES.POLICY, icon: DocumentTextIcon },
      { label: "Privacy", to: ROUTES.PRIVACY, icon: EyeSlashIcon },
      { label: "Notifications", to: ROUTES.NOTIFICATIONS, icon: BellIcon },
      { label: "Scheduled", to: ROUTES.CRON, icon: ClockIcon },
    ],
  },
];

interface SidebarNavProps {
  collapsed: boolean;
}

export function SidebarNav({ collapsed }: SidebarNavProps) {
  // Admin-only "Model Access" entry surfaces when the user can edit
  // policies (the same capability gating the proxy's admin model
  // endpoints). Non-admins never see the link — they discover
  // admin-assigned models on /settings/models instead.
  const canEditPolicies = useAppSelector((s) =>
    s.permissions.permissions.includes("policies.edit"),
  );

  const resolvedSections = useMemo(() => {
    if (!canEditPolicies) return sections;
    return sections.map((section) => {
      if (section.title !== "Management") return section;
      const items = [...section.items];
      // Insert "Model Access" right after "Organization" so admins
      // land on a group of related org-scoped admin surfaces.
      const orgIdx = items.findIndex((i) => i.to === ROUTES.ORG);
      const insertAt = orgIdx >= 0 ? orgIdx + 1 : items.length;
      items.splice(insertAt, 0, {
        label: "Model Access",
        to: `${ROUTES.ORG}?tab=user-models`,
        icon: AcademicCapIcon,
      });
      return { ...section, items };
    });
  }, [canEditPolicies]);

  return (
    <nav className="flex flex-col gap-4 px-2">
      {resolvedSections.map((section) => (
        <div key={section.title}>
          {!collapsed && (
            <p className="text-description-muted mb-1 px-2 text-[10px] font-semibold uppercase tracking-widest">
              {section.title}
            </p>
          )}
          <ul className="flex flex-col gap-0.5">
            {section.items.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.to === "/"}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors",
                      isActive
                        ? "bg-list-active text-list-active-foreground"
                        : "text-description hover:bg-list-hover hover:text-foreground",
                      collapsed && "justify-center",
                    )
                  }
                  title={collapsed ? item.label : undefined}
                >
                  <item.icon className="h-4 w-4 shrink-0" />
                  {!collapsed && <span>{item.label}</span>}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
