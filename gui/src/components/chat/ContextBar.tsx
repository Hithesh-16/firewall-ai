import { useMemo } from "react";

import { useAppSelector } from "../../redux/hooks";
import { selectSelectedChatModelContextLength } from "../../redux/slices/configSlice";

/**
 * Three-segment context window bar (kilocode-parity).
 *
 *   [ used ][ reserved ][ available ]
 *
 * - used       — tokens currently in the conversation window
 * - reserved   — model.maxCompletionTokens (saved for the next reply)
 * - available  — free space that's left over
 *
 * Data sources (fallback chain, D1):
 *   1. `stats.contextLimit` / `stats.contextUsed` from proxy X-AF-*
 *      headers — accurate, arrives once a response streams through
 *      the proxy.
 *   2. `selectSelectedChatModelContextLength` from the configured
 *      chat model — works offline, before the first turn.
 *   3. Local chars/4 estimate of the session history — rough but
 *      keeps the bar live while the user types.
 *
 * Renders `null` only when no model is selected AND no proxy data
 * has arrived — the point where drawing a bar would be misleading.
 */
function fmtK(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

/**
 * Char-count / 4 heuristic — the same fast-approx every major
 * tokenizer library agrees on within ~15% for English text. Good
 * enough for a progress bar feel without bundling a tokenizer.
 */
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

  // Pick the best available source for each value. Proxy wins when
  // present; otherwise we fall back to local data so the bar stays
  // visible during offline / local-only sessions.
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
  const hot = pctUsed >= 50;

  const tip = [
    `${fmtK(used)} / ${fmtK(contextLimit)} tokens used (${pctUsed.toFixed(0)}%)`,
    reserved > 0 ? `${fmtK(reserved)} reserved for output` : null,
    avail > 0 ? `${fmtK(avail)} available` : null,
  ]
    .filter(Boolean)
    .join("\n");

  // P4 polish: caching tinted emerald when the cache-read pipeline is
  // delivering savings; at ≥80% utilization the "used" segment adopts
  // an af-pulse animation to signal caution without switching to a
  // panicky red.
  const caching = stats.cacheReadTokens > 0;
  const caution = pctUsed >= 80;

  return (
    <div
      className="text-weak text-af-caption flex min-w-0 items-center gap-1.5 font-mono tabular-nums"
      title={tip}
      aria-label={tip}
    >
      <span className="shrink-0">{fmtK(used)}</span>
      <div className="relative flex h-1 min-w-[60px] flex-1 overflow-hidden rounded-sm bg-[color-mix(in_srgb,var(--text-base)_20%,transparent)]">
        <div
          className={`h-full transition-[width,background,box-shadow] duration-300 ease-out ${
            hot
              ? "bg-[color-mix(in_srgb,var(--vscode-errorForeground,#f48771)_60%,rgba(128,0,0,1))]"
              : caching
                ? "bg-af-accent"
                : "bg-[var(--text-base)]"
          } ${caution ? "animate-af-pulse" : ""}`}
          style={{
            width: `${pctUsed}%`,
            boxShadow: caching ? "0 0 6px var(--af-accent-glow)" : undefined,
          }}
          aria-hidden
        />
        <div
          className="h-full bg-[color-mix(in_srgb,var(--text-base)_30%,transparent)] transition-[width] duration-300"
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
