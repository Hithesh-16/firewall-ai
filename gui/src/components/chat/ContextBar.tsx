import { useMemo } from "react";

import { useAppSelector } from "../../redux/hooks";
import { selectSelectedChatModelContextLength } from "../../redux/slices/configSlice";

/**
 * Compact context-window bar for the sticky chat header.
 *
 *   [ used fill ][ reserved ][ available ]
 *
 * Colour follows utilisation so the bar reads as a traffic light:
 *   < 60 %   info     (blue)
 *   60–85 %  warning  (amber)
 *   ≥ 85 %   error    (red, with a subtle pulse)
 *
 * The earlier version used `var(--text-base)` for the fill — that
 * resolved to the editor foreground (pure white in most VS Code dark
 * themes) and rendered as a solid white block that dominated the
 * sticky header. All colours now come from the app's semantic theme
 * tokens so the bar sits tonally with the surrounding UI in both
 * light and dark themes.
 */
function fmtK(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

function estimateHistoryTokens(history: unknown[]): number {
  if (!Array.isArray(history) || history.length === 0) return 0;
  let total = 0;
  for (const item of history) {
    const msg = (item as { message?: { content?: unknown } })?.message;
    const content = msg?.content;
    if (typeof content === "string") {
      total += Math.ceil(content.length / 4);
    } else if (Array.isArray(content)) {
      for (const block of content) {
        const text = (block as { text?: string })?.text;
        if (typeof text === "string") total += Math.ceil(text.length / 4);
      }
    }
  }
  return total;
}

export function ContextBar() {
  const stats = useAppSelector((s) => s.security.sessionStats);
  const modelContextLength = useAppSelector(
    selectSelectedChatModelContextLength,
  );
  const history = useAppSelector((s) => s.session.history);

  const localEstimate = useMemo(
    () => estimateHistoryTokens(history as unknown[]),
    [history],
  );

  const contextLimit =
    stats.contextLimit > 0 ? stats.contextLimit : modelContextLength;
  const contextUsed = stats.contextUsed > 0 ? stats.contextUsed : localEstimate;
  const { outputReserve } = stats;

  if (!contextLimit || contextLimit <= 0) return null;

  const used = Math.min(Math.max(contextUsed, 0), contextLimit);
  const reserved = Math.min(
    Math.max(outputReserve, 0),
    Math.max(contextLimit - used, 0),
  );
  const avail = Math.max(0, contextLimit - used - reserved);

  const pctUsed = (used / contextLimit) * 100;
  const pctReserved = (reserved / contextLimit) * 100;
  const pctAvail = (avail / contextLimit) * 100;

  const tone: "safe" | "warn" | "danger" =
    pctUsed >= 85 ? "danger" : pctUsed >= 60 ? "warn" : "safe";
  const fillClass =
    tone === "danger" ? "bg-error" : tone === "warn" ? "bg-warning" : "bg-info";
  const pulse = tone === "danger";

  const tip = [
    `${fmtK(used)} / ${fmtK(contextLimit)} tokens used (${pctUsed.toFixed(0)}%)`,
    reserved > 0 ? `${fmtK(reserved)} reserved for output` : null,
    avail > 0 ? `${fmtK(avail)} available` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <div
      className="text-description text-af-caption flex min-w-0 items-center gap-1.5 font-mono tabular-nums"
      title={tip}
      aria-label={tip}
    >
      <span className="shrink-0">{fmtK(used)}</span>
      <div className="bg-border/40 relative flex h-1.5 min-w-[60px] flex-1 overflow-hidden rounded-full">
        <div
          className={`h-full transition-[width] duration-300 ease-out ${fillClass} ${pulse ? "animate-af-pulse" : ""}`}
          style={{ width: `${pctUsed}%` }}
          aria-hidden
        />
        <div
          className="bg-info/25 h-full transition-[width] duration-300"
          style={{ width: `${pctReserved}%` }}
          aria-hidden
        />
        {pctAvail > 0 && (
          <div
            className="h-full"
            style={{ width: `${pctAvail}%` }}
            aria-hidden
          />
        )}
      </div>
      <span className="shrink-0">{fmtK(contextLimit)}</span>
    </div>
  );
}
