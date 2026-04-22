import {
  ChevronDownIcon,
  ClipboardDocumentCheckIcon,
} from "@heroicons/react/24/outline";
import { useEffect, useMemo, useRef, useState } from "react";

import { AfSuccessCheck } from "../loaders/AfSuccessCheck";
import { useAppSelector } from "../../redux/hooks";
import type { TodoItem as ReduxTodoItem } from "../../redux/slices/todosSlice";

/**
 * Live agent todo strip (kilocode-parity + P4 polish).
 *
 * Per-row glyphs now signal status instead of a checkbox:
 *   pending     → outline circle
 *   in_progress → pulsing emerald dot
 *   completed   → AfSuccessCheck (animated stroke-draw)
 *   cancelled   → dim slash
 *
 * Header shows "N/M completed" (or "All done" in accent color), with
 * an af-stroke-draw on the check glyph the moment the last item
 * flips to completed — a satisfying one-shot celebration without
 * a toast.
 *
 * Source of truth: `state.todos` slice. `todoWrite` dispatches
 * setTodos/updateTodoStatus via the tool-output → Redux bridge.
 */
export function TodoStrip() {
  const todos = useAppSelector((s) => s.todos);
  const [open, setOpen] = useState(false);

  // Track newly-completed items so we can replay the check animation
  // on the exact transition pending → completed, instead of replaying
  // every time the list re-renders.
  const prevStatuses = useRef<Map<string, string>>(new Map());
  const [completedTick, setCompletedTick] = useState<Record<string, number>>(
    {},
  );
  useEffect(() => {
    const prev = prevStatuses.current;
    const next = new Map<string, string>();
    let localTick = { ...completedTick };
    let changed = false;
    for (const t of todos) {
      next.set(t.id, t.status);
      if (prev.get(t.id) !== "completed" && t.status === "completed") {
        localTick[t.id] = (localTick[t.id] ?? 0) + 1;
        changed = true;
      }
    }
    prevStatuses.current = next;
    if (changed) setCompletedTick(localTick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todos]);

  // UI-2: only render when the plan is substantive. A "hi" prompt
  // occasionally triggers the model to create a speculative all-pending
  // plan; showing "0/N completed" for those is visual noise. Rule:
  //   - At least one item has left the pending state (in_progress /
  //     completed / cancelled), OR
  //   - The plan has 3+ items (substantive upfront planning)
  // Otherwise we hide until the agent actually starts working.
  if (todos.length === 0) return null;
  const hasProgression = todos.some((t) => t.status !== "pending");
  const substantivePlan = todos.length >= 3;
  if (!hasProgression && !substantivePlan) return null;

  const done = todos.filter((t) => t.status === "completed").length;
  const allDone = done === todos.length;
  const summary = allDone
    ? `All done · ${todos.length}`
    : `${done}/${todos.length} completed`;

  return (
    <div className="border-border bg-background border-t">
      <button
        type="button"
        className="text-description hover:text-foreground text-af-caption flex w-full items-center gap-1.5 px-3 py-1.5 transition-colors"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {allDone ? (
          <AfSuccessCheck size={14} replayKey={done} />
        ) : (
          <ClipboardDocumentCheckIcon className="h-3.5 w-3.5 shrink-0" />
        )}
        <span
          className={`flex-1 text-left ${allDone ? "text-af-accent font-semibold" : ""}`}
        >
          {summary}
        </span>
        <ChevronDownIcon
          className={`h-3 w-3 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>

      {open && <TodoBody todos={todos} completedTick={completedTick} />}
    </div>
  );
}

// ─── Body — flat or grouped-by-phase (P9) ─────────────────────────────────

function TodoBody({
  todos,
  completedTick,
}: {
  todos: ReduxTodoItem[];
  completedTick: Record<string, number>;
}) {
  // Group preserving first-appearance order of each phase so the
  // visual ordering matches how the agent wrote the list.
  const phases = useMemo(() => groupByPhase(todos), [todos]);

  // No phases at all — render flat checklist (unchanged pre-P9 shape).
  if (phases.length === 1 && phases[0].phase === undefined) {
    return (
      <ul className="animate-af-slide-down flex flex-col gap-0.5 overflow-hidden px-3 pb-2">
        {phases[0].items.map((t) => (
          <TodoRow key={t.id} todo={t} replayKey={completedTick[t.id]} />
        ))}
      </ul>
    );
  }

  return (
    <div className="animate-af-slide-down flex flex-col gap-2 overflow-hidden px-3 pb-2">
      {phases.map((group, gi) => {
        const total = group.items.length;
        const done = group.items.filter((t) => t.status === "completed").length;
        const pct = total === 0 ? 0 : (done / total) * 100;
        const allDone = done === total && total > 0;
        return (
          <section key={`${group.phase ?? "__flat__"}-${gi}`}>
            <header className="mb-1 flex items-center gap-2">
              <span
                className={`text-af-caption font-semibold uppercase tracking-wide ${
                  allDone ? "text-af-accent" : "text-strong"
                }`}
              >
                {group.phase ?? "Other"}
              </span>
              <span className="text-weak text-[10px] tabular-nums">
                {done}/{total}
              </span>
              <div className="bg-af-hairline relative ml-1 h-[2px] flex-1 overflow-hidden rounded-full">
                <span
                  aria-hidden
                  className={`absolute inset-y-0 left-0 rounded-full transition-[width] duration-300 ${
                    allDone ? "bg-af-accent" : "bg-af-accent/70"
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </header>
            <ul className="flex flex-col gap-0.5">
              {group.items.map((t) => (
                <TodoRow key={t.id} todo={t} replayKey={completedTick[t.id]} />
              ))}
            </ul>
          </section>
        );
      })}
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
  // Key "__flat__" buckets items without an explicit phase.
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

function TodoRow({
  todo,
  replayKey,
}: {
  todo: ReduxTodoItem;
  replayKey?: number;
}) {
  return (
    <li className="text-af-body flex items-center gap-2">
      <StatusGlyph status={todo.status} replayKey={replayKey} />
      <span
        className={
          todo.status === "completed"
            ? "text-weak line-through"
            : todo.status === "cancelled"
              ? "text-weak line-through opacity-60"
              : todo.status === "in_progress"
                ? "text-strong font-medium"
                : "text-strong"
        }
      >
        {todo.content}
      </span>
    </li>
  );
}

function StatusGlyph({
  status,
  replayKey,
}: {
  status: "pending" | "in_progress" | "completed" | "cancelled";
  replayKey?: number;
}) {
  if (status === "completed") {
    return <AfSuccessCheck size={13} replayKey={replayKey} />;
  }
  if (status === "in_progress") {
    return (
      <span
        className="bg-af-accent/20 relative inline-flex h-3 w-3 items-center justify-center rounded-full"
        aria-label="in progress"
      >
        <span
          className="bg-af-accent animate-af-pulse h-1.5 w-1.5 rounded-full"
          aria-hidden
        />
      </span>
    );
  }
  if (status === "cancelled") {
    return (
      <span
        className="text-description-muted inline-block h-3 w-3 text-center font-mono text-xs leading-none"
        aria-label="cancelled"
      >
        ⨯
      </span>
    );
  }
  return (
    <span
      className="border-af-hairline inline-block h-3 w-3 rounded-full border"
      aria-label="pending"
    />
  );
}
