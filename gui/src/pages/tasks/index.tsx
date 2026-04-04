/**
 * Tasks Page — dashboard for viewing and managing running/completed tasks.
 * Web-only route: /tasks
 */

import { useState, useEffect, useCallback } from "react";
import { TaskList } from "../../components/tasks/TaskList";
import { useProxyApi } from "../../hooks/useProxyApi";

type FilterType = "all" | "active" | "completed" | "failed";

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

export default function TasksPage() {
  const api = useProxyApi();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [filter, setFilter] = useState<FilterType>("all");
  const [loading, setLoading] = useState(true);

  const fetchTasks = useCallback(async () => {
    try {
      const activeOnly = filter === "active";
      const data = await api.get<{ tasks: Task[] }>(
        `/api/tasks${activeOnly ? "?active=true" : ""}`,
      );
      setTasks(data.tasks);
    } catch {
      // Proxy may not be running
    } finally {
      setLoading(false);
    }
  }, [api, filter]);

  useEffect(() => {
    fetchTasks();
    // Poll every 3 seconds for active tasks
    const interval = setInterval(fetchTasks, 3000);
    return () => clearInterval(interval);
  }, [fetchTasks]);

  const handleKill = useCallback(
    async (taskId: string) => {
      try {
        await api.del(`/api/tasks/${taskId}`);
        fetchTasks();
      } catch {
        // ignore
      }
    },
    [api, fetchTasks],
  );

  const handleAck = useCallback(
    async (taskId: string) => {
      try {
        await api.post(`/api/tasks/${taskId}/ack`, {});
        fetchTasks();
      } catch {
        // ignore
      }
    },
    [api, fetchTasks],
  );

  const activeCount = tasks.filter(
    (t) => t.status === "pending" || t.status === "running",
  ).length;

  return (
    <div className="mx-auto max-w-3xl p-4">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-foreground text-lg font-semibold">Tasks</h2>
          <p className="text-description-muted text-xs">
            {activeCount} active, {tasks.length} total
          </p>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="border-border mb-4 flex gap-1 border-b pb-2">
        {(["all", "active", "completed", "failed"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded px-3 py-1 text-xs capitalize transition-colors ${
              filter === f
                ? "bg-list-active text-list-active-foreground"
                : "text-description hover:bg-list-hover"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-description-muted py-8 text-center text-sm">
          Loading tasks...
        </div>
      ) : (
        <TaskList
          tasks={tasks}
          filter={filter}
          onKill={handleKill}
          onAcknowledge={handleAck}
          emptyMessage={
            filter === "active"
              ? "No active tasks. Agents will appear here when running."
              : "No tasks yet."
          }
        />
      )}
    </div>
  );
}
