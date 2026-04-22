import { ChevronDownIcon, SparklesIcon } from "@heroicons/react/24/outline";
import { useState } from "react";

import { AfTextShimmer } from "../loaders/AfTextShimmer";

/**
 * Inline "Thought process" panel shown above an assistant message
 * (kilocode-parity).
 *
 * Collapsed by default — click to expand. While the assistant is
 * actively streaming the reasoning stage, the label animates with
 * a gradient shimmer to signal liveness; once complete it flips to
 * a static "Thought process" label with token count + elapsed time.
 *
 * Token/duration stats render only when known — not every provider
 * surfaces them (Anthropic extended thinking, o1, DeepSeek-R1 and
 * Gemini Flash Thinking do; plain models don't).
 */
export interface ReasoningBlockProps {
  text: string;
  tokens?: number;
  durationMs?: number;
  /** True while the assistant is actively producing reasoning text.
   *  Auto-expands the block and swaps the label for a shimmer. */
  streaming?: boolean;
  /** Override the collapsed-by-default behavior when the caller
   *  wants the block always open (e.g. history replay). */
  defaultOpen?: boolean;
}

export function ReasoningBlock({
  text,
  tokens,
  durationMs,
  streaming,
  defaultOpen,
}: ReasoningBlockProps) {
  const [open, setOpen] = useState<boolean>(defaultOpen ?? streaming ?? false);

  // P4 polish: emerald tint on the expanded state so users can tell
  // at a glance "I'm looking at the reasoning" vs. a collapsed pill.
  // Active streaming adds the AfTextShimmer with the "thinking" variant.
  return (
    <div
      className={`mb-2 overflow-hidden rounded-md border transition-colors ${
        open
          ? "border-af-accent/30 bg-af-accent/5"
          : "border-border bg-secondary-background"
      }`}
    >
      <button
        type="button"
        className="text-weak hover:text-strong text-af-caption flex w-full items-center gap-2 px-3 py-1.5 transition-colors"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <SparklesIcon
          className={`h-3.5 w-3.5 shrink-0 ${open ? "text-af-accent" : ""}`}
        />
        <span className="flex-1 text-left">
          {streaming ? <AfTextShimmer variant="thinking" /> : "Thought process"}
        </span>
        {tokens != null && tokens > 0 && (
          <span className="tabular-nums">{tokens.toLocaleString()} tok</span>
        )}
        {durationMs != null && durationMs > 0 && (
          <span className="tabular-nums">
            {" · "}
            {(durationMs / 1000).toFixed(1)}s
          </span>
        )}
        <ChevronDownIcon
          className={`h-3 w-3 shrink-0 transition-transform duration-150 ${
            open ? "rotate-180" : ""
          }`}
          aria-hidden
        />
      </button>
      {/* P10: streaming preview — when the block is collapsed AND
           the reasoning is still streaming, show the tail of the text
           dimmed under the pill so the user can see progress without
           expanding. Gives the "I'm thinking about X…" feeling the
           kilocode-style inline reasoning does. */}
      {!open && streaming && text.length > 0 && (
        <div className="border-af-hairline text-description-muted text-af-caption border-t px-3 py-1.5 leading-[1.45]">
          <StreamingPreview text={text} />
        </div>
      )}
      {open && text.length > 0 && (
        <div className="border-af-hairline text-weak animate-af-slide-down text-af-body max-h-[400px] overflow-y-auto whitespace-pre-wrap border-t px-3 py-2">
          {text}
        </div>
      )}
    </div>
  );
}

/**
 * Render the last 2 non-empty lines of the reasoning text as a dim
 * preview. Keeping it 2 lines avoids the preview fighting the main
 * chat content for vertical real estate while still being enough to
 * read at a glance.
 *
 * The `whitespace-pre-wrap` on a pre-styled div would preserve long
 * trailing whitespace the model sometimes emits; we trim to keep the
 * preview neat.
 */
function StreamingPreview({ text }: { text: string }) {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .slice(-2);
  if (lines.length === 0) return null;
  return (
    <div className="flex flex-col gap-0.5">
      {lines.map((line, i) => (
        <span
          key={i}
          className="truncate italic"
          style={{ opacity: i === lines.length - 1 ? 1 : 0.7 }}
        >
          {line}
        </span>
      ))}
    </div>
  );
}
