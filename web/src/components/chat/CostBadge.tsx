import { cn } from "../../utils/cn";
import { formatCost, formatTokens } from "../../utils/format";

interface CostBadgeProps {
  estimatedCost?: number;
  inputTokens?: number;
  outputTokens?: number;
  className?: string;
}

export function CostBadge({
  estimatedCost,
  inputTokens,
  outputTokens,
  className,
}: CostBadgeProps) {
  const totalTokens = (inputTokens ?? 0) + (outputTokens ?? 0);

  if (!estimatedCost && totalTokens === 0) return null;

  return (
    <span
      className={cn(
        "text-description-muted inline-flex items-center gap-1.5 text-[11px]",
        className,
      )}
    >
      {estimatedCost !== undefined && estimatedCost > 0 && (
        <span>{formatCost(estimatedCost)}</span>
      )}
      {totalTokens > 0 && <span>{formatTokens(totalTokens)} tokens</span>}
    </span>
  );
}
