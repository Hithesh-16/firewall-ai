import React from "react";
import { cn } from "../../utils/cn";

type ButtonVariant =
  | "primary"
  | "secondary"
  | "outline"
  | "ghost"
  | "danger"
  | "icon";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-primary text-primary-foreground hover:bg-primary-hover focus:ring-2 focus:ring-primary/50",
  secondary:
    "bg-secondary text-secondary-foreground hover:bg-secondary-hover focus:ring-2 focus:ring-secondary/50",
  outline:
    "border border-border bg-transparent text-foreground hover:bg-secondary focus:ring-2 focus:ring-border-focus",
  ghost:
    "bg-transparent text-foreground hover:bg-list-hover focus:ring-2 focus:ring-border-focus",
  danger:
    "bg-error text-primary-foreground hover:opacity-90 focus:ring-2 focus:ring-error/50",
  icon: "bg-transparent text-description hover:text-foreground hover:bg-list-hover rounded-lg focus:ring-2 focus:ring-border-focus p-1.5",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "px-2.5 py-1 text-xs",
  md: "px-4 py-2 text-sm",
  lg: "px-6 py-2.5 text-base",
};

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  disabled,
  className,
  children,
  ...props
}: ButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 font-medium transition-colors duration-150 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50",
        variant !== "icon" && "rounded-md",
        variantClasses[variant],
        variant !== "icon" && sizeClasses[size],
        className,
      )}
      disabled={isDisabled}
      {...props}
    >
      {loading && (
        <svg
          className="h-4 w-4 animate-spin"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
          />
        </svg>
      )}
      {children}
    </button>
  );
}
