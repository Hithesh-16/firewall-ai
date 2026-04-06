import React from "react";
import { NavLink } from "react-router-dom";
import {
  ChatBubbleLeftRightIcon,
  ShieldCheckIcon,
  CpuChipIcon,
  ClipboardDocumentListIcon,
  Cog6ToothIcon,
} from "@heroicons/react/24/outline";
import { cn } from "../../utils/cn";
import { ROUTES } from "../../utils/routes";

interface MobileNavItem {
  label: string;
  to: string;
  icon: React.ForwardRefExoticComponent<
    React.SVGProps<SVGSVGElement> & { title?: string; titleId?: string }
  >;
}

const items: MobileNavItem[] = [
  { label: "Chat", to: ROUTES.CHAT, icon: ChatBubbleLeftRightIcon },
  { label: "Security", to: ROUTES.SECURITY, icon: ShieldCheckIcon },
  { label: "Agents", to: ROUTES.AGENTS, icon: CpuChipIcon },
  { label: "Tasks", to: ROUTES.TASKS, icon: ClipboardDocumentListIcon },
  { label: "Settings", to: ROUTES.SETTINGS, icon: Cog6ToothIcon },
];

export function MobileNav() {
  return (
    <nav className="border-border bg-editor flex h-14 shrink-0 items-center justify-around border-t md:hidden">
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === "/"}
          className={({ isActive }) =>
            cn(
              "flex flex-col items-center gap-0.5 px-3 py-1 text-[10px]",
              isActive
                ? "text-primary"
                : "text-description hover:text-foreground",
            )
          }
        >
          <item.icon className="h-5 w-5" />
          <span>{item.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
