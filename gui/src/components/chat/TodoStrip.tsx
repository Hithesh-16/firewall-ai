import { ChevronDownIcon } from "@heroicons/react/24/outline";
import { useMemo, useState } from "react";

import { useAppSelector } from "../../redux/hooks";
import type { TodoItem as ReduxTodoItem } from "../../redux/slices/todosSlice";

/**
 * Live agent todo strip — simplified.
 *
 * Previously each row had a status glyph (outline circle / pulsing
 * emerald dot / animated check / slash). In the IDE chat that stack of
 * colored dots competed visually with the actual message content. The
 * new shape: a single summary line, one thin horizontal progress bar,
 * and plain text rows differentiated by weight + line-through only.
 */
export function TodoStrip() {
  const todos = useAppSelector((s) => s.todos);
  const [open, setOpen] = useState(false);

  if (todos.length === 0) return null;
  const hasProgression = todos.some((t) => t.status !== "pending");
  const substantivePlan = todos.length >= 3;
  if (!hasProgression && !substantivePlan) return null;

  const done = todos.filter((t) => t.status === "completed").length;
  const total = todos.length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  const allDone = done === total;
  const summary = allDone
    ? `All done · ${total}`
    : `${done}/${total} completed`;

  return (
    <div className="border-border bg-background border-t">
      <button
        type="button"
        className="text-description hover:text-foreground text-af-caption flex w-full items-center gap-2 px-3 py-1.5 transition-colors"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="flex-1 text-left tabular-nums">{summary}</span>
        <ChevronDownIcon
          className={`h-3 w-3 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>

      <div
        className="bg-border/40 mx-3 mb-1.5 h-[2px] overflow-hidden rounded-full"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={summary}
      >
        <div
          className="bg-info h-full transition-[width] duration-300 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>

      {open && <TodoBody todos={todos} />}
    </div>
  );
}

function TodoBody({ todos }: { todos: ReduxTodoItem[] }) {
  const phases = useMemo(() => groupByPhase(todos), [todos]);

  if (phases.length === 1 && phases[0].phase === undefined) {
    return (
      <ul className="flex flex-col gap-0.5 px-3 pb-2">
        {phases[0].items.map((t) => (
          <TodoRow key={t.id} todo={t} />
        ))}
      </ul>
    );
  }

  return (
    <div className="flex flex-col gap-2 px-3 pb-2">
      {phases.map((group, gi) => (
        <section key={`${group.phase ?? "__flat__"}-${gi}`}>
          <header className="text-description-muted text-af-caption mb-0.5 font-semibold uppercase tracking-wide">
            {group.phase ?? "Other"}
          </header>
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
  const cls =
    todo.status === "completed"
      ? "text-description-muted line-through"
      : todo.status === "cancelled"
        ? "text-description-muted line-through opacity-60"
        : todo.status === "in_progress"
          ? "text-foreground font-medium"
          : "text-description";
  return <li className={`text-af-body truncate ${cls}`}>{todo.content}</li>;
}
