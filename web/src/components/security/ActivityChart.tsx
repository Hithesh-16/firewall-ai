interface DayEntry {
  date: string;
  count: number;
  blocked?: number;
  redacted?: number;
}

interface ActivityChartProps {
  data: DayEntry[];
  height?: number;
}

export function ActivityChart({ data, height = 180 }: ActivityChartProps) {
  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center" style={{ height }}>
        <p className="text-description-muted text-sm">No activity data</p>
      </div>
    );
  }

  // Sort chronologically and take last 14 days max
  const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date)).slice(-14);

  const maxCount = Math.max(...sorted.map((d) => d.count), 1);
  const barAreaHeight = height - 44; // reserve space for labels

  return (
    <div className="flex items-end gap-1.5" style={{ height }}>
      {sorted.map((entry) => {
        const barH = Math.max((entry.count / maxCount) * barAreaHeight, 4);
        const blockedH = entry.blocked
          ? Math.max((entry.blocked / maxCount) * barAreaHeight, 2)
          : 0;
        const redactedH = entry.redacted
          ? Math.max((entry.redacted / maxCount) * barAreaHeight, 2)
          : 0;
        const allowedH = Math.max(barH - blockedH - redactedH, 0);

        return (
          <div key={entry.date} className="flex flex-1 flex-col items-center gap-1">
            {/* Count label */}
            <span className="text-foreground text-[10px] font-medium tabular-nums">
              {entry.count > 0 ? entry.count : ""}
            </span>
            {/* Stacked bar */}
            <div
              className="flex w-full min-w-[10px] flex-col-reverse overflow-hidden rounded-t"
              style={{ height: barH }}
              title={`${entry.date}: ${entry.count} scans${entry.blocked ? `, ${entry.blocked} blocked` : ""}${entry.redacted ? `, ${entry.redacted} redacted` : ""}`}
            >
              {/* Allowed (bottom — green) */}
              {allowedH > 0 && (
                <div className="w-full bg-success/80" style={{ height: allowedH }} />
              )}
              {/* Redacted (middle — yellow) */}
              {redactedH > 0 && (
                <div className="w-full bg-warning/80" style={{ height: redactedH }} />
              )}
              {/* Blocked (top — red) */}
              {blockedH > 0 && <div className="w-full bg-error/80" style={{ height: blockedH }} />}
              {/* Fallback: if no breakdown data, show solid primary bar */}
              {!entry.blocked && !entry.redacted && (
                <div className="w-full bg-primary" style={{ height: barH }} />
              )}
            </div>
            {/* Date label */}
            <span className="text-description-muted text-[9px] tabular-nums">
              {entry.date.slice(5)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
