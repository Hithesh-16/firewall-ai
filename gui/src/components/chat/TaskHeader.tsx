import {
  ArrowDownIcon,
  ArrowUpIcon,
  BoltIcon,
  ChevronDownIcon,
} from "@heroicons/react/24/outline";
import { useEffect, useRef, useState } from "react";

import { useAppSelector } from "../../redux/hooks";
import { selectSelectedChatModel } from "../../redux/slices/configSlice";
import { ContextBar } from "./ContextBar";
import { TokenBreakdown } from "./TokenBreakdown";

/**
 * Sticky chat header — session cost + context window at a glance,
 * expands to a second row with TokenBreakdown + live session elapsed
 * + current model.
 *
 * P4 polish pass:
 *   - 2-line layout when expanded (cost/bar on top, breakdown +
 *     elapsed + model on bottom)
 *   - Cost pill shows an emerald dot when cache-read is active —
 *     signals "your prefix caching is paying off" without adding a
 *     separate chrome element
 *   - Collapsed click target animates chevron via motion vocabulary
 *   - `animate-af-slide-down` on the expanded panel so opening the
 *     header isn't abrupt
 *
 * Sub-components:
 *   ContextBar      — 3-segment used/reserved/available bar
 *   TokenBreakdown  — in/out/cache/reasoning chips
 *   TodoStrip       — live agent todo list
 */
