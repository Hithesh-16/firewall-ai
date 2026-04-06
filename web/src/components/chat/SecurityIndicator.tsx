import { cn } from "../../utils/cn";

interface SecurityIndicatorProps {
  action: string;
  riskScore: number;
  secretsFound?: number;
  piiFound?: number;
  className?: string;
}

export function SecurityIndicator({
  action,
  riskScore,
  secretsFound = 0,
  piiFound = 0,
  className,
}: SecurityIndicatorProps) {
  const redactedCount = secretsFound + piiFound;

  let dotColor = "bg-success";
  let label = "Clean";
  let variant: "success" | "warning" | "error" = "success";

  if (action === "BLOCK") {
    dotColor = "bg-error";
    label = "Blocked";
    variant = "error";
  } else if (action === "REDACT") {
    dotColor = "bg-warning";
    label = `Redacted (${redactedCount})`;
    variant = "warning";
  }

  const variantTextClass = {
    success: "text-success",
    warning: "text-warning",
    error: "text-error",
  };

  return (
    <div
      className={cn(
        "group relative inline-flex items-center gap-1.5",
        className,
      )}
      title={`Risk: ${riskScore}/100`}
    >
      <span className={cn("h-2 w-2 rounded-full", dotColor)} />
      <span className={cn("text-xs", variantTextClass[variant])}>{label}</span>

      {/* Hover tooltip with risk score */}
      <div className="bg-secondary text-foreground pointer-events-none absolute bottom-full left-1/2 mb-1.5 -translate-x-1/2 rounded-md px-2.5 py-1 text-xs opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
        Risk: {riskScore}/100
        <div className="border-t-secondary absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent" />
      </div>
    </div>
  );
}
