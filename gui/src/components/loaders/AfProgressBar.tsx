/**
 * AfProgressBar — thin 2px progress indicator.
 *
 * Two modes:
 *   indeterminate — gradient sweep via animate-af-progress. Use when
 *                   work is in flight but steps aren't known (e.g. the
 *                   firewall scan pipeline before the scanner returns).
 *   determinate   — filled to `value/total`. Use for uploads, syncs,
 *                   and anything with a known completion ratio.
 *
 * Accent color by default; `variant="info"` swaps to cyan.
 */
export interface AfProgressBarProps {
  /** 0..1 value; omit for indeterminate mode. */
  value?: number;
  variant?: "accent" | "info";
  label?: string;
  className?: string;
}

export function AfProgressBar({
  value,
  variant = "accent",
  label,
  className = "",
}: AfProgressBarProps) {
  const indeterminate = typeof value !== "number";
  const clamped =
    typeof value === "number" ? Math.min(Math.max(value, 0), 1) : 0;

  const fillColor = variant === "info" ? "bg-af-info" : "bg-af-accent";

  return (
    <div
      className={`flex flex-col gap-1 ${className}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={1}
      aria-valuenow={indeterminate ? undefined : clamped}
      aria-label={label ?? "Progress"}
    >
      {label && <span className="text-af-caption text-weak">{label}</span>}
      <div className="bg-af-hairline relative h-[2px] w-full overflow-hidden rounded-full">
        {indeterminate ? (
          <span
            aria-hidden
            className={`animate-af-progress absolute inset-y-0 w-1/3 rounded-full ${fillColor}`}
            style={{
              boxShadow:
                variant === "info"
                  ? "0 0 8px var(--af-info-glow)"
                  : "0 0 8px var(--af-accent-glow)",
            }}
          />
        ) : (
          <span
            aria-hidden
            className={`absolute inset-y-0 left-0 rounded-full transition-[width] duration-200 ease-out ${fillColor}`}
            style={{ width: `${clamped * 100}%` }}
          />
        )}
      </div>
    </div>
  );
}
