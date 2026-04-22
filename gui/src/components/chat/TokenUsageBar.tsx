import { useEffect, useMemo, useRef, useState } from "react";

import { useAppSelector } from "../../redux/hooks";

/**
 * Token-flow histogram for the sticky chat header.
 *
 * Replaces the old 2-px context-fill line with a per-turn spike strip
 * so users see token usage build across the conversation, not just the
 * cumulative sum. Each turn contributes one bar whose height is
 * proportional to the largest turn seen in the session.
 *
 * Colour encoding (first match wins per bar):
 *   BLOCK                 -> error  (security blocked the call)
 *   REDACT                -> warn   (firewall masked PII/secrets)
 *   turn tokens >= 2000   -> warn   (heavy turn, watch spend)
 *   turn tokens >= 500    -> info   (normal)
 *   default               -> success (light turn)
 *
 * A live pulsing bar is appended while streaming so the strip animates
 * with the LLM's output. The left side shows the session context
 * utilisation; the right side shows the live output count.
 *
 * The component auto-hides until there is at least one completed turn
 * or an active stream — we don't want an empty strip on a fresh chat.
 */

type BarTone = "safe" | "info" | "warn" | "danger";

interface TurnBar {
  key: string;
  tokens: number;
  tone: BarTone;
  title: string;
}

const BAR_FILL: Record<BarTone, string> = {
  safe: "bg-success",
  info: "bg-info",
  warn: "bg-warning",
  danger: "bg-error",
};

const BAR_GLOW: Record<BarTone, string> = {
  safe: "shadow-[0_0_6px_rgba(52,211,153,0.45)]",
  info: "shadow-[0_0_6px_rgba(96,165,250,0.45)]",
  warn: "shadow-[0_0_6px_rgba(251,191,36,0.5)]",
  danger: "shadow-[0_0_8px_rgba(248,113,113,0.55)]",
};

export function TokenUsageBar() {
  const stats = useAppSelector((s) => s.security.sessionStats);
  const history = useAppSelector((s) => s.session.history);
  const isStreaming = useAppSelector((s) => s.session.isStreaming);
  const lastScan = useAppSelector((s) => s.security.lastScanResult);
  const recentScans = useAppSelector((s) => s.security.recentScans);

  const bars = useMemo(
    () => buildTurnBars(history, recentScans, lastScan),
    [history, recentScans, lastScan],
  );

  const liveTokens = useLiveOutputTokens(isStreaming, stats.outputTokens);

  const pctUsed =
    stats.contextLimit > 0
      ? Math.min(
          100,
          Math.round((stats.contextUsed / stats.contextLimit) * 100),
        )
      : 0;

  const contextTone: BarTone =
    pctUsed >= 85 ? "danger" : pctUsed >= 60 ? "warn" : "info";

  // Nothing to show on a fresh chat.
  if (bars.length === 0 && !isStreaming) return null;

  const maxTokens = Math.max(1, ...bars.map((b) => b.tokens), liveTokens || 0);

  const contextLabel =
    stats.contextLimit > 0
      ? `${fmt(stats.contextUsed)} / ${fmt(stats.contextLimit)} · ${pctUsed}%`
      : stats.totalTokens > 0
        ? `${fmt(stats.totalTokens)} tokens`
        : null;

  return (
    <div
      className="border-border/40 flex items-center gap-2 border-b bg-transparent px-3 py-1"
      aria-label="Per-turn token usage"
    >
      {contextLabel && (
        <span
          className="text-description text-af-caption shrink-0 font-mono tabular-nums"
          title={`Context window: ${contextLabel}`}
        >
          <span className={toneTextClass(contextTone)}>
            {fmt(stats.contextUsed)}
          </span>
          <span className="text-description-muted">
            {stats.contextLimit > 0 ? ` / ${fmt(stats.contextLimit)}` : ""}
          </span>
        </span>
      )}

      <div
        className="relative flex h-6 min-w-0 flex-1 items-end gap-[2px] overflow-hidden"
        role="img"
        aria-label={`${bars.length} turns rendered as a token-usage histogram`}
      >
        {bars.map((bar) => {
          const h = Math.max(8, Math.round((bar.tokens / maxTokens) * 100));
          return (
            <span
              key={bar.key}
              className={`relative w-1.5 shrink-0 rounded-[2px] ${BAR_FILL[bar.tone]} ${BAR_GLOW[bar.tone]} transition-[height,background-color] duration-300 ease-out`}
              style={{ height: `${h}%` }}
              title={bar.title}
            >
              <span
                className="absolute inset-x-0 top-0 h-1/3 rounded-t-[2px] bg-white/20"
                aria-hidden
              />
            </span>
          );
        })}

        {isStreaming && <LiveBar tokens={liveTokens} maxTokens={maxTokens} />}
      </div>

      {isStreaming ? (
        <span
          className="text-info text-af-caption inline-flex shrink-0 items-center gap-1 font-mono tabular-nums"
          aria-live="polite"
          title="Tokens streamed in the current turn"
        >
          <span className="bg-info h-1.5 w-1.5 animate-pulse rounded-full" />
          {fmt(liveTokens)}
        </span>
      ) : (
        bars.length > 0 && (
          <span
            className="text-description-muted text-af-caption shrink-0 font-mono tabular-nums"
            title={`${bars.length} completed turn${bars.length === 1 ? "" : "s"}`}
          >
            {bars.length}×
          </span>
        )
      )}
    </div>
  );
}

