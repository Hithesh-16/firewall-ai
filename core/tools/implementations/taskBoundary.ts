import { ToolImpl } from ".";
import { getStringArg, getNumberArg } from "../parseArgs";

export const taskBoundaryImpl: ToolImpl = async (args, extras) => {
  const taskName = getStringArg(args, "TaskName");
  const taskStatus = getStringArg(args, "TaskStatus", true) || "In Progress";
  const taskSummary = getStringArg(args, "TaskSummary", true) || "";
  const mode = getStringArg(args, "Mode", true) || "normal";

  // Here we would typically send a message to the VS Code extension
  // to render a specialized Task UI block. For now, we return it as context.
  const customIde = extras.ide as any;
  if (customIde.dispatchCustomEvent) {
    await customIde.dispatchCustomEvent("taskBoundaryUpdated", {
      taskName,
      taskStatus,
      taskSummary,
      mode,
    });
  }

  return [
    {
      name: "Task Boundary",
      description: "Updated active task",
      content: `Now operating in ${mode} mode.\\nTask: ${taskName}\\nStatus: ${taskStatus}\\nSummary: ${taskSummary}`,
    },
  ];
};
