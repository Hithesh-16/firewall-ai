import type { ReactNode } from "react";

/**
 * AfPulseHalo — halo effect behind an icon, signals background work.
 *
 * Used for:
 *   - Firewall "scanning" indicator in the sidebar
 *   - Live proxy-health dot on AccountDropdown
 *   - Tool card when a tool call is running
 *
 * Renders two offset rings pulsing at the same cadence but different
 * initial delays so the combined effect is a continuous radial wave
 * rather than a single pulse. Color defaults to accent emerald; pass
 * `tone="danger"` for unreachable/red or `tone="info"` for info cyan.
 */
export interface AfPulseHaloProps {
  children: ReactNode;
  tone?: "accent" | "info" | "danger";
  size?: "sm" | "md" | "lg";
  className?: string;
  /** Disable the halo (still renders children) — used when the parent
   *  state says "not active" without forcing conditional render. */
  inactive?: boolean;
}

const SIZE_MAP = {
  sm: "w-4 h-4",
  md: "w-5 h-5",
  lg: "w-7 h-7",
};

const TONE_MAP = {
  accent: "bg-af-accent",
  info: "bg-af-info",
  danger: "bg-af-danger",
};

export function AfPulseHalo({
  children,
  tone = "accent",
  size = "md",
  className = "",
  inactive = false,
}: AfPulseHaloProps) {
  return (
    <span
      className={`relative inline-flex items-center justify-center ${SIZE_MAP[size]} ${className}`}
    >
      {!inactive && (
        <>
          <span
            aria-hidden
            className={`animate-af-pulse absolute inset-0 rounded-full ${TONE_MAP[tone]} opacity-40`}
          />
          <span
            aria-hidden
            className={`animate-af-pulse absolute inset-[-4px] rounded-full ${TONE_MAP[tone]} opacity-20`}
            style={{ animationDelay: "350ms" }}
          />
        </>
      )}
      <span className="relative z-[1] flex items-center justify-center">
        {children}
      </span>
    </span>
  );
}
