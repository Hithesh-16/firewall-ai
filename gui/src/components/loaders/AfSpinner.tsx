/**
 * AfSpinner — the canonical spinner for async work.
 *
 * Replaces the ad-hoc `div` + `border-t` spinners scattered across
 * the GUI. Sizes map to usage context:
 *   xs  — inline, next to text (badge, row action)
 *   sm  — inline large, form buttons
 *   md  — card-level loading
 *   lg  — full-page loading state
 *
 * `variant` picks the color story:
 *   accent (default) — emerald spinner, signals product identity
 *   muted           — theme-description color, used inside overlays
 *                     where accent would fight the foreground content
 */
export interface AfSpinnerProps {
  size?: "xs" | "sm" | "md" | "lg";
  variant?: "accent" | "muted";
  className?: string;
  label?: string;
}

const SIZE_CLASSES: Record<NonNullable<AfSpinnerProps["size"]>, string> = {
  xs: "h-3 w-3 border",
  sm: "h-4 w-4 border-2",
  md: "h-6 w-6 border-2",
  lg: "h-8 w-8 border-[3px]",
};

export function AfSpinner({
  size = "md",
  variant = "accent",
  className = "",
  label,
}: AfSpinnerProps) {
  const ring =
    variant === "accent"
      ? "border-af-hairline border-t-af-accent"
      : "border-description/20 border-t-description";

  return (
    <span
      className={`inline-flex items-center gap-2 ${className}`}
      role="status"
      aria-live="polite"
    >
      <span
        className={`${SIZE_CLASSES[size]} ${ring} animate-spin rounded-full`}
        aria-hidden
      />
      {label && <span className="text-af-caption text-weak">{label}</span>}
      {!label && <span className="sr-only">Loading</span>}
    </span>
  );
}
