import { cn } from "../../utils/cn";

interface Segment {
  label: string;
  value: number;
  colorClass: string;
  stroke: string;
}

interface DonutChartProps {
  segments: Segment[];
  size?: number;
  strokeWidth?: number;
}

export function DonutChart({ segments, size = 180, strokeWidth = 28 }: DonutChartProps) {
  const center = size / 2;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const total = segments.reduce((sum, s) => sum + s.value, 0);

  if (total === 0) {
    return (
      <div className="flex flex-col items-center gap-3">
        <svg width={size} height={size}>
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            className="text-secondary"
          />
        </svg>
        <p className="text-description-muted text-sm">No data</p>
      </div>
    );
  }

  let offset = 0;
  const arcs = segments.map((seg) => {
    const pct = seg.value / total;
    const dashLength = pct * circumference;
    const gap = circumference - dashLength;
    const currentOffset = offset;
    offset += dashLength;
    return { ...seg, dashLength, gap, currentOffset, pct };
  });

  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative">
        <svg width={size} height={size} className="-rotate-90">
          {arcs.map((arc) => (
            <circle
              key={arc.label}
              cx={center}
              cy={center}
              r={radius}
              fill="none"
              stroke={arc.stroke}
              strokeWidth={strokeWidth}
              strokeDasharray={`${arc.dashLength} ${arc.gap}`}
              strokeDashoffset={-arc.currentOffset}
              className="transition-all duration-700 ease-out"
            />
          ))}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-foreground text-2xl font-bold">{total.toLocaleString()}</span>
          <span className="text-description text-xs">Total</span>
        </div>
      </div>

      <div className="flex flex-wrap justify-center gap-x-4 gap-y-1">
        {arcs.map((arc) => (
          <div key={arc.label} className="flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: arc.stroke }}
            />
            <span className={cn("text-xs font-medium", arc.colorClass)}>{arc.label}</span>
            <span className="text-description-muted text-xs">
              {arc.value.toLocaleString()} ({Math.round(arc.pct * 100)}%)
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
