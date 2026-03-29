import { useAppSelector } from "../../redux/hooks";

/**
 * Context Limit Warning — shown when session token usage approaches the context window limit.
 * Styled to match Claude's amber warning banner pattern.
 *
 * Renders above the input box alongside ScanResultBanner.
 * Appears when:
 *   - X-AF-Context-Overflow header was received (proxy advisory)
 *   - Session token usage exceeds 90% of estimated context window
 */

interface ContextLimitWarningProps {
  /** Context tokens used (from X-AF-Context-Tokens header) */
  contextTokens: number;
  /** Max context window (from X-AF-Context-Max header) */
  contextMax: number;
  /** Trigger new session */
  onNewSession?: () => void;
}

export function ContextLimitWarning({
  contextTokens,
  contextMax,
  onNewSession,
}: ContextLimitWarningProps) {
  const percentage = contextMax > 0 ? Math.round((contextTokens / contextMax) * 100) : 0;

  if (percentage < 85) return null;

  const isOverflow = percentage >= 100;

  return (
    <div
      className={`
        mx-2 mb-2
        flex items-center gap-2.5
        rounded-xl border
        px-4 py-2.5
        text-xs
        animate-in fade-in slide-in-from-top-2 duration-300
        ${isOverflow
          ? "border-error/30 bg-error/5 text-error shadow-[0_0_12px_rgba(239,68,68,0.1)]"
          : "border-warning/25 bg-warning/5 text-warning shadow-[0_0_10px_rgba(245,158,11,0.08)]"
        }
      `}
    >
      <span className="text-base flex-shrink-0">
        {isOverflow ? "\u26A0\uFE0F" : "\u26A0"}
      </span>

      <span className="flex-1">
        {isOverflow ? (
          <>
            Context window <strong className="font-semibold">exceeded</strong> ({contextTokens.toLocaleString()} / {contextMax.toLocaleString()} tokens).
            The provider may truncate your message.
          </>
        ) : (
          <>
            You{"'"}ve used{" "}
            <strong className="font-semibold">{percentage}%</strong>
            {" "}of this session{"'"}s context limit
            {" "}({contextTokens.toLocaleString()} / {contextMax.toLocaleString()}).
          </>
        )}
        {onNewSession && (
          <>
            {" "}
            <button
              onClick={onNewSession}
              className={`underline font-medium transition-colors ${
                isOverflow
                  ? "text-error hover:text-foreground"
                  : "text-warning hover:text-foreground"
              }`}
            >
              Start a new session
            </button>
          </>
        )}
      </span>
    </div>
  );
}

/**
 * Connected version — reads session stats from Redux.
 * Used when we don't have exact X-AF-Context-* headers but want to show
 * a general session usage warning based on accumulated token counts.
 */
export function SessionUsageWarning({
  estimatedContextWindow = 128_000,
  onNewSession,
}: {
  estimatedContextWindow?: number;
  onNewSession?: () => void;
}) {
  const totalTokens = useAppSelector(
    (s) => s.security.sessionStats.totalTokens,
  );

  return (
    <ContextLimitWarning
      contextTokens={totalTokens}
      contextMax={estimatedContextWindow}
      onNewSession={onNewSession}
    />
  );
}
