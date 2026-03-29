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
    description: "Indicate the start of a task or make an update to the current task. Used for communicating structured progress to the user.",
    parameters: {
      type: "object",
      required: ["TaskName", "Mode", "TaskSummary", "TaskStatus", "PredictedTaskSize"],
      properties: {
        TaskName: { type: "string" },
        Mode: { type: "string" },
        TaskSummary: { type: "string" },
        TaskStatus: { type: "string" },
        PredictedTaskSize: { type: "number" }
      }
    }
  },
  defaultToolPolicy: "allowedWithPermission",
  evaluateToolCallPolicy: (basePolicy: ToolPolicy) => basePolicy,
  systemMessageDescription: {
    prefix: `To update the current task, use the ${BuiltInToolNames.TaskBoundary} tool`,
    exampleArgs: [["TaskName", "Researching Codebase"]]
  }
};
