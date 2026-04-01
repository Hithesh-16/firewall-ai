import { useAppSelector } from "../../redux/hooks";

/** Shows session-level token + cost totals. Placed in chat header. */
export function SessionCostBadge() {
  const { totalTokens, totalCost } = useAppSelector(
    (s) => s.security.sessionStats,
  );

  if (totalTokens === 0) return null;

  const formattedCost =
    totalCost < 0.01
      ? `$${totalCost.toFixed(4)}`
      : `$${totalCost.toFixed(2)}`;

  return (
    <span
      className="text-xs text-description font-mono px-2 py-0.5 rounded bg-secondary-background"
      title={`Session: ${totalTokens.toLocaleString()} tokens, ${formattedCost}`}
    >
      {totalTokens.toLocaleString()} tok &middot; {formattedCost}
    </span>
  );
}

/** Shows per-message token + cost. Attached to individual assistant messages. */
export function MessageCostBadge({
  tokens,
  cost,
}: {
  tokens?: number;
  cost?: number;
}) {
  if (!tokens) return null;

  const formattedCost = cost
    ? cost < 0.01
      ? `$${cost.toFixed(4)}`
      : `$${cost.toFixed(2)}`
    : null;

  return (
    <span className="text-xs text-description font-mono">
      {tokens.toLocaleString()} tok
      {formattedCost && <> &middot; {formattedCost}</>}
    </span>
  );
}
