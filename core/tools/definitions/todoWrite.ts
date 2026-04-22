import { Tool } from "../..";
import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../builtIn";

/**
 * Agent-facing `todo_write` tool (kilocode-parity).
 *
 * The agent writes a structured todo list at the start of a task and
 * updates it as work progresses. The UI (TaskHeader > TodoStrip in the
 * webview, per-turn footer in the CLI) renders the checklist live so
 * the user can see what's pending vs done without reading the full
 * assistant message.
 *
 * Contract:
 *   - `todos` is the WHOLE list every call — the agent passes the
 *     current state, the UI swaps it in wholesale. Simpler than a
 *     diff-based tool and matches how kilocode ships it.
 *   - Each todo has a stable `id` the agent picks (usually numeric
 *     "1", "2", …) so status updates don't accidentally re-key a row.
 *   - Status is one of pending / in_progress / completed / cancelled.
 *   - The tool is read-only — it doesn't touch disk, doesn't run
 *     commands. No permission prompt.
 */

const TODOS_DESC = `The full todo list after this update. Each item has:
- id: stable identifier (e.g. "1", "2")
- content: short, imperative description of the step
- status: "pending" | "in_progress" | "completed" | "cancelled"
- phase: optional heading grouping related steps (e.g. "Discovery",
  "Implementation", "Verification"). Items sharing the same phase
  render under a single heading with per-phase progress. Omit to
  render a flat checklist.

Pass the complete list every call — the UI replaces its view wholesale.`;

export const todoWriteTool: Tool = {
  type: "function",
  displayTitle: "Update Todo List",
  wouldLikeTo: "update the todo list",
  isCurrently: "updating the todo list",
  hasAlready: "updated the todo list",
  readonly: true,
  isInstant: true,
  group: BUILT_IN_GROUP_NAME,
  function: {
    name: BuiltInToolNames.TodoWrite,
    description:
      "Write or overwrite the user-visible todo checklist. Call this at the start of any multi-step task and again each time a step starts, completes, or is cancelled. The UI renders the list live so the user can see progress.",
    parameters: {
      type: "object",
      required: ["todos"],
      properties: {
        todos: {
          type: "array",
          description: TODOS_DESC,
          items: {
            type: "object",
            required: ["id", "content", "status"],
            properties: {
              id: { type: "string" },
              content: { type: "string" },
              status: {
                type: "string",
                enum: ["pending", "in_progress", "completed", "cancelled"],
              },
              phase: {
                type: "string",
                description:
                  "Optional section heading grouping related steps. Items with the same phase render under a single heading with per-phase progress.",
              },
            },
          },
        },
      },
    },
  },
  defaultToolPolicy: "allowedWithoutPermission",
  systemMessageDescription: {
    prefix: `For any task that spans more than one step, open with a ${BuiltInToolNames.TodoWrite} call listing the steps you plan to take. Update the list whenever a step starts or finishes. Format:`,
    exampleArgs: [
      [
        "todos",
        `[{"id":"1","content":"Read the file","status":"in_progress"},{"id":"2","content":"Apply the edit","status":"pending"}]`,
      ],
    ],
  },
};
