/**
 * Color-coded role badge used across Team, Org, and RBAC pages.
 */

interface RoleBadgeProps {
  role: string;
  size?: "sm" | "md";
}

const ROLE_STYLES: Record<string, string> = {
  admin: "bg-foreground/10 text-foreground",
  security_lead: "bg-info/15 text-info",
  developer: "bg-success/15 text-success",
  auditor: "bg-warning/15 text-warning",
};

export default function RoleBadge({ role, size = "sm" }: RoleBadgeProps) {
  const style = ROLE_STYLES[role] ?? "bg-description/15 text-description";
  const sizeClass = size === "sm" ? "text-2xs px-1.5 py-0.5" : "text-xs px-2 py-0.5";

  return (
    <span className={`inline-flex items-center rounded-full font-medium ${style} ${sizeClass}`}>
      {role.replace(/_/g, " ")}
    </span>
  );
}
