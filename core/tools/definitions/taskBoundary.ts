import { Tool } from "../..";
import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../builtIn";
import { ToolPolicy } from "@ai-firewall/terminal-security";

export const taskBoundaryTool: Tool = {
  type: "function",
  displayTitle: "Task Boundary",
  wouldLikeTo: "update the current task status",
  isCurrently: "updating the task boundary",
  hasAlready: "updated the task boundary",
  readonly: true,
  group: BUILT_IN_GROUP_NAME,
  function: {
    name: BuiltInToolNames.TaskBoundary,
    description:
      "Indicate the start of a task or make an update to the current task. Used for communicating structured progress to the user.",
    parameters: {
      type: "object",
      required: ["TaskName"],
      properties: {
        TaskName: { type: "string" },
        Mode: {
          type: "string",
          description:
            "Optional: the operation mode (e.g. 'plan', 'apply', 'test')",
        },
        TaskSummary: {
          type: "string",
          description: "Optional: a short summary of the work done so far",
        },
        TaskStatus: {
          type: "string",
          description:
            "Optional: the current status (e.g. 'In Progress', 'Completed')",
        },
        PredictedTaskSize: {
          type: "number",
          description: "Optional: estimated complexity (1-10)",
        },
      },
    },
  },
  defaultToolPolicy: "allowedWithPermission",
  evaluateToolCallPolicy: (basePolicy: ToolPolicy) => basePolicy,
  systemMessageDescription: {
    prefix: `To update the current task or indicate a new boundary, use the ${BuiltInToolNames.TaskBoundary} tool`,
    exampleArgs: [
      ["TaskName", "Fixing auth bug"],
      ["TaskStatus", "In Progress"],
      ["Mode", "debug"],
    ],
  },
};
