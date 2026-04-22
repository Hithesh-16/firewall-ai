import { Text } from "ink";
import React from "react";

interface ContextPercentageDisplayProps {
  percentage: number;
}

/**
 * Context-window usage indicator for the CLI.
 *
 * Terminal-native equivalent of the IDE's `<TokenUsageBar />`. Same
 * thresholds (60 / 85 %) so users moving between CLI and IDE build
 * one mental model:
 *
 *   Ctx ██░░░░░░░░░░░░  17%   (green, comfortable)
 *   Ctx ██████████░░░░  62%   (yellow, getting tight)
 *   Ctx █████████████░  92%   (red, pulsing — trim the chat)
 *
 * Rendered inline in the `BottomStatusBar` so it's always in
 * peripheral vision without stealing the main area.
 */
const BAR_CELLS = 14;

export const ContextPercentageDisplay: React.FC<
  ContextPercentageDisplayProps
> = ({ percentage }) => {
  if (percentage <= 0) return null;

  const clamped = Math.max(0, Math.min(100, Math.round(percentage)));
  const filled = Math.round((clamped / 100) * BAR_CELLS);
  const empty = BAR_CELLS - filled;
  // `▰▱` reads better in monospace than `█░` on many terminals and
  // matches the kilocode look. Falls back gracefully to blocks if the
  // terminal renders them narrow.
  const bar = "▰".repeat(filled) + "▱".repeat(empty);

  const color: "green" | "yellow" | "red" =
    clamped >= 85 ? "red" : clamped >= 60 ? "yellow" : "green";

  return (
    <Text color={color}>
      <Text color="dim">Ctx </Text>
      {bar} {clamped}%
    </Text>
  );
};
