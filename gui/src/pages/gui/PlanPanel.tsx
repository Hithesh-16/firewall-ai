import { useAppDispatch, useAppSelector } from "../../redux/hooks";
import {
  updatePlanTask,
  togglePlanCollapsed,
  clearActivePlan,
} from "../../redux/slices/sessionSlice";

function StatusIcon({ status }: { status: string }) {
  if (status === "completed") {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-success flex-shrink-0">
        <polyline points="20 6 9 17 4 12" />
      </svg>
    );
  }
  if (status === "in_progress") {
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="animate-spin text-info flex-shrink-0">
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
        <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <div className="w-3.5 h-3.5 rounded-full border-2 border-border flex-shrink-0" />
  );
}

export function PlanPanel() {
  const dispatch = useAppDispatch();
  const activePlan = useAppSelector((s) => s.session.activePlan);

  if (!activePlan) return null;

  const completedCount = activePlan.tasks.filter(
    (t) => t.status === "completed",
  ).length;
  const totalCount = activePlan.tasks.length;
  const progress = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  return (
    <div className="mx-2 mb-3 rounded-lg border border-border bg-editor overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-list-hover transition-colors"
        onClick={() => dispatch(togglePlanCollapsed())}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`text-description transition-transform ${activePlan.collapsed ? "" : "rotate-90"}`}
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>

        <span className="text-sm font-medium text-foreground flex-1">
          {activePlan.title}
        </span>

        <span className="text-xs text-description">
          {completedCount}/{totalCount}
        </span>

        <button
          onClick={(e) => {
            e.stopPropagation();
            dispatch(clearActivePlan());
          }}
          className="text-description hover:text-foreground transition-colors p-0.5"
          aria-label="Dismiss plan"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Progress bar */}
      <div className="h-0.5 bg-secondary-background">
        <div
          className="h-full bg-success transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Task list */}
      {!activePlan.collapsed && (
        <div className="px-3 py-2 flex flex-col gap-1.5">
          {activePlan.tasks.map((task, index) => (
            <div
              key={index}
              className="flex items-start gap-2 group"
            >
              <button
                className="mt-0.5"
                onClick={() => {
                  const nextStatus =
                    task.status === "pending"
                      ? "in_progress"
                      : task.status === "in_progress"
                        ? "completed"
                        : "pending";
                  dispatch(updatePlanTask({ index, status: nextStatus }));
                }}
                aria-label={`Mark task ${task.status === "completed" ? "pending" : "completed"}`}
              >
                <StatusIcon status={task.status} />
              </button>
              <span
                className={`text-xs leading-relaxed ${
                  task.status === "completed"
                    ? "text-description line-through"
                    : "text-foreground"
                }`}
              >
                {task.content}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
