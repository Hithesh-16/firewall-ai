import type { ReactNode } from "react";

/**
 * AfTextShimmer — gradient sweep label for streaming states.
 *
 * Extends the kilocode-parity TextShimmer with preset variants so
 * callers don't have to pick a label every time. Infinite animation
 * is honoured by `prefers-reduced-motion: reduce` (collapses to a
 * static weak label via the global rule in tokens.css).
 */

export type AfTextShimmerVariant =
  | "thinking"
  | "scanning"
  | "saving"
  | "streaming"
  | "syncing";

const VARIANT_LABELS: Record<AfTextShimmerVariant, string> = {
  thinking: "Thinking…",
  scanning: "Scanning…",
  saving: "Saving…",
  streaming: "Streaming…",
  syncing: "Syncing…",
};

export interface AfTextShimmerProps {
  /** Pick a preset label — overrides `children` if provided. */
  variant?: AfTextShimmerVariant;
  /** Custom label (used when `variant` is omitted). */
  children?: ReactNode;
  className?: string;
}

export function AfTextShimmer({
  variant,
  children,
  className = "",
}: AfTextShimmerProps) {
  const label: ReactNode =
    variant !== undefined ? VARIANT_LABELS[variant] : (children ?? "");

  return (
    <span className={`relative inline-block ${className}`} aria-live="polite">
      {/* Base label — screen readers + reduced-motion fallback */}
      <span className="text-weak">{label}</span>
      {/* Gradient sweep */}
      <span
        aria-hidden
        className="animate-shimmer absolute inset-0 bg-gradient-to-r from-transparent via-[var(--text-base)] to-transparent bg-[length:200%_100%] bg-clip-text text-transparent"
      >
        {label}
      </span>
    </span>
  );
}
