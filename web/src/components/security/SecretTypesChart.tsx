import { cn } from "../../utils/cn";

interface SecretTypesChartProps {
  data: Record<string, number>;
  maxItems?: number;
}

export function SecretTypesChart({ data, maxItems = 8 }: SecretTypesChartProps) {
  const entries = Object.entries(data)
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxItems);

  if (entries.length === 0) {
    return (
      <div className="flex items-center justify-center py-8">
        <p className="text-description-muted text-sm">No detections</p>
      </div>
    );
  }

  const maxVal = Math.max(...entries.map(([, v]) => v), 1);

  return (
    <div className="space-y-2">
      {entries.map(([label, value]) => {
        const pct = (value / maxVal) * 100;
        const isHigh = value >= maxVal * 0.7;
        const isMed = value >= maxVal * 0.3;
        return (
          <div key={label} className="flex items-center gap-3">
            <span className="text-description w-36 shrink-0 truncate text-xs font-medium">
              {label}
            </span>
            <div className="bg-secondary relative h-4 flex-1 overflow-hidden rounded-full">
              <div
                className={cn(
                  "absolute inset-y-0 left-0 rounded-full transition-all duration-500",
                  isHigh ? "bg-error/80" : isMed ? "bg-warning/80" : "bg-primary/80",
                )}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="text-foreground w-10 shrink-0 text-right text-xs font-semibold">
              {value}
            </span>
          </div>
        );
      })}
    </div>
  );
}
