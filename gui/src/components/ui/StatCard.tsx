/**
 * Reusable stat card used across Security, Team, and Org pages.
 */

interface StatCardProps {
  label: string;
  value: string | number;
  trend?: "up" | "down" | "neutral";
  color?: "default" | "success" | "warning" | "error" | "info";
}

const COLOR_MAP = {
  default: "text-foreground",
  success: "text-success",
  warning: "text-warning",
  error: "text-error",
  info: "text-info",
};

export default function StatCard({ label, value, color = "default" }: StatCardProps) {
  return (
    <div className="rounded-lg border border-border bg-editor px-3 py-2.5">
      <div className="text-2xs text-description truncate">{label}</div>
      <div className={`text-lg font-semibold mt-0.5 ${COLOR_MAP[color]}`}>
        {value}
      </div>
    </div>
  );
}