function LiveBar({ tokens, maxTokens }: { tokens: number; maxTokens: number }) {
  const h = Math.max(12, Math.round((tokens / Math.max(1, maxTokens)) * 100));
  return (
    <span
      className="bg-info shadow-info/50 relative w-1.5 shrink-0 rounded-[2px] shadow-[0_0_10px] transition-[height] duration-200 ease-out"
      style={{ height: `${h}%` }}
      title={`Streaming: ${fmt(tokens)} tokens`}
    >
      <span
        className="animate-af-pulse absolute inset-x-0 top-0 h-1/2 rounded-t-[2px] bg-white/40"
        aria-hidden
      />
    </span>
  );
}

/**
 * Build one bar per assistant turn from the history's promptLogs.
 * Tokens default to completionTokens so the bar reflects what the LLM
 * actually produced; falls back to promptTokens when the provider only
 * reports input counts. Security tone comes from the scan closest in
 * time to the turn — imperfect correlation but good enough for a
 * visual cue, and the last-known scan colours the tail bar.
 */
function buildTurnBars(
  history: ReadonlyArray<{
    message: { role: string };
    promptLogs?: Array<{ promptTokens?: number; completionTokens?: number }>;
  }>,
  recentScans: ReadonlyArray<{
    action: "ALLOW" | "REDACT" | "BLOCK" | "REQUIRE_APPROVAL";
  }>,
  lastScan: {
    action: "ALLOW" | "REDACT" | "BLOCK" | "REQUIRE_APPROVAL";
  } | null,
): TurnBar[] {
  const out: TurnBar[] = [];
  let assistantIdx = 0;

  for (let i = 0; i < history.length; i++) {
    const item = history[i];
    if (item.message.role !== "assistant") continue;
    if (!item.promptLogs || item.promptLogs.length === 0) continue;

    const completion = item.promptLogs.reduce(
      (sum, log) => sum + (log.completionTokens ?? 0),
      0,
    );
    const prompt = item.promptLogs.reduce(
      (sum, log) => sum + (log.promptTokens ?? 0),
      0,
    );
    const tokens = completion > 0 ? completion : prompt;
    if (tokens <= 0) continue;

    // recentScans is stored newest-first; walk from the tail so the
    // oldest scan matches the oldest assistant turn.
    const scanFromTail =
      recentScans[recentScans.length - 1 - assistantIdx] ?? null;

    const tone = toneForTurn(tokens, scanFromTail?.action ?? null);
    out.push({
      key: `${i}-${tokens}`,
      tokens,
      tone,
      title: buildBarTitle(
        assistantIdx + 1,
        tokens,
        prompt,
        completion,
        scanFromTail?.action ?? null,
      ),
    });
    assistantIdx++;
  }

  // If the most recent completed turn had no scan but the session did,
  // nudge the tail bar to the last scan's tone so the firewall signal
  // isn't invisible.
  if (out.length > 0 && lastScan && recentScans.length === 0) {
    const tail = out[out.length - 1];
    out[out.length - 1] = {
      ...tail,
      tone: toneForTurn(tail.tokens, lastScan.action),
    };
  }

  return out;
}

function toneForTurn(
  tokens: number,
  action: "ALLOW" | "REDACT" | "BLOCK" | "REQUIRE_APPROVAL" | null,
): BarTone {
  if (action === "BLOCK") return "danger";
  if (action === "REDACT" || action === "REQUIRE_APPROVAL") return "warn";
  if (tokens >= 2000) return "warn";
  if (tokens >= 500) return "info";
  return "safe";
}

function buildBarTitle(
  turnNumber: number,
  totalTokens: number,
  prompt: number,
  completion: number,
  action: "ALLOW" | "REDACT" | "BLOCK" | "REQUIRE_APPROVAL" | null,
): string {
  const parts = [
    `Turn ${turnNumber}: ${fmt(totalTokens)} tokens`,
    prompt > 0 ? `in ${fmt(prompt)}` : null,
    completion > 0 ? `out ${fmt(completion)}` : null,
    action ? `firewall: ${action.toLowerCase()}` : null,
  ];
  return parts.filter(Boolean).join(" · ");
}

/**
 * Rough live counter while the model is streaming. We don't have a
 * per-token hook in Redux, so we simulate a smoothly-rising spike off
 * the cumulative `outputTokens` delta captured when streaming started.
 * The counter resets on every new stream.
 */
function useLiveOutputTokens(
  isStreaming: boolean,
  cumulativeOutput: number,
): number {
  const baselineRef = useRef<number | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!isStreaming) {
      baselineRef.current = null;
      setTick(0);
      return;
    }
    if (baselineRef.current === null) {
      baselineRef.current = cumulativeOutput;
    }
    const id = window.setInterval(() => setTick((t) => t + 1), 120);
    return () => window.clearInterval(id);
  }, [isStreaming, cumulativeOutput]);

  if (!isStreaming) return 0;
  const base = baselineRef.current ?? cumulativeOutput;
  const real = Math.max(0, cumulativeOutput - base);
  // Visual easing — if the backend hasn't flushed a counter yet, animate
  // a gentle ramp so the bar doesn't freeze at 0 for multi-second gaps.
  // Capped so it can't overshoot plausibility.
  const simulated = Math.min(2500, tick * 8);
  return Math.max(real, simulated);
}

function toneTextClass(tone: BarTone): string {
  switch (tone) {
    case "danger":
      return "text-error";
    case "warn":
      return "text-warning";
    case "safe":
      return "text-success";
    default:
      return "text-info";
  }
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}
