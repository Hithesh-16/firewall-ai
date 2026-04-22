import { Tool } from "../..";
import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../builtIn";

/**
 * Agent-facing `todo_read` tool (kilocode-parity).
 *
 * Lets the agent inspect the current todo list without paging through
 * history. Primarily useful in long multi-step sessions where the
 * assistant wants to double-check which steps are already marked
 * completed before proposing the next action.
 *
 * No arguments — the tool always returns the whole list.
 */
export const todoReadTool: Tool = {
  type: "function",
  displayTitle: "Read Todo List",
  wouldLikeTo: "read the current todo list",
  isCurrently: "reading the todo list",
  hasAlready: "read the todo list",
  readonly: true,
  isInstant: true,
  group: BUILT_IN_GROUP_NAME,
  function: {
    name: BuiltInToolNames.TodoRead,
    description:
      "Read the current todo checklist. Use this to verify progress before deciding what to do next in a multi-step task.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  defaultToolPolicy: "allowedWithoutPermission",
  systemMessageDescription: {
    prefix: `Call ${BuiltInToolNames.TodoRead} to inspect the current todo list. Takes no arguments; returns the same shape you'd pass to ${BuiltInToolNames.TodoWrite}.`,
    exampleArgs: [],
  },
};
