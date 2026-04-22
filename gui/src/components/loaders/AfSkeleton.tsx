/**
 * AfSkeleton — shimmer-filled placeholder for known-shape content.
 *
 * Use instead of a spinner when the target shape is a list, table, or
 * known card layout — the user sees the rough silhouette filling in
 * rather than staring at a centered wheel. Perceived-performance win.
 *
 * `AfSkeletonRow` and `AfSkeletonCard` are opinionated presets — most
 * callers want one of those, not the raw primitive.
 */

interface AfSkeletonProps {
  width?: string | number;
  height?: string | number;
  rounded?: "sm" | "md" | "lg" | "full";
  className?: string;
}

const ROUND_CLASSES = {
  sm: "rounded-sm",
  md: "rounded-md",
  lg: "rounded-lg",
  full: "rounded-full",
};

export function AfSkeleton({
  width,
  height = "0.75rem",
  rounded = "md",
  className = "",
}: AfSkeletonProps) {
  return (
    <span
      aria-hidden
      className={`animate-shimmer inline-block ${ROUND_CLASSES[rounded]} ${className}`}
      style={{
        width,
        height,
        backgroundImage:
          "linear-gradient(90deg, var(--af-hairline) 0%, color-mix(in srgb, var(--text-base) 12%, transparent) 45%, var(--af-hairline) 100%)",
        backgroundSize: "200% 100%",
      }}
    />
  );
}

/**
 * One-line placeholder meant to stand in for text rows in a list.
 * Randomised width so a column of 5 rows doesn't look like a bar chart.
 */
export function AfSkeletonRow({
  lines = 1,
  className = "",
}: {
  lines?: number;
  className?: string;
}) {
  const widths = ["92%", "78%", "85%", "68%", "96%"];
  return (
    <div className={`flex flex-col gap-2 ${className}`} role="status">
      {Array.from({ length: lines }).map((_, i) => (
        <AfSkeleton
          key={i}
          width={widths[i % widths.length]}
          height="0.65rem"
        />
      ))}
      <span className="sr-only">Loading content</span>
    </div>
  );
}

/**
 * Card-shaped skeleton — a circle-ish avatar + two text rows. Used
 * as the placeholder for user/org rows, model rows, agent cards.
 */
export function AfSkeletonCard({
  withAvatar = true,
  className = "",
}: {
  withAvatar?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`border-af-hairline bg-af-surface-raised/50 flex items-center gap-3 rounded-md border p-3 ${className}`}
      role="status"
    >
      {withAvatar && <AfSkeleton width="2rem" height="2rem" rounded="full" />}
      <div className="flex flex-1 flex-col gap-2">
        <AfSkeleton width="60%" height="0.75rem" />
        <AfSkeleton width="40%" height="0.6rem" />
      </div>
      <span className="sr-only">Loading</span>
    </div>
  );
}
