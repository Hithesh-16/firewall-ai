interface PreflightPanelProps {
  scanResult: {
    action: string;
    secretsFound: number;
    piiFound: number;
    riskScore: number;
    reasons?: string[];
  };
  onProceed: () => void;
  onRedact: () => void;
  onCancel: () => void;
}

const actionColors: Record<string, string> = {
  BLOCK: "bg-error/10 text-error border-error/30",
  REDACT: "bg-warning/10 text-warning border-warning/30",
  ALLOW: "bg-success/10 text-success border-success/30",
};

export function PreflightPanel({
  scanResult,
  onProceed,
  onRedact,
  onCancel,
}: PreflightPanelProps) {
  const colorClass =
    actionColors[scanResult.action] || actionColors.ALLOW;

  return (
    <div className="mx-2 mb-2 rounded-lg border border-border bg-input p-3">
      {/* Header */}
      <div className="mb-2 flex items-center gap-2">
        <span className="text-sm font-semibold text-foreground">
          Pre-flight Security Check
        </span>
        <span
          className={`rounded px-1.5 py-0.5 text-xs font-bold border ${colorClass}`}
        >
          {scanResult.action}
        </span>
      </div>

      {/* Stats grid */}
      <div className="mb-2 grid grid-cols-3 gap-2 text-xs">
        <div className="rounded bg-background p-1.5 text-center">
          <div
            className={`font-bold ${scanResult.secretsFound > 0 ? "text-error" : "text-foreground"}`}
          >
            {scanResult.secretsFound}
          </div>
          <div className="text-description">Secrets</div>
        </div>
        <div className="rounded bg-background p-1.5 text-center">
          <div
            className={`font-bold ${scanResult.piiFound > 0 ? "text-warning" : "text-foreground"}`}
          >
            {scanResult.piiFound}
          </div>
          <div className="text-description">PII</div>
        </div>
        <div className="rounded bg-background p-1.5 text-center">
          <div
            className={`font-bold ${scanResult.riskScore >= 70 ? "text-error" : scanResult.riskScore >= 30 ? "text-warning" : "text-success"}`}
          >
            {scanResult.riskScore}
          </div>
          <div className="text-description">Risk</div>
        </div>
      </div>

      {/* Reasons */}
      {scanResult.reasons && scanResult.reasons.length > 0 && (
        <div className="mb-2 text-xs text-description">
          {scanResult.reasons.map((r, i) => (
            <div key={i} className="truncate">
              {r}
            </div>
          ))}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2">
        {scanResult.action !== "BLOCK" && (
          <button
            onClick={onRedact}
            className="flex-1 rounded bg-warning/20 text-warning border border-warning/30 px-2 py-1 text-xs font-medium hover:bg-warning/30 focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:outline-none"
          >
            Send Redacted
          </button>
        )}
        {scanResult.action !== "BLOCK" && (
          <button
            onClick={onProceed}
            className="flex-1 rounded bg-input px-2 py-1 text-xs font-medium text-foreground border border-border hover:bg-background focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:outline-none"
          >
            Send Anyway
          </button>
        )}
        <button
          onClick={onCancel}
          className="flex-1 rounded bg-input px-2 py-1 text-xs font-medium text-description border border-border hover:bg-background focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:outline-none"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
