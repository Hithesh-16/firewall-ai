/**
 * CoordinatorView — Multi-agent dashboard showing coordinator sessions,
 * worker pool status, and result aggregation.
 * Uses theme-mapped colors. Matches AgentManagerPage pattern.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useProxyApi } from "../../hooks/useProxyApi";

// ── Types ──────────────────────────────────────────────────────

interface WorkerStatus {
  taskId: string;
  isRunning: boolean;
}

interface PoolStatus {
  total: number;
  running: number;
  completed: number;
  failed: number;
  killed: number;
  canSpawnMore: boolean;
}

interface CoordinatorSession {
  sessionId: string;
  userId: number;
  coordinatorTaskId: string;
  workerTaskIds: readonly string[];
  startedAt: number;
  status: "active" | "completed" | "failed";
}

interface WorkerResult {
  taskId: string;
  description: string;
  status: "completed" | "failed" | "killed" | "running" | "pending";
  resultSummary: string | null;
  error: string | null;
  durationMs: number;
}

interface CoordinatorViewProps {
  /** If provided, show only this session. Otherwise show all. */
  sessionId?: string;
  onClose?: () => void;
}

// ── Status styles ──────────────────────────────────────────────

const SESSION_STYLES: Record<string, { bg: string; text: string }> = {
  active: { bg: "bg-info/10", text: "text-info" },
  completed: { bg: "bg-success/10", text: "text-success" },
  failed: { bg: "bg-error/10", text: "text-error" },
};

const WORKER_STYLES: Record<string, { bg: string; text: string }> = {
  running: { bg: "bg-info/10", text: "text-info" },
  pending: { bg: "bg-badge/30", text: "text-description" },
  completed: { bg: "bg-success/10", text: "text-success" },
  failed: { bg: "bg-error/10", text: "text-error" },
  killed: { bg: "bg-warning/10", text: "text-warning" },
};

// ── Component ──────────────────────────────────────────────────

