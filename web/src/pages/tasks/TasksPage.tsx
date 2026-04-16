import { useState, useEffect, useCallback } from "react";
import {
  QueueListIcon,
  StopIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
} from "@heroicons/react/24/outline";
import { apiClient } from "../../api/client";
import { ENDPOINTS } from "../../api/endpoints";
import { formatRelativeTime, formatTokens } from "../../utils/format";
import { Card } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { UnderlineTabs } from "../../components/ui/UnderlineTabs";
import { EmptyState } from "../../components/ui/EmptyState";
import { ErrorBanner } from "../../components/ui/ErrorBanner";
import { LoadingSpinner } from "../../components/ui/LoadingSpinner";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

interface Task {
  id: string;
  type: string;
  description: string;
  status: string;
  progress?: {
    toolUseCount?: number;
    tokens?: number;
    activities?: string[];
  };
  model?: string;
  error?: string;
  result?: string;
  createdAt?: string;
  startedAt?: string;
  completedAt?: string;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

const FILTER_TABS = [
  { id: "all", label: "All" },
  { id: "active", label: "Active" },
  { id: "completed", label: "Completed" },
  { id: "failed", label: "Failed" },
];

function statusVariant(status: string): "success" | "warning" | "error" | "info" | "default" {
  switch (status) {
    case "running":
      return "success";
    case "pending":
      return "warning";
    case "failed":
    case "killed":
      return "error";
    case "completed":
      return "info";
    default:
      return "default";
  }
}

function typeColor(type: string): "info" | "warning" | "success" | "default" {
  switch (type) {
    case "local_agent":
    case "background_agent":
    case "sub_agent":
      return "info";
    case "bash":
      return "warning";
    case "mcp_tool":
      return "success";
    default:
      return "default";
  }
}

/* ------------------------------------------------------------------ */
/*  TasksPage                                                         */
/* ------------------------------------------------------------------ */

export function TasksPage() {
  const [filter, setFilter] = useState("all");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [killTarget, setKillTarget] = useState<string | null>(null);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let url = `${ENDPOINTS.tasks.list}?limit=50`;
      if (filter === "active") url += "&active=true";
      else if (filter === "completed") url += "&status=completed";
      else if (filter === "failed") url += "&status=failed";
      const data = await apiClient.get<Task[] | { tasks: Task[] }>(url);
      const list = Array.isArray(data) ? data : (data.tasks ?? []);
      setTasks(list);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load tasks");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  // Auto-refresh for active tasks
  useEffect(() => {
    if (filter !== "all" && filter !== "active") return;
    const hasActive = tasks.some((t) => t.status === "running" || t.status === "pending");
    if (!hasActive) return;
    const interval = setInterval(fetchTasks, 5000);
    return () => clearInterval(interval);
  }, [filter, tasks, fetchTasks]);

  async function handleKill(id: string) {
    try {
      await apiClient.del(ENDPOINTS.tasks.one(id));
      setKillTarget(null);
      fetchTasks();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to kill task");
    }
  }

  async function handleAck(id: string) {
    try {
      await apiClient.post(ENDPOINTS.tasks.ack(id));
      fetchTasks();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to acknowledge task");
    }
  }

  const activeCount = tasks.filter((t) => t.status === "running" || t.status === "pending").length;

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
      <div className="flex items-center gap-3">
        <QueueListIcon className="text-primary h-6 w-6" />
        <h1 className="text-foreground text-xl font-bold">Tasks</h1>
        {activeCount > 0 && <Badge variant="info">{activeCount} active</Badge>}
      </div>

      <UnderlineTabs tabs={FILTER_TABS} activeTab={filter} onChange={setFilter} />

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {loading ? (
        <div className="flex justify-center py-12">
          <LoadingSpinner size="lg" />
        </div>
      ) : tasks.length === 0 ? (
        <EmptyState
          icon={<QueueListIcon className="h-10 w-10" />}
          title="No Tasks"
          description={
            filter === "all" ? "No tasks have been created yet." : `No ${filter} tasks found.`
          }
        />
      ) : (
        <div className="space-y-3">
          {tasks.map((task) => {
            const isExpanded = expanded === task.id;
            const isRunning = task.status === "running" || task.status === "pending";
            const isDone = task.status === "completed" || task.status === "failed";

            return (
              <Card key={task.id} className="space-y-2">
                <div
                  className="flex cursor-pointer items-start justify-between"
                  onClick={() => setExpanded(isExpanded ? null : task.id)}
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={typeColor(task.type)}>{task.type}</Badge>
                      <Badge variant={statusVariant(task.status)}>{task.status}</Badge>
                    </div>
                    <p className="text-foreground truncate text-sm font-medium">
                      {task.description}
                    </p>
                    <p className="text-description-muted text-xs">
                      {task.startedAt
                        ? `Started ${formatRelativeTime(task.startedAt)}`
                        : task.createdAt
                          ? `Created ${formatRelativeTime(task.createdAt)}`
                          : ""}
                      {task.completedAt &&
                        ` \u00b7 Completed ${formatRelativeTime(task.completedAt)}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {isRunning && (
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setKillTarget(task.id);
                        }}
                      >
                        <StopIcon className="h-3.5 w-3.5" />
                        Kill
                      </Button>
                    )}
                    {isDone && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleAck(task.id);
                        }}
                      >
                        <CheckIcon className="h-3.5 w-3.5" />
                        Ack
                      </Button>
                    )}
                    {isExpanded ? (
                      <ChevronUpIcon className="text-description h-4 w-4" />
                    ) : (
                      <ChevronDownIcon className="text-description h-4 w-4" />
                    )}
                  </div>
                </div>

                {/* Progress bar */}
                {isRunning && task.progress && typeof task.progress.tokens === "number" && (
                  <div className="bg-secondary h-1.5 w-full rounded-full">
                    <div
                      className="bg-primary h-1.5 rounded-full transition-all"
                      style={{
                        width: `${Math.min(((task.progress.toolUseCount ?? 0) / 20) * 100, 100)}%`,
                      }}
                    />
                  </div>
                )}

                {/* Expanded detail */}
                {isExpanded && (
                  <div className="border-border mt-2 space-y-2 border-t pt-2">
                    {task.model && (
                      <p className="text-description text-xs">
                        Model: <span className="text-foreground">{task.model}</span>
                      </p>
                    )}
                    {task.progress && (
                      <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
                        {typeof task.progress.toolUseCount === "number" && (
                          <div>
                            <span className="text-description">Tool calls:</span>{" "}
                            <span className="text-foreground">{task.progress.toolUseCount}</span>
                          </div>
                        )}
                        {typeof task.progress.tokens === "number" && (
                          <div>
                            <span className="text-description">Tokens:</span>{" "}
                            <span className="text-foreground">
                              {formatTokens(task.progress.tokens)}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                    {task.progress?.activities && task.progress.activities.length > 0 && (
                      <div className="text-xs">
                        <p className="text-description">Recent activity:</p>
                        <ul className="text-foreground mt-1 list-inside list-disc space-y-0.5">
                          {task.progress.activities.slice(-5).map((a, i) => (
                            <li key={i}>{a}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {task.error && (
                      <div className="bg-error/10 text-error rounded-md px-3 py-2 text-xs">
                        {task.error}
                      </div>
                    )}
                    {task.result && (
                      <div className="bg-success/10 text-success rounded-md px-3 py-2 text-xs">
                        {task.result}
                      </div>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={killTarget !== null}
        onClose={() => setKillTarget(null)}
        onConfirm={() => killTarget && handleKill(killTarget)}
        title="Kill Task"
        message="Are you sure you want to kill this task? This cannot be undone."
        confirmLabel="Kill"
        variant="danger"
      />
    </div>
  );
}
