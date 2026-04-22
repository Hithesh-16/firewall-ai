import React from "react";
import { cn } from "../../utils/cn";

type SkeletonVariant = "text" | "circular" | "rectangular";

interface SkeletonProps {
  variant?: SkeletonVariant;
  width?: string | number;
  height?: string | number;
  className?: string;
}

export function Skeleton({ variant = "text", width, height, className }: SkeletonProps) {
  const style: React.CSSProperties = {};
  if (width) style.width = typeof width === "number" ? `${width}px` : width;
  if (height) {
    style.height = typeof height === "number" ? `${height}px` : height;
  }

  return (
    <div
      className={cn(
        "bg-secondary animate-pulse",
        variant === "text" && "h-4 w-full rounded",
        variant === "circular" && "h-10 w-10 rounded-full",
        variant === "rectangular" && "h-20 w-full rounded-md",
        className,
      )}
      style={style}
      aria-hidden="true"
    />
  );
}

/**
 * Opinionated row-of-cards skeleton (P3).
 *
 * Drop-in replacement for the centered LoadingSpinner blocks on list
 * pages (UsersTab, UserModelsTab, ProvidersTab, ModelsPage). Shows
 * the rough silhouette of the eventual content so the page feels
 * alive during the fetch — perceived-performance win vs a wheel
 * spinning in the middle of an otherwise blank area.
 *
 * Randomised widths per row so a stack of 5 doesn't look like a bar
 * chart. `withAvatar` on by default since user / model / provider
 * rows usually lead with an icon or initial.
 */
export function SkeletonCard({
  withAvatar = true,
  className,
}: {
  withAvatar?: boolean;
  className?: string;
}) {
  const widths = ["78%", "62%", "85%", "55%", "72%"];
  const row = Math.floor(Math.random() * widths.length);
  const nameWidth = widths[row];
  const subWidth = widths[(row + 2) % widths.length];
  return (
    <div
      className={cn("border-border flex items-center gap-3 rounded-md border p-3", className)}
      role="status"
      aria-label="Loading"
    >
      {withAvatar && <Skeleton variant="circular" className="h-8 w-8" />}
      <div className="flex flex-1 flex-col gap-2">
        <Skeleton variant="text" width={nameWidth} height={10} />
        <Skeleton variant="text" width={subWidth} height={8} />
      </div>
      <Skeleton variant="text" width={56} height={18} className="rounded-full" />
    </div>
  );
}

/**
 * Helper for rendering N skeleton cards. Zero cost when count=0.
 */
export function SkeletonList({
  count = 4,
  withAvatar = true,
  className,
}: {
  count?: number;
  withAvatar?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2", className)} aria-busy="true">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} withAvatar={withAvatar} />
      ))}
    </div>
  );
}
