import {
  CheckCircleIcon,
  ChevronDownIcon,
  ClockIcon,
  PlayCircleIcon,
  XCircleIcon,
} from "@heroicons/react/24/outline";
import { useMemo, useState } from "react";

import { useAppSelector } from "../../redux/hooks";
import type { TodoItem as ReduxTodoItem } from "../../redux/slices/todosSlice";

/**
 * Premium agent todo strip.
 *
 * Renders a summary line with a progress bar and a collapsible list of
 * tasks. Each task has a status-specific icon and color coding:
 *   - completed   → Emerald check
 *   - in_progress → Pulsing blue play
 *   - pending     → Amber clock
 *   - cancelled   → Gray X
 */
export function TodoStrip() {
  const rawTodos = useAppSelector((s) => s.todos);
  const sessionTitle = useAppSelector((s) => s.session.title);
  const [open, setOpen] = useState(false);

  // Ensure todos is an array (safety for hydration/redux-persist edge cases)
  const todos = Array.isArray(rawTodos) ? rawTodos : [];

  const activeTodo = useMemo(() => {
    return (
      todos.find((t) => t.status === "in_progress") ||
      todos.find((t) => t.status === "pending")
    );
  }, [todos]);

  const headerTitle = useMemo(() => {
    if (
      sessionTitle &&
      sessionTitle !== "New Session" &&
      sessionTitle !== "New Conversation"
    ) {
      return sessionTitle;
    }
    return "Agent Plan";
  }, [sessionTitle]);

  const done = todos.filter((t) => t.status === "completed").length;
  const total = todos.length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  const allDone = done === total;

  const summary = allDone
    ? `All tasks complete (${total})`
    : `${done} of ${total} steps finished`;

  if (todos.length === 0) return null;

  return (
    <div className="border-border/40 bg-secondary/30 hover:bg-secondary/40 border-t backdrop-blur-md transition-colors">
      <button
        type="button"
        className="text-description hover:text-foreground flex w-full items-center gap-3 px-4 py-2.5 transition-all"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <div className="flex flex-1 items-center gap-3 overflow-hidden">
          {/* Status Checkbox in Header */}
          <div className="flex shrink-0 items-center justify-center">
            {allDone ? (
              <CheckCircleIcon className="text-success h-4 w-4" />
            ) : activeTodo?.status === "in_progress" ? (
              <PlayCircleIcon className="text-info h-4 w-4 animate-pulse shadow-[0_0_8px_rgba(59,130,246,0.5)]" />
            ) : (
              <div className="border-description/40 h-3.5 w-3.5 rounded border" />
            )}
          </div>

          <div className="flex flex-col items-start overflow-hidden text-left">
            <span className="text-foreground truncate text-[11px] font-bold uppercase tracking-wider opacity-90">
              {headerTitle}
            </span>
            <span className="text-description-muted truncate text-[10px] opacity-80">
              {activeTodo ? (
                <>
                  <span className="font-medium">Next:</span>{" "}
                  {activeTodo.content}
                </>
              ) : (
                summary
              )}
            </span>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <span className="text-description-muted text-[10px] font-medium tabular-nums opacity-60">
              {pct}%
            </span>
          </div>
        </div>
        <ChevronDownIcon
          className={`h-3.5 w-3.5 shrink-0 opacity-50 transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
          aria-hidden
        />
      </button>

      {/* Progress Bar Container */}
      <div className="bg-border/20 h-[3px] w-full overflow-hidden">
        <div
          className={`h-full transition-all duration-500 ease-in-out ${
            allDone ? "bg-success" : "bg-info"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>

      {open && (
        <div className="animate-af-slide-down border-border/40 bg-editor/20 max-h-[400px] overflow-y-auto border-t px-1 py-3">
          <TodoBody todos={todos} />
        </div>
      )}
    </div>
  );
}

function TodoBody({ todos }: { todos: ReduxTodoItem[] }) {
  const phases = useMemo(() => groupByPhase(todos), [todos]);

  return (
    <div className="flex flex-col gap-3 px-3 pb-1">
      {phases.map((group, gi) => (
        <section
          key={`${group.phase ?? "__flat__"}-${gi}`}
          className="flex flex-col gap-1"
        >
          {group.phase && (
            <header className="text-description-muted mb-1 flex items-center gap-2 px-1 text-[10px] font-bold uppercase tracking-widest">
              <div className="bg-border/40 h-[1px] flex-1" />
              {group.phase}
              <div className="bg-border/40 h-[1px] flex-1" />
            </header>
          )}
          <ul className="flex flex-col gap-0.5">
            {group.items.map((t) => (
              <TodoRow key={t.id} todo={t} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

interface PhaseGroup {
  phase: string | undefined;
  items: ReduxTodoItem[];
}

function groupByPhase(todos: ReduxTodoItem[]): PhaseGroup[] {
  const order: string[] = [];
  const map = new Map<string, PhaseGroup>();
  for (const t of todos) {
    const key = t.phase ?? "__flat__";
    if (!map.has(key)) {
      map.set(key, { phase: t.phase, items: [] });
      order.push(key);
    }
    map.get(key)!.items.push(t);
  }
  return order.map((k) => map.get(k)!);
}

function TodoRow({ todo }: { todo: ReduxTodoItem }) {
  const {
    icon: Icon,
    colorClass,
    textClass,
    iconClass,
  } = useMemo(() => {
    switch (todo.status) {
      case "completed":
        return {
          icon: CheckCircleIcon,
          colorClass: "bg-success/10 text-success border-success/20",
          textClass: "text-description-muted line-through opacity-70",
          iconClass: "text-success",
        };
      case "in_progress":
        return {
          icon: PlayCircleIcon,
          colorClass: "bg-info/10 text-info border-info/20",
          textClass: "text-foreground font-medium",
          iconClass: "text-info animate-pulse",
        };
      case "cancelled":
        return {
          icon: XCircleIcon,
          colorClass: "bg-border/10 text-description-muted border-border/20",
          textClass: "text-description-muted line-through opacity-40",
          iconClass: "text-description-muted",
        };
      case "pending":
      default:
        return {
          icon: ClockIcon,
          colorClass: "bg-warning/5 text-warning/70 border-warning/10",
          textClass: "text-description",
          iconClass: "text-warning/60",
        };
    }
  }, [todo.status]);

  return (
    <li className="hover:bg-list-hover/30 group flex items-center gap-2.5 rounded-md px-2 py-1 transition-colors">
      <div
        className={`flex shrink-0 items-center justify-center rounded p-0.5 ${iconClass}`}
      >
        <Icon className="h-4 w-4" aria-hidden />
      </div>
      <span
        className={`truncate text-xs leading-tight transition-all ${textClass}`}
      >
        {todo.content}
      </span>
    </li>
  );
}
