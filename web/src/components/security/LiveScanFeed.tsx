import { useEffect, useRef, useState } from "react";
import { cn } from "../../utils/cn";
import { Badge } from "../ui/Badge";
import type { ScanResult } from "../../api/types";

interface LiveScanFeedProps {
  scans: ScanResult[];
  maxItems?: number;
}

const actionVariant: Record<string, "success" | "warning" | "error"> = {
  ALLOW: "success",
  REDACT: "warning",
  BLOCK: "error",
};

const filterOptions = ["all", "BLOCK", "REDACT", "ALLOW"] as const;

export function LiveScanFeed({ scans, maxItems = 50 }: LiveScanFeedProps) {
  const [filter, setFilter] = useState<string>("all");
  const listRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  const filtered = scans
    .filter((s) => filter === "all" || s.action === filter)
    .slice(0, maxItems);

  useEffect(() => {
    if (autoScrollRef.current && listRef.current) {
      listRef.current.scrollTop = 0;
    }
  }, [filtered.length]);

  function handleScroll() {
    if (!listRef.current) return;
    autoScrollRef.current = listRef.current.scrollTop < 20;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-2">
        {filterOptions.map((opt) => (
          <button
            key={opt}
            onClick={() => setFilter(opt)}
            className={cn(
              "rounded-md px-3 py-1 text-xs font-medium transition-colors",
              filter === opt
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-secondary-foreground hover:bg-secondary-hover",
            )}
          >
            {opt === "all" ? "All" : opt}
          </button>
        ))}
      </div>

      <div
        ref={listRef}
        onScroll={handleScroll}
        className="max-h-[480px] space-y-1 overflow-y-auto"
      >
        {filtered.length === 0 ? (
          <p className="text-description-muted py-8 text-center text-sm">
            No scan events to display
          </p>
        ) : (
          filtered.map((scan, i) => (
            <div
              key={`${scan.timestamp}-${i}`}
              className="border-border bg-editor flex items-center gap-3 rounded-md border px-3 py-2 text-sm"
            >
              <span className="text-description-muted shrink-0 font-mono text-xs">
                {new Date(scan.timestamp).toLocaleTimeString()}
              </span>
              {scan.model && (
                <span className="text-description truncate text-xs">
                  {scan.model}
                </span>
              )}
              <Badge variant={actionVariant[scan.action] ?? "default"}>
                {scan.action}
              </Badge>
              <span className="text-description text-xs">
                Risk: {scan.riskScore}
              </span>
              {scan.secretsFound > 0 && (
                <span className="text-error text-xs">
                  {scan.secretsFound} secret{scan.secretsFound > 1 ? "s" : ""}
                </span>
              )}
              {scan.piiFound > 0 && (
                <span className="text-warning text-xs">
                  {scan.piiFound} PII
                </span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
