interface RiskGaugeProps {
  score: number;
  size?: "sm" | "md" | "lg";
  label?: string;
}

const SIZES = {
  sm: { width: 48, stroke: 4, fontSize: "text-xs" },
  md: { width: 72, stroke: 5, fontSize: "text-sm" },
  lg: { width: 96, stroke: 6, fontSize: "text-lg" },
};

function getTextClass(score: number): string {
  if (score >= 60) return "text-error";
  if (score >= 30) return "text-warning";
  return "text-success";
}

export function RiskGauge({ score, size = "md", label }: RiskGaugeProps) {
  const config = SIZES[size];
  const radius = (config.width - config.stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clampedScore = Math.min(100, Math.max(0, score));
  const offset = circumference - (clampedScore / 100) * circumference;

  return (
    <div className="flex flex-col items-center gap-1">
      <svg
        width={config.width}
        height={config.width}
        className="-rotate-90"
        role="img"
        aria-label={`Risk score: ${clampedScore.toFixed(0)} out of 100`}
      >
        {/* Background circle */}
        <circle
          cx={config.width / 2}
          cy={config.width / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={config.stroke}
          className="text-border"
        />
        {/* Score arc — uses currentColor via text-error/warning/success */}
        <circle
          cx={config.width / 2}
          cy={config.width / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={config.stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className={getTextClass(clampedScore)}
          style={{ transition: "stroke-dashoffset 0.8s ease-out" }}
        />
      </svg>
      <span
        className={`${config.fontSize} font-bold ${getTextClass(clampedScore)}`}
        style={{ marginTop: -(config.width / 2 + 8), position: "relative" }}
      >
        {clampedScore.toFixed(0)}
      </span>
      {label && (
        <p className="text-xs text-description mt-1">{label}</p>
      )}
    </div>
  );
}
