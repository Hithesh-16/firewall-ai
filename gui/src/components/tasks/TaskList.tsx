/**
 * TaskList — displays a list of tasks with filtering.
 */

import { TaskCard } from "./TaskCard";

interface Task {
  id: string;
  type: string;
  status: string;
  description: string;
  progress: {
    toolUseCount: number;
    inputTokens: number;
    outputTokens: number;
  } | null;
  error: string | null;
  resultSummary: string | null;
  startedAt: number;
  completedAt: number | null;
}

interface TaskListProps {
  tasks: Task[];
  filter?: "all" | "active" | "completed" | "failed";
  onKill?: (taskId: string) => void;
  onAcknowledge?: (taskId: string) => void;
  emptyMessage?: string;
}

export function TaskList({
  tasks,
  filter = "all",
  onKill,
  onAcknowledge,
  emptyMessage = "No tasks yet.",
}: TaskListProps) {
  const filtered = tasks.filter((t) => {
    switch (filter) {
      case "active":
        return t.status === "pending" || t.status === "running";
      case "completed":
        return t.status === "completed";
      case "failed":
        return t.status === "failed" || t.status === "killed";
      default:
        return true;
    }
  });

  if (filtered.length === 0) {
    return (
      <div className="text-description-muted py-8 text-center text-sm">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {filtered.map((task) => (
        <TaskCard
          key={task.id}
          task={task}
          onKill={onKill}
          onAcknowledge={onAcknowledge}
        />
      ))}
    </div>
  );
}
