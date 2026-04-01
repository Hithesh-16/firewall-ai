import { ToolImpl } from ".";
import { getStringArg } from "../parseArgs";

/**
 * create_plan tool — Creates or updates a structured execution plan.
 *
 * The agent creates a numbered plan with tasks. The plan is returned as a context item
 * that gets displayed in the PlanView component in the GUI.
 *
 * Parameters:
 *   - title: Plan title
 *   - tasks: JSON string array of task objects: [{ content, status }]
 */
export const createPlanImpl: ToolImpl = async (args, _extras) => {
  const title = getStringArg(args, "title");
  const tasksRaw = getStringArg(args, "tasks");

  let tasks: Array<{ content: string; status: string }>;
  try {
    tasks = JSON.parse(tasksRaw);
  } catch {
    return [
      {
        name: "Plan Error",
        description: "Invalid tasks JSON",
        content: `Could not parse tasks: ${tasksRaw}`,
      },
    ];
  }

  // Format the plan as markdown for display
  const taskLines = tasks
    .map((t, i) => {
      const checkbox =
        t.status === "completed"
          ? "[x]"
          : t.status === "in_progress"
            ? "[~]"
            : "[ ]";
      return `${i + 1}. ${checkbox} ${t.content}`;
    })
    .join("\n");

  const planContent = `# ${title}\n\n${taskLines}`;

  return [
    {
      name: title,
      description: "Execution Plan",
      content: planContent,
      uri: {
        type: "plan" as any,
        value: JSON.stringify({ title, tasks }),
      },
    },
  ];
};

/**
 * update_plan tool — Updates the status of tasks in an existing plan.
 *
 * Parameters:
 *   - task_index: 0-based index of the task to update
 *   - status: "pending" | "in_progress" | "completed"
 */
export const updatePlanImpl: ToolImpl = async (args, _extras) => {
  const taskIndex = parseInt(getStringArg(args, "task_index"), 10);
  const status = getStringArg(args, "status");

  return [
    {
      name: "Plan Updated",
      description: `Task ${taskIndex + 1} → ${status}`,
      content: `Task ${taskIndex + 1} status updated to "${status}"`,
      uri: {
        type: "plan_update" as any,
        value: JSON.stringify({ taskIndex, status }),
      },
    },
  ];
};
