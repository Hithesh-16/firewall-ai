import type { ToolImpl } from "./index.js";

/**
 * Todo tool implementations (kilocode-parity).
 *
 * State model: kept in a module-level `currentTodos` ref so the
 * read-side can answer from memory without going through disk.
 * Cleared on `resetTodoState` (called from `newSession` via an
 * extraReducer in the webview's todosSlice) so lists don't leak
 * across sessions.
 *
 * Both impls emit a ContextItem with `uri.type = "todo_write"` so
 * the webview's tool-output bridge (ParallelListeners +
 * callToolById) can pattern-match and dispatch setTodos. The CLI
 * doesn't parse the URI — it simply renders the content markdown
 * in-place via the standard tool output path.
 */

export type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled";

export interface TodoItem {
  id: string;
  content: string;
  status: TodoStatus;
  /**
   * Optional phase / section heading (P9).
   *
   * Lets the agent group related todos under a shared banner (e.g.
   * "Discovery", "Implementation", "Verification"). The UI renders
   * grouped lists with a heading + per-phase progress bar above each
   * section. Items with the same string `phase` land in the same
   * group; items without a phase render as a flat list. Omitting
   * phase is equivalent to the pre-P9 behaviour — the feature is
   * strictly additive.
   */
  phase?: string;
}

let currentTodos: TodoItem[] = [];

type TodoListener = (todos: TodoItem[]) => void;
const listeners = new Set<TodoListener>();

function emit(): void {
  const snapshot = [...currentTodos];
  for (const fn of listeners) {
    try {
      fn(snapshot);
    } catch {
      /* don't let a bad listener break the others */
    }
  }
}

export function resetTodoState(): void {
  currentTodos = [];
  emit();
}

export function getCurrentTodos(): TodoItem[] {
  return [...currentTodos];
}

/**
 * Subscribe to todo-list changes. Returns an unsubscribe fn.
 *
 * Used by the CLI's `CLITodoStrip` to stay in sync with the agent's
 * `todo_write` calls without running a polling timer. The GUI goes
 * through `callToolById.ts`'s URI-detect instead — both are valid
 * bridges; this one is simpler for an Ink/React-on-Node context
 * without a Redux store.
 */
export function subscribeTodos(listener: TodoListener): () => void {
  listeners.add(listener);
  // Fire once immediately so late subscribers see the current state.
  try {
    listener([...currentTodos]);
  } catch {
    /* ignore */
  }
  return () => {
    listeners.delete(listener);
  };
}

const VALID_STATUSES: ReadonlySet<TodoStatus> = new Set([
  "pending",
  "in_progress",
  "completed",
  "cancelled",
]);

function normaliseTodos(raw: unknown): {
  todos: TodoItem[];
  issues: string[];
} {
  const issues: string[] = [];
  if (!Array.isArray(raw)) {
    return { todos: [], issues: ["`todos` must be an array"] };
  }
  const out: TodoItem[] = [];
  const seenIds = new Set<string>();
  for (let i = 0; i < raw.length; i++) {
    const entry = raw[i] as Record<string, unknown> | null | undefined;
    if (!entry || typeof entry !== "object") {
      issues.push(`todos[${i}] is not an object — skipped`);
      continue;
    }
    const id =
      typeof entry.id === "string"
        ? entry.id
        : typeof entry.id === "number"
          ? String(entry.id)
          : String(i + 1);
    if (seenIds.has(id)) {
      issues.push(`todos[${i}] has a duplicate id "${id}" — skipped`);
      continue;
    }
    const content = typeof entry.content === "string" ? entry.content : "";
    if (!content.trim()) {
      issues.push(`todos[${i}] has no content — skipped`);
      continue;
    }
    const statusRaw =
      typeof entry.status === "string" ? entry.status : "pending";
    const status: TodoStatus = VALID_STATUSES.has(statusRaw as TodoStatus)
      ? (statusRaw as TodoStatus)
      : "pending";
    if (!VALID_STATUSES.has(statusRaw as TodoStatus)) {
      issues.push(
        `todos[${i}] has unknown status "${statusRaw}" — coerced to pending`,
      );
    }
    seenIds.add(id);
    // Optional `phase` — only retained when it's a non-empty string.
    // Trim first so whitespace-only values don't create phantom
    // groups in the UI.
    const phaseRaw = typeof entry.phase === "string" ? entry.phase.trim() : "";
    const phase = phaseRaw.length > 0 ? phaseRaw : undefined;
    out.push({ id, content, status, phase });
  }
  return { todos: out, issues };
}

function formatMarkdown(todos: TodoItem[]): string {
  if (todos.length === 0) return "_(empty list)_";
  const lines = todos.map((t, i) => {
    const mark =
      t.status === "completed"
        ? "[x]"
        : t.status === "in_progress"
          ? "[~]"
          : t.status === "cancelled"
            ? "[-]"
            : "[ ]";
    return `${i + 1}. ${mark} ${t.content}`;
  });
  return lines.join("\n");
}

export const todoWriteImpl: ToolImpl = async (args, _extras) => {
  const { todos, issues } = normaliseTodos(args?.todos);
  currentTodos = todos;
  emit();

  const done = todos.filter((t) => t.status === "completed").length;
  const summary =
    todos.length === 0
      ? "Cleared todo list"
      : done === todos.length
        ? `All done (${todos.length})`
        : `${done}/${todos.length} completed`;

  const content =
    formatMarkdown(todos) +
    (issues.length > 0 ? `\n\n_Warnings:_ ${issues.join("; ")}` : "");

  return [
    {
      name: "Todo list",
      description: summary,
      content,
      uri: {
        type: "todo_write" as any,
        value: JSON.stringify(todos),
      },
    },
  ];
};

export const todoReadImpl: ToolImpl = async (_args, _extras) => {
  const todos = getCurrentTodos();
  const done = todos.filter((t) => t.status === "completed").length;
  const summary =
    todos.length === 0
      ? "No active todos"
      : `${done}/${todos.length} completed`;

  return [
    {
      name: "Todo list",
      description: summary,
      content: formatMarkdown(todos),
      uri: {
        type: "todo_read" as any,
        value: JSON.stringify(todos),
      },
    },
  ];
};
