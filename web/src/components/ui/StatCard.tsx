import React from "react";
import { cn } from "../../utils/cn";
import { Card } from "./Card";

const variantStyles: Record<string, { icon: string; value: string }> = {
  error: { icon: "bg-error/10 text-error", value: "text-error" },
  warning: { icon: "bg-warning/10 text-warning", value: "text-warning" },
  success: { icon: "bg-success/10 text-success", value: "text-success" },
  info: { icon: "bg-info/10 text-info", value: "text-info" },
};

interface StatCardProps {
  label: string;
  value: string | number;
  icon?: React.ReactNode;
  trend?: { value: number; label?: string };
  variant?: "error" | "warning" | "success" | "info";
  className?: string;
}

export function StatCard({ label, value, icon, trend, variant, className }: StatCardProps) {
  const vs = variant ? variantStyles[variant] : undefined;

  return (
    <Card className={cn("flex items-start gap-3", className)}>
      {icon && (
        <div
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
            vs?.icon ?? "bg-primary/10 text-primary",
          )}
        >
          {icon}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-description truncate text-xs">{label}</p>
        <p className={cn("mt-1 text-2xl font-semibold", vs?.value ?? "text-foreground")}>{value}</p>
        {trend && (
          <p
            className={cn(
              "mt-1 text-xs font-medium",
              trend.value >= 0 ? "text-success" : "text-error",
            )}
          >
            {trend.value >= 0 ? "\u2191" : "\u2193"} {Math.abs(trend.value)}%
            {trend.label && <span className="text-description-muted ml-1">{trend.label}</span>}
          </p>
        )}
      </div>
    </Card>
  );
}