export function TaskHeader() {
  const [expanded, setExpanded] = useState(false);
  const stats = useAppSelector((s) => s.security.sessionStats);
  const todos = useAppSelector((s) => s.todos);
  const sessionTitle = useAppSelector((s) => s.session.title);
  const selectedChatModel = useAppSelector(selectSelectedChatModel);
  const historyLength = useAppSelector((s) => s.session.history.length);
  const sessionStart = useSessionStartRef();

  // D2: show the header as soon as there's anything meaningful to
  // display. Previously this gated on proxy-driven stats (which don't
  // populate on local sessions or with providers whose maxContextTokens
  // aren't registered), making the whole feature feel invisible.
  //
  // The new criteria: a chat model is selected AND at least one message
  // has been sent (so the local-fallback ContextBar has something to
  // measure), OR any cumulative stat is non-zero, OR todos exist.
  const hasChatModel = !!(selectedChatModel && selectedChatModel.model);
  const hasAnyActivity =
    stats.contextLimit > 0 ||
    stats.totalTokens > 0 ||
    stats.inputTokens > 0 ||
    stats.outputTokens > 0 ||
    todos.length > 0 ||
    (hasChatModel && historyLength > 0);

  if (!hasAnyActivity) return null;

  const costLabel =
    stats.totalCost > 0
      ? `$${stats.totalCost.toFixed(stats.totalCost < 0.01 ? 4 : 2)}`
      : null;

  // UI-1: match the parent surface. The chat uses
  // var(--vscode-background) as its backdrop (via vscBackground in
  // Chat.tsx), but `bg-editor` resolves to `--vscode-editor-background`
  // — a sibling token that's one shade lighter in most dark themes.
  // The mismatch rendered the header as a light bar on dark themes.
  // `bg-background` maps to the same var the chat container uses, so
  // the sticky header is invisible against the backdrop until it
  // overlaps scrolling content.
  return (
    <div className="border-border bg-background border-b">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="text-description hover:text-foreground hover:bg-list-hover/30 text-af-caption flex w-full items-center gap-2 border-0 bg-transparent px-3 py-1.5 transition-colors"
        aria-expanded={expanded}
        aria-label="Toggle session details"
      >
        {costLabel && (
          <span className="text-foreground inline-flex shrink-0 items-center gap-1 font-medium tabular-nums">
            {costLabel}
          </span>
        )}
        <InlineTokenStats />
        <div className="min-w-0 flex-1">
          <ContextBar />
        </div>
        <ChevronDownIcon
          className={`h-3 w-3 shrink-0 transition-transform duration-150 ${
            expanded ? "rotate-180" : ""
          }`}
          aria-hidden
        />
      </button>

      {expanded && (
        <div className="border-border animate-af-slide-down flex flex-col gap-1.5 overflow-hidden border-t px-3 py-1.5">
          {/* P9: session title row — shows the first user message (or
               a model-generated summary) so users can identify which
               conversation they're in at a glance. Omitted when the
               session is still at its NEW_SESSION_TITLE default. */}
          {sessionTitle && !isDefaultSessionTitle(sessionTitle) && (
            <div
              className="text-foreground text-af-caption truncate font-semibold"
              title={sessionTitle}
            >
              {sessionTitle}
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <TokenBreakdown />
            </div>
            <div className="text-description-muted text-af-caption flex items-center gap-3 tabular-nums">
              {sessionStart && <ElapsedTime since={sessionStart} />}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Capture the timestamp of the first token activity in this session
 * so the expanded header can show "Elapsed: 12s" live. Stored in a
 * ref rather than Redux because it's a pure UI concern and shouldn't
 * persist across reloads.
 */
function useSessionStartRef(): number | null {
  const ref = useRef<number | null>(null);
  const inputTokens = useAppSelector(
    (s) => s.security.sessionStats.inputTokens,
  );
  useEffect(() => {
    if (ref.current === null && inputTokens > 0) {
      ref.current = Date.now();
    }
  }, [inputTokens]);
  return ref.current;
}

/**
 * The session starts with a placeholder title ("New conversation")
 * until the first turn has been indexed. We hide the title row during
 * that window so a freshly-opened chat doesn't show a generic label.
 */
function isDefaultSessionTitle(title: string): boolean {
  const trimmed = title.trim().toLowerCase();
  return (
    trimmed === "" ||
    trimmed === "new session" ||
    trimmed === "new conversation"
  );
}

/**
 * Compact input/output/cached token trio shown inline in the sticky
 * header. The expanded `TokenBreakdown` row kept these values hidden
 * behind the chevron, so users never noticed that caching was saving
 * them money or that the context was inflating. Surfacing all three as
 * coloured chips keeps the signal visible without stealing space — each
 * chip auto-hides when its value is zero.
 */
function InlineTokenStats() {
  const s = useAppSelector((st) => st.security.sessionStats);
  const { inputTokens, outputTokens, cacheReadTokens } = s;

  if (!inputTokens && !outputTokens && !cacheReadTokens) return null;

  return (
    <span
      className="text-description text-af-caption inline-flex shrink-0 items-center gap-2 tabular-nums"
      aria-label="Session token breakdown"
    >
      {inputTokens > 0 && (
        <span
          className="inline-flex items-center gap-0.5"
          title="Prompt / input tokens"
        >
          <ArrowUpIcon className="text-info h-3 w-3" />
          {fmtK(inputTokens)}
        </span>
      )}
      {outputTokens > 0 && (
        <span
          className="inline-flex items-center gap-0.5"
          title="Completion / output tokens"
        >
          <ArrowDownIcon className="text-warning h-3 w-3" />
          {fmtK(outputTokens)}
        </span>
      )}
      {cacheReadTokens > 0 && (
        <span
          className="text-success inline-flex items-center gap-0.5 font-medium"
          title="Cache-read tokens — served at the discounted rate"
        >
          <BoltIcon className="h-3 w-3" />
          {fmtK(cacheReadTokens)}
        </span>
      )}
    </span>
  );
}

function fmtK(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

function ElapsedTime({ since }: { since: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const seconds = Math.max(0, Math.floor((now - since) / 1000));
  const label =
    seconds < 60
      ? `${seconds}s`
      : seconds < 3600
        ? `${Math.floor(seconds / 60)}m ${seconds % 60}s`
        : `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  return (
    <span className="text-weak" title="Session elapsed time">
      {label}
    </span>
  );
}
