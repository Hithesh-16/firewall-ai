import { IndexingStatus } from "core";
import { ToolTip } from "../../../../components/gui/Tooltip";

interface StatusIndicatorProps {
  status?: IndexingStatus["status"];
  className?: string;
  size?: number;
  hoverMessage?: string;
}

const STATUS_TO_COLOR: Record<IndexingStatus["status"], string> = {
  indexing: "bg-warning",
  paused: "bg-info",
  complete: "bg-success",
  aborted: "bg-secondary",
  pending: "bg-description-muted",
  failed: "bg-error",
};

export function StatusIndicator({
  status,
  className = "",
  size = 2,
  hoverMessage,
}: StatusIndicatorProps) {
  if (!status) return null;

  return (
    <ToolTip hidden={!hoverMessage} content={hoverMessage}>
      <div
        className={`h-${size} w-${size} rounded-full ${STATUS_TO_COLOR[status]} ${
          status === "indexing" ? "animate-pulse" : ""
        } ${className}`}
      />
    </ToolTip>
  );
}
