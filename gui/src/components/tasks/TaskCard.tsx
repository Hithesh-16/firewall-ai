/**
 * TaskCard — displays a single task's status, progress, and controls.
 * Uses theme-mapped colors. Matches ScanResultBanner pattern.
 */

import { useCallback } from "react";

interface TaskProgress {
  toolUseCount: number;
  inputTokens: number;
  outputTokens: number;
}

interface Task {
  id: string;
  type: string;
  status: string;
  description: string;
  progress: TaskProgress | null;
  error: string | null;
  resultSummary: string | null;
  startedAt: number;
  completedAt: number | null;
}

interface TaskCardProps {
  task: Task;
  onKill?: (taskId: string) => void;
  onAcknowledge?: (taskId: string) => void;
}

const STATUS_STYLES: Record<
  string,
  { bg: string; text: string; icon: string }
> = {
  pending: { bg: "bg-badge/30", text: "text-description", icon: "\u23F3" },
  running: { bg: "bg-info/10", text: "text-info", icon: "\u25B6\uFE0F" },
  completed: { bg: "bg-success/10", text: "text-success", icon: "\u2705" },
  failed: { bg: "bg-error/10", text: "text-error", icon: "\u274C" },
  killed: { bg: "bg-warning/10", text: "text-warning", icon: "\u23F9\uFE0F" },
  expired: {
    bg: "bg-description/10",
    text: "text-description-muted",
    icon: "\u23F0",
  },
};

export function TaskCard({ task, onKill, onAcknowledge }: TaskCardProps) {
  const style = STATUS_STYLES[task.status] ?? STATUS_STYLES.pending;
  const isActive = task.status === "pending" || task.status === "running";
  const elapsed = task.completedAt
    ? Math.round((task.completedAt - task.startedAt) / 1000)
    : Math.round((Date.now() - task.startedAt) / 1000);

  const handleKill = useCallback(() => {
    onKill?.(task.id);
  }, [task.id, onKill]);

  const handleAck = useCallback(() => {
    onAcknowledge?.(task.id);
  }, [task.id, onAcknowledge]);

  return (
    <div
      className={`border-border rounded-lg border p-3 ${style.bg} transition-all duration-200`}
    >
      {/* Header */}
      <div className="mb-1 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm">{style.icon}</span>
          <span className={`text-xs font-semibold uppercase ${style.text}`}>
            {task.status}
          </span>
          <span className="text-2xs text-description-muted font-mono">
            {task.id}
          </span>
        </div>
        <span className="text-2xs text-description-muted">{elapsed}s</span>
      </div>

      {/* Description */}
      <p className="text-foreground mb-2 text-sm">{task.description}</p>

      {/* Progress (if running) */}
      {task.progress && isActive && (
        <div className="text-2xs text-description-muted mb-2 flex gap-3">
          <span>Tools: {task.progress.toolUseCount}</span>
          <span>In: {task.progress.inputTokens}</span>
          <span>Out: {task.progress.outputTokens}</span>
        </div>
      )}

      {/* Error (if failed) */}
      {task.error && (
        <p className="text-error bg-error/5 mb-2 rounded p-2 text-xs">
          {task.error}
        </p>
      )}

      {/* Result (if completed) */}
      {task.resultSummary && (
        <p className="text-success bg-success/5 mb-2 rounded p-2 text-xs">
          {task.resultSummary}
        </p>
      )}

      {/* Actions */}
      <div className="mt-1 flex gap-2">
        {isActive && onKill && (
          <button
            onClick={handleKill}
            className="text-2xs border-error/30 text-error hover:bg-error/10 rounded border px-2 py-1 transition-colors"
          >
            Kill
          </button>
        )}
        {!isActive && task.status !== "expired" && onAcknowledge && (
          <button
            onClick={handleAck}
            className="text-2xs border-border text-description hover:bg-list-hover rounded border px-2 py-1 transition-colors"
          >
            Dismiss
          </button>
        )}
      </div>
    </div>
  );
}
