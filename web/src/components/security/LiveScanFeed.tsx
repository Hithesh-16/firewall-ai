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

  const filtered = scans.filter((s) => filter === "all" || s.action === filter).slice(0, maxItems);

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
      {/* Filter tabs */}
      <div className="flex gap-2">
        {filterOptions.map((opt) => (
          <button
            key={opt}
            onClick={() => setFilter(opt)}
            className={cn(
              "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              filter === opt
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-secondary-foreground hover:bg-secondary-hover",
            )}
          >
            {opt === "all" ? "All" : opt}
          </button>
        ))}
        <span className="text-description-muted ml-auto self-center text-xs">
          {filtered.length} event{filtered.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Scan list */}
      <div
        ref={listRef}
        onScroll={handleScroll}
        className="max-h-[520px] space-y-1 overflow-y-auto"
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
              <span className="text-description-muted shrink-0 font-mono text-[11px]">
                {new Date(scan.timestamp).toLocaleTimeString()}
              </span>
              <Badge variant={actionVariant[scan.action] ?? "default"}>{scan.action}</Badge>
              {scan.model && (
                <span className="text-foreground truncate text-xs font-medium">{scan.model}</span>
              )}
              {scan.provider && (
                <span className="text-description-muted truncate text-xs">via {scan.provider}</span>
              )}
              <span className="text-description text-xs">Risk: {scan.riskScore}</span>
              {(scan.secretsFound ?? 0) > 0 && (
                <span className="text-error shrink-0 text-xs">
                  {scan.secretsFound} secret{scan.secretsFound > 1 ? "s" : ""}
                </span>
              )}
              {(scan.piiFound ?? 0) > 0 && (
                <span className="text-warning shrink-0 text-xs">{scan.piiFound} PII</span>
              )}
              {scan.responseTimeMs != null && (
                <span className="text-description-muted ml-auto shrink-0 text-[11px]">
                  {scan.responseTimeMs}ms
                </span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