export function CoordinatorView({ sessionId, onClose }: CoordinatorViewProps) {
  const { get, del } = useProxyApi();
  const [sessions, setSessions] = useState<CoordinatorSession[]>([]);
  const [workerResults, setWorkerResults] = useState<
    Record<string, WorkerResult[]>
  >({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const agentsResp = await get<{
        agents: Array<{
          taskId: string;
          description: string;
          status: string;
          isRunning: boolean;
          parentTaskId?: string;
          startedAt?: number;
          durationMs?: number;
          resultSummary?: string | null;
          error?: string | null;
        }>;
        runningCount: number;
      }>("/api/agents");

      const allAgents = agentsResp.agents ?? [];

      // Group by parent/coordinator — workers have [Worker] prefix and parentTaskId
      const coordSessions: CoordinatorSession[] = [];
      const workerMap: Record<string, WorkerResult[]> = {};

      const workers = allAgents.filter((a) =>
        a.description.startsWith("[Worker]"),
      );
      const coordinators = allAgents.filter(
        (a) => !a.description.startsWith("[Worker]"),
      );

      for (const coord of coordinators) {
        // Only assign workers whose parentTaskId matches this coordinator
        const myWorkers = workers.filter(
          (w) => w.parentTaskId === coord.taskId,
        );

        const session: CoordinatorSession = {
          sessionId: coord.taskId,
          userId: 0,
          coordinatorTaskId: coord.taskId,
          workerTaskIds: myWorkers.map((w) => w.taskId),
          startedAt: coord.startedAt ?? Date.now(),
          status: coord.isRunning ? "active" : "completed",
        };
        coordSessions.push(session);

        workerMap[coord.taskId] = myWorkers.map((w) => ({
          taskId: w.taskId,
          description: w.description.replace("[Worker] ", ""),
          status: w.isRunning
            ? "running"
            : ("completed" as WorkerResult["status"]),
          resultSummary: w.resultSummary ?? null,
          error: w.error ?? null,
          durationMs: w.durationMs ?? 0,
        }));
      }

      if (!mountedRef.current) return;

      setSessions(
        sessionId
          ? coordSessions.filter((s) => s.sessionId === sessionId)
          : coordSessions,
      );
      setWorkerResults(workerMap);
    } catch (err: unknown) {
      if (!mountedRef.current) return;
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [get, sessionId]);

  useEffect(() => {
    mountedRef.current = true;
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [fetchData]);

  const handleKillAll = useCallback(
    async (sid: string) => {
      try {
        await del(`/api/agents/${sid}`);
        await fetchData();
      } catch {
        // Refresh anyway
        await fetchData();
      }
    },
    [del, fetchData],
  );

  // ── Loading state ──────────────────────────────────────────

  if (loading && sessions.length === 0) {
    return (
      <div className="text-description flex items-center justify-center py-12">
        <svg
          className="mr-2 h-4 w-4 animate-spin"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="12" cy="12" r="10" opacity="0.25" />
          <path d="M12 2a10 10 0 0 1 10 10" opacity="0.75" />
        </svg>
        Loading coordinator sessions...
      </div>
    );
  }

  // ── Error state ────────────────────────────────────────────

  if (error && sessions.length === 0) {
    return (
      <div className="border-error/30 bg-error/5 text-error rounded-lg border p-4 text-sm">
        {error}
      </div>
    );
  }

  // ── Empty state ────────────────────────────────────────────

  if (sessions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="mb-2 text-3xl">{"🤖"}</div>
        <p className="text-description text-sm">
          No coordinator sessions active.
        </p>
        <p className="text-description-muted mt-1 text-xs">
          Start a multi-agent task to see the coordinator dashboard.
        </p>
      </div>
    );
  }

  // ── Main view ──────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h3 className="text-foreground text-sm font-semibold">
            Coordinator Dashboard
          </h3>
          <span className="bg-badge text-badge-foreground rounded px-1.5 py-0.5 text-xs">
            {sessions.length} session{sessions.length !== 1 ? "s" : ""}
          </span>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="text-description hover:text-foreground transition-colors"
            aria-label="Close coordinator view"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Sessions */}
      {sessions.map((session) => {
        const style = SESSION_STYLES[session.status] ?? SESSION_STYLES.active;
        const workers = workerResults[session.sessionId] ?? [];
        const runningWorkers = workers.filter(
          (w) => w.status === "running" || w.status === "pending",
        ).length;
        const completedWorkers = workers.filter(
          (w) => w.status === "completed",
        ).length;
        const failedWorkers = workers.filter(
          (w) => w.status === "failed",
        ).length;
        const elapsed = Math.round((Date.now() - session.startedAt) / 1000);

        return (
          <div
            key={session.sessionId}
            className="border-border bg-editor rounded-lg border p-4"
          >
            {/* Session header */}
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span
                  className={`rounded px-1.5 py-0.5 text-xs font-semibold uppercase ${style.bg} ${style.text}`}
                >
                  {session.status}
                </span>
                <span className="text-description-muted font-mono text-xs">
                  {session.sessionId}
                </span>
              </div>
              <span className="text-description-muted text-xs">{elapsed}s</span>
            </div>

            {/* Pool summary bar */}
            <div className="mb-3 flex gap-3 text-xs">
              <span className="text-info">{runningWorkers} running</span>
              <span className="text-success">{completedWorkers} done</span>
              {failedWorkers > 0 && (
                <span className="text-error">{failedWorkers} failed</span>
              )}
              <span className="text-description-muted">
                {workers.length} total
              </span>
            </div>

            {/* Progress bar */}
            {workers.length > 0 && (
              <div className="bg-secondary-background mb-3 h-1.5 overflow-hidden rounded-full">
                <div
                  className="bg-success h-full transition-all duration-500"
                  style={{
                    width: `${workers.length > 0 ? (completedWorkers / workers.length) * 100 : 0}%`,
                  }}
                />
              </div>
            )}

            {/* Worker list */}
            <div className="flex flex-col gap-2">
              {workers.length === 0 ? (
                <p className="text-description-muted text-xs italic">
                  No workers spawned yet.
                </p>
              ) : (
                workers.map((worker) => {
                  const ws =
                    WORKER_STYLES[worker.status] ?? WORKER_STYLES.pending;
                  return (
                    <div
                      key={worker.taskId}
                      className={`border-border rounded border p-2 ${ws.bg}`}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-xs font-medium uppercase ${ws.text}`}
                        >
                          {worker.status}
                        </span>
                        <span className="text-foreground flex-1 truncate text-xs">
                          {worker.description}
                        </span>
                        {worker.durationMs > 0 && (
                          <span className="text-description-muted text-xs">
                            {Math.round(worker.durationMs / 1000)}s
                          </span>
                        )}
                      </div>
                      {worker.resultSummary && (
                        <p className="text-success mt-1 text-xs">
                          {worker.resultSummary}
                        </p>
                      )}
                      {worker.error && (
                        <p className="text-error mt-1 text-xs">
                          {worker.error}
                        </p>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Actions */}
            {session.status === "active" && (
              <div className="mt-3 flex gap-2">
                <button
                  onClick={() => handleKillAll(session.coordinatorTaskId)}
                  className="border-error/30 text-error hover:bg-error/10 focus-visible:ring-border-focus rounded border px-2 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2"
                >
                  Kill All Workers
                </button>
                <button
                  onClick={fetchData}
                  className="border-border text-description hover:bg-list-hover focus-visible:ring-border-focus rounded border px-2 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2"
                >
                  Refresh
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
