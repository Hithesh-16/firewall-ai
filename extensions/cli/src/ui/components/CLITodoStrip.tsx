import { Box, Text } from "ink";
import React, { useEffect, useState } from "react";

import {
  subscribeTodos,
  type TodoItem,
} from "core/tools/implementations/todoTool.js";

/**
 * CLI sticky TODO strip (P8).
 *
 * Subscribes to the shared todoTool state so that whenever the agent
 * calls `todo_write` in core, this strip updates in the TUI without
 * polling. Mounted above the chat input in `TUIChat.tsx` so it stays
 * visible as the assistant streams.
 *
 * Layout:
 *   ▎ TODO  2/5 completed          ◐ in progress       (header)
 *   ✔  (completed item — strikethrough dim)
 *   ◐  (in progress item — emerald)
 *   ○  (pending item)
 *   ⨯  (cancelled item — dim slash)
 *
 * Auto-hides when the list is empty or not yet populated. Uses the
 * same glyph vocabulary as the GUI TodoStrip so users flipping
 * between VS Code + terminal see a consistent metaphor.
 */

const EMERALD = "greenBright";
const DIM_GRAY = "gray";
const WHITE = "white";
const AMBER = "yellow";

export function CLITodoStrip() {
  const [todos, setTodos] = useState<TodoItem[]>([]);

  useEffect(() => {
    const unsubscribe = subscribeTodos((next) => {
      setTodos(next);
    });
    return unsubscribe;
  }, []);

  if (todos.length === 0) return null;

  const done = todos.filter((t) => t.status === "completed").length;
  const inProgress = todos.find((t) => t.status === "in_progress");
  const allDone = done === todos.length;

  const summary = allDone
    ? `All done (${todos.length})`
    : `${done}/${todos.length} completed`;

  return (
    <Box flexDirection="column" paddingX={1} paddingY={0} marginTop={1}>
      {/* Header */}
      <Box flexDirection="row" gap={1}>
        <Text color={allDone ? EMERALD : EMERALD} bold>
          {"▎"}
        </Text>
        <Text color={WHITE} bold>
          TODO
        </Text>
        <Text color={allDone ? EMERALD : DIM_GRAY}>{summary}</Text>
        {inProgress && !allDone && (
          <>
            <Text color={DIM_GRAY}>·</Text>
            <Text color={EMERALD}>{"◐"}</Text>
            <Text color={DIM_GRAY}>in progress</Text>
          </>
        )}
      </Box>

      {/* Item list. When phases are present, render grouped sections;
          otherwise flat list. Hard cap at 8 total visible rows across
          phases to avoid flooding narrow terminals. */}
      <TodoBody todos={todos} />
    </Box>
  );
}

// ─── Body — flat or grouped (P9) ──────────────────────────────────────────

function TodoBody({ todos }: { todos: TodoItem[] }) {
  const groups = groupByPhase(todos);
  const anyPhases = groups.some((g) => g.phase !== undefined);

  // Flat list — no phases on any item.
  if (!anyPhases) {
    return (
      <Box flexDirection="column" marginLeft={2} marginTop={0}>
        {todos.slice(0, 8).map((todo) => (
          <TodoRow key={todo.id} todo={todo} />
        ))}
        {todos.length > 8 && (
          <Text color={DIM_GRAY}>{`  + ${todos.length - 8} more…`}</Text>
        )}
      </Box>
    );
  }

  // Grouped — one section per phase.
  let remaining = 8;
  return (
    <Box flexDirection="column" marginLeft={1} marginTop={0}>
      {groups.map((group, gi) => {
        if (remaining <= 0) return null;
        const visible = group.items.slice(0, remaining);
        remaining -= visible.length;
        const done = group.items.filter((t) => t.status === "completed").length;
        const total = group.items.length;
        const allDone = done === total && total > 0;
        return (
          <Box
            key={`${group.phase ?? "__flat__"}-${gi}`}
            flexDirection="column"
            marginTop={gi === 0 ? 0 : 1}
          >
            <Box flexDirection="row" gap={1}>
              <Text color={allDone ? EMERALD : WHITE} bold>
                {group.phase ?? "Other"}
              </Text>
              <Text color={DIM_GRAY}>
                {done}/{total}
              </Text>
            </Box>
            <Box flexDirection="column" marginLeft={1}>
              {visible.map((todo) => (
                <TodoRow key={todo.id} todo={todo} />
              ))}
            </Box>
          </Box>
        );
      })}
      {todos.length > 8 && (
        <Text color={DIM_GRAY}>{`  + ${todos.length - 8} more…`}</Text>
      )}
    </Box>
  );
}

interface PhaseGroup {
  phase: string | undefined;
  items: TodoItem[];
}

function groupByPhase(todos: TodoItem[]): PhaseGroup[] {
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

function TodoRow({ todo }: { todo: TodoItem }) {
  const { glyph, glyphColor, textColor, strikethrough } = glyphFor(todo.status);
  return (
    <Box flexDirection="row" gap={1}>
      <Text color={glyphColor}>{glyph}</Text>
      <Text color={textColor} strikethrough={strikethrough}>
        {truncate(todo.content, 80)}
      </Text>
    </Box>
  );
}

function glyphFor(status: TodoItem["status"]): {
  glyph: string;
  glyphColor: string;
  textColor: string;
  strikethrough: boolean;
} {
  switch (status) {
    case "completed":
      return {
        glyph: "✔",
        glyphColor: EMERALD,
        textColor: DIM_GRAY,
        strikethrough: true,
      };
    case "in_progress":
      return {
        glyph: "◐",
        glyphColor: EMERALD,
        textColor: WHITE,
        strikethrough: false,
      };
    case "cancelled":
      return {
        glyph: "⨯",
        glyphColor: DIM_GRAY,
        textColor: DIM_GRAY,
        strikethrough: true,
      };
    case "pending":
    default:
      return {
        glyph: "○",
        glyphColor: DIM_GRAY,
        textColor: AMBER,
        strikethrough: false,
      };
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}
