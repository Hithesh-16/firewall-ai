import { useEffect, useState } from "react";

/**
 * AfSuccessCheck — animated stroke-draw checkmark for one-shot
 * completions (copy → clipboard, save → done, grant → created).
 *
 * Renders an SVG with a path-length-based dashoffset animation that
 * draws the check in 360ms. Fires once on mount; no infinite loop.
 * Consumers typically toggle it with a timeout:
 *
 *   const [done, setDone] = useState(false);
 *   useEffect(() => {
 *     if (trigger) {
 *       setDone(true);
 *       const t = setTimeout(() => setDone(false), 1800);
 *       return () => clearTimeout(t);
 *     }
 *   }, [trigger]);
 *   return done ? <AfSuccessCheck /> : <CopyIcon/>;
 */
export interface AfSuccessCheckProps {
  size?: number;
  className?: string;
  tone?: "accent" | "info";
  /** Key the animation can remount against, so the same check mark
   *  can retrigger on repeated success events without needing a
   *  unmount/remount in the parent. */
  replayKey?: string | number;
}

export function AfSuccessCheck({
  size = 14,
  className = "",
  tone = "accent",
  replayKey,
}: AfSuccessCheckProps) {
  // Remount on replayKey change so the stroke-draw replays.
  const [, setTick] = useState(0);
  useEffect(() => {
    setTick((t) => t + 1);
  }, [replayKey]);

  const stroke = tone === "info" ? "var(--af-info)" : "var(--af-accent)";

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      className={className}
      aria-hidden
    >
      <circle
        cx="8"
        cy="8"
        r="7"
        stroke={stroke}
        strokeOpacity="0.35"
        strokeWidth="1.5"
        fill="none"
      />
      <path
        d="M4.5 8.5 L7 11 L11.5 5.5"
        stroke={stroke}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
        strokeDasharray="32"
        style={{
          strokeDashoffset: 32,
          animation: "af-stroke-draw 360ms ease-out forwards",
        }}
      />
    </svg>
  );
}
