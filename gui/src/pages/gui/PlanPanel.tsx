import {
  CheckCircleIcon,
  PlayCircleIcon,
  ClockIcon,
  XMarkIcon,
  ChevronRightIcon,
} from "@heroicons/react/24/outline";
import { useAppDispatch, useAppSelector } from "../../redux/hooks";
import {
  updatePlanTask,
  togglePlanCollapsed,
  clearActivePlan,
} from "../../redux/slices/sessionSlice";
import { cn } from "../../util/cn";

function StatusIcon({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  switch (status) {
    case "completed":
      return (
        <CheckCircleIcon className={cn("text-success h-4 w-4", className)} />
      );
    case "in_progress":
      return (
        <PlayCircleIcon
          className={cn("text-info h-4 w-4 animate-pulse", className)}
        />
      );
    case "cancelled":
      return (
        <XMarkIcon
          className={cn("text-description-muted h-4 w-4", className)}
        />
      );
    default:
      return (
        <ClockIcon
          className={cn("text-description-muted h-4 w-4", className)}
        />
      );
  }
}

export function PlanPanel() {
  const dispatch = useAppDispatch();
  const activePlan = useAppSelector((s) => s.session.activePlan);

  if (!activePlan) return null;

  const tasks = Array.isArray(activePlan.tasks) ? activePlan.tasks : [];
  const completedCount = tasks.filter((t) => t.status === "completed").length;
  const totalCount = tasks.length;
  const progress = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;
  const allDone = completedCount === totalCount;

  return (
    <div className="border-border bg-surface-inset/70 mx-2 mb-3 overflow-hidden rounded-xl border shadow-sm backdrop-blur-md transition-all">
      {/* Header */}
      <div
        className="hover:bg-list-hover flex cursor-pointer items-center gap-3 px-3.5 py-2.5 transition-colors"
        onClick={() => dispatch(togglePlanCollapsed())}
      >
        <div className="bg-primary/10 flex shrink-0 items-center justify-center rounded-lg p-1.5">
          <StatusIcon
            status={allDone ? "completed" : "in_progress"}
            className="h-4 w-4"
          />
        </div>

        <div className="flex flex-1 flex-col overflow-hidden">
          <div className="flex items-center gap-2">
            <span className="text-foreground truncate text-sm font-bold tracking-tight">
              {activePlan.title}
            </span>
            <span className="text-description-muted text-[10px] font-bold uppercase tracking-widest opacity-60">
              Active Plan
            </span>
          </div>
          <div className="mt-1 flex items-center gap-2">
            <div className="bg-border/30 h-1 flex-1 overflow-hidden rounded-full">
              <div
                className={cn(
                  "h-full transition-all duration-700 ease-out",
                  allDone ? "bg-success" : "bg-info",
                )}
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="text-description-muted min-w-[32px] text-right text-[10px] font-bold tabular-nums">
              {completedCount}/{totalCount}
            </span>
          </div>
        </div>

        <div className="ml-1 flex items-center gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              dispatch(clearActivePlan());
            }}
            className="text-description-muted hover:text-foreground hover:bg-list-hover shrink-0 rounded-md p-1 transition-all"
            aria-label="Dismiss plan"
          >
            <XMarkIcon className="h-4 w-4" />
          </button>
          <ChevronRightIcon
            className={cn(
              "text-description-muted h-3.5 w-3.5 transition-transform duration-300",
              !activePlan.collapsed && "rotate-90",
            )}
          />
        </div>
      </div>

      {/* Task list with optional phase grouping */}
      {!activePlan.collapsed && (
        <div className="animate-in slide-in-from-top-2 border-border/40 flex flex-col gap-1 border-t px-3.5 py-3 duration-200">
          {tasks.reduce((acc, task, index) => {
            const prevTask = index > 0 ? tasks[index - 1] : null;

            // Phase Header
            if (task.phase && task.phase !== prevTask?.phase) {
              acc.push(
                <div
                  key={`phase-${task.phase}`}
                  className="mb-2 mt-3 first:mt-0"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-description-muted text-[10px] font-black uppercase tracking-[0.1em]">
                      {task.phase}
                    </span>
                    <div className="bg-border/20 h-[1px] flex-1" />
                  </div>
                </div>,
              );
            }

            // Task Row
            acc.push(
              <div
                key={index}
                className="hover:bg-list-hover/40 group -mx-1.5 flex cursor-pointer items-start gap-3 rounded-lg px-1.5 py-2 transition-all"
                onClick={() => {
                  const nextStatus =
                    task.status === "pending"
                      ? "in_progress"
                      : task.status === "in_progress"
                        ? "completed"
                        : "pending";
                  dispatch(updatePlanTask({ index, status: nextStatus }));
                }}
              >
                <div className="mt-0.5 shrink-0">
                  <StatusIcon status={task.status} className="h-3.5 w-3.5" />
                </div>
                <div className="flex flex-1 flex-col">
                  <span
                    className={cn(
                      "text-xs leading-snug transition-all",
                      task.status === "completed"
                        ? "text-description-muted line-through opacity-60"
                        : "text-foreground font-medium",
                    )}
                  >
                    {task.content}
                  </span>
                </div>
              </div>,
            );
            return acc;
          }, [] as React.ReactNode[])}
        </div>
      )}
    </div>
  );
}
