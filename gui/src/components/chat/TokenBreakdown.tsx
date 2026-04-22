import {
  ArrowDownIcon,
  ArrowUpIcon,
  CpuChipIcon,
} from "@heroicons/react/24/outline";
import { useAppSelector } from "../../redux/hooks";

/**
 * Fine-grained token breakdown strip (kilocode-parity).
 *
 * Each column is auto-hidden when its value is 0 so early in a
 * session the strip collapses to nothing instead of showing "in: 0
 * · out: 0 · …".
 *
 *   ↑ 1.2K   — prompt/input tokens
 *   ↓ 340    — completion/output tokens
 *   ↑ cache 820 — cache-write (more expensive than input)
 *   ↓ cache 3.4K (green) — cache-read (10% of input cost)
 *   🧠 128  — reasoning tokens
 */
function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

export function TokenBreakdown() {
  const s = useAppSelector((st) => st.security.sessionStats);
  const {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    reasoningTokens,
  } = s;

  const hasAny =
    inputTokens > 0 ||
    outputTokens > 0 ||
    cacheReadTokens > 0 ||
    cacheWriteTokens > 0 ||
    reasoningTokens > 0;
  if (!hasAny) return null;

  // P4 polish: each non-zero field becomes a chip with subtle raised
  // surface, making the breakdown visually scannable rather than a
  // wall of same-weight text. Cache-read chip gets an accent glow +
  // filled emerald arrow so users instantly see "caching worked".
  return (
    <div className="text-af-caption flex flex-wrap items-center gap-1.5 tabular-nums">
      <span className="text-strong pr-1 font-semibold">Tokens</span>
      {inputTokens > 0 && (
        <Chip title="Prompt / input tokens">
          <ArrowUpIcon className="text-weak h-3 w-3" />
          {fmt(inputTokens)}
        </Chip>
      )}
      {outputTokens > 0 && (
        <Chip title="Completion / output tokens">
          <ArrowDownIcon className="text-weak h-3 w-3" />
          {fmt(outputTokens)}
        </Chip>
      )}
      {cacheWriteTokens > 0 && (
        <Chip title="Cache write — stores a reusable prefix (1.25x or 2x input cost)">
          <ArrowUpIcon className="text-af-info h-3 w-3" />
          <span className="text-weak">cache</span>
          <span>{fmt(cacheWriteTokens)}</span>
        </Chip>
      )}
      {cacheReadTokens > 0 && (
        <Chip
          title="Cache read — served at the discounted cache-read rate"
          tone="accent"
        >
          <ArrowDownIcon className="text-af-accent h-3 w-3" />
          <span className="text-weak">cache</span>
          <span className="text-af-accent font-semibold">
            {fmt(cacheReadTokens)}
          </span>
        </Chip>
      )}
      {reasoningTokens > 0 && (
        <Chip title="Thinking / reasoning tokens">
          <CpuChipIcon className="text-af-info h-3 w-3" />
          {fmt(reasoningTokens)}
        </Chip>
      )}
    </div>
  );
}

function Chip({
  children,
  title,
  tone = "default",
}: {
  children: React.ReactNode;
  title: string;
  tone?: "default" | "accent";
}) {
  const bg =
    tone === "accent"
      ? "bg-af-accent/10 border-af-accent/30"
      : "bg-af-surface-raised/40 border-af-hairline";
  return (
    <span
      className={`text-weak inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 ${bg}`}
      title={title}
    >
      {children}
    </span>
  );
}
