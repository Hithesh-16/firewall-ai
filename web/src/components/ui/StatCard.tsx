import React from "react";
import { cn } from "../../utils/cn";
import { Card } from "./Card";

interface StatCardProps {
  label: string;
  value: string | number;
  icon?: React.ReactNode;
  trend?: { value: number; label?: string };
  className?: string;
}

export function StatCard({
  label,
  value,
  icon,
  trend,
  className,
}: StatCardProps) {
  return (
    <Card className={cn("flex items-start gap-3", className)}>
      {icon && (
        <div className="bg-primary/10 text-primary flex h-10 w-10 shrink-0 items-center justify-center rounded-lg">
          {icon}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-description truncate text-xs">{label}</p>
        <p className="text-foreground mt-1 text-2xl font-semibold">{value}</p>
        {trend && (
          <p
            className={cn(
              "mt-1 text-xs font-medium",
              trend.value >= 0 ? "text-success" : "text-error",
            )}
          >
            {trend.value >= 0 ? "\u2191" : "\u2193"} {Math.abs(trend.value)}%
            {trend.label && (
              <span className="text-description-muted ml-1">{trend.label}</span>
            )}
          </p>
        )}
      </div>
    </Card>
  );
}
