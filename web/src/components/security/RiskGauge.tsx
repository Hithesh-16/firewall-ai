import { cn } from "../../utils/cn";

interface RiskGaugeProps {
  score: number;
  grade: string;
  size?: number;
}

function getColor(score: number): string {
  if (score <= 30) return "text-success";
  if (score <= 60) return "text-warning";
  return "text-error";
}

function getStrokeColor(score: number): string {
  if (score <= 30) return "stroke-success";
  if (score <= 60) return "stroke-warning";
  return "stroke-error";
}

export function RiskGauge({ score, grade, size = 120 }: RiskGaugeProps) {
  const radius = (size - 12) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, score));
  const offset = circumference - (clamped / 100) * circumference;
  const center = size / 2;

  return (
    <div className="relative inline-flex items-center justify-center">
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="8"
          className="text-secondary"
        />
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className={cn(
            "transition-all duration-700 ease-out",
            getStrokeColor(clamped),
          )}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={cn("text-2xl font-bold", getColor(clamped))}>
          {clamped}
        </span>
        <span className={cn("text-sm font-semibold", getColor(clamped))}>
          {grade}
        </span>
      </div>
    </div>
  );
}
