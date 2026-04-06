import React from "react";
import { cn } from "../../utils/cn";

interface CardProps {
  className?: string;
  padding?: boolean;
  children: React.ReactNode;
}

export function Card({ className, padding = true, children }: CardProps) {
  return (
    <div
      className={cn(
        "border-border bg-editor rounded-lg border",
        padding && "p-4",
        className,
      )}
    >
      {children}
    </div>
  );
}
