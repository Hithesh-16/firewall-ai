import { ToolImpl } from ".";
import { getStringArg } from "../parseArgs";

export type PlanStatus = "pending" | "in_progress" | "completed" | "cancelled";

export interface PlanTask {
  content: string;
  status: PlanStatus;
  phase?: string;
}

export interface PlanState {
  title: string;
  tasks: PlanTask[];
  summary?: string;
  risk?: string;
}

let currentPlan: PlanState | null = null;
let pendingProposal: PlanState | null = null;

type PlanListener = (
  plan: PlanState | null,
  proposal: PlanState | null,
) => void;
const listeners = new Set<PlanListener>();

function emit(): void {
  for (const fn of listeners) {
    try {
      fn(currentPlan, pendingProposal);
    } catch {
      /* ignore */
    }
  }
}

export function subscribePlans(listener: PlanListener): () => void {
  listeners.add(listener);
  try {
    listener(currentPlan, pendingProposal);
  } catch {
    /* ignore */
  }
  return () => {
    listeners.delete(listener);
  };
}

export function resetPlanState(): void {
  currentPlan = null;
  pendingProposal = null;
  emit();
}

export function approveProposal(): void {
  if (pendingProposal) {
    currentPlan = pendingProposal;
    pendingProposal = null;
    emit();
  }
}

export function rejectProposal(): void {
  pendingProposal = null;
  emit();
}

export function updatePlanState(plan: PlanState): void {
  currentPlan = plan;
  emit();
}

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
  const title = String(args.title || "Plan");
  const tasks = Array.isArray(args.tasks) ? (args.tasks as PlanTask[]) : [];

  currentPlan = { title, tasks };
  emit();

  // Format the plan as markdown for display
  let currentPhase = "";
  const lines: string[] = [`# ${title}\n`];

  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    if (t.phase && t.phase !== currentPhase) {
      currentPhase = t.phase;
      lines.push(`\n### ${currentPhase}`);
    }
    const mark =
      t.status === "completed"
        ? "[x]"
        : t.status === "in_progress"
          ? "[~]"
          : t.status === "cancelled"
            ? "[-]"
            : "[ ]";
    lines.push(`${i + 1}. ${mark} ${t.content}`);
  }

  const planContent = lines.join("\n");

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
 * propose_plan tool — Emits a plan that the UI gates behind user approval
 * before the agent is allowed to execute it. The agent MUST NOT
 * continue with other tool calls in the same turn after proposing a
 * plan; it should stop and wait for the user to approve or revise.
 *
 * Parameters:
 *   - title: Plan title
 *   - summary: One-paragraph explanation of intent + impact
 *   - tasks: array of task objects: [{ content, status, phase? }]
 *   - risk: optional "low" | "medium" | "high" — surfaces in the UI
 *
 * The context item carries `uri.type = "plan_proposal"` so the GUI can
 * render it with Approve / Revise buttons instead of inline markdown.
 */
export const proposePlanImpl: ToolImpl = async (args, _extras) => {
  const title = String(args.title || "Plan Proposal");
  const summary = String(args.summary || "");
  const tasks = Array.isArray(args.tasks) ? (args.tasks as PlanTask[]) : [];
  const risk = (args.risk as string | undefined)?.toLowerCase();

  const riskLabel =
    risk === "high" || risk === "medium" || risk === "low" ? risk : undefined;

  pendingProposal = { title, summary, tasks, risk: riskLabel };
  emit();

  // Format the plan as markdown for display
  let currentPhase = "";
  const lines: string[] = [`# ${title}\n`];
  if (riskLabel) lines.push(`_Risk: ${riskLabel}_\n`);
  if (summary) lines.push(`${summary}\n`);

  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    if (t.phase && t.phase !== currentPhase) {
      currentPhase = t.phase;
      lines.push(`\n### ${currentPhase}`);
    }
    const mark =
      t.status === "completed"
        ? "[x]"
        : t.status === "in_progress"
          ? "[~]"
          : t.status === "cancelled"
            ? "[-]"
            : "[ ]";
    lines.push(`${i + 1}. ${mark} ${t.content}`);
  }

  lines.push("\n---");
  lines.push(
    "Waiting for user approval. Do not execute further tool calls until approved.",
  );

  const planContent = lines.join("\n");

  return [
    {
      name: title,
      description: "Plan awaiting approval",
      content: planContent,
      uri: {
        type: "plan_proposal" as any,
        value: JSON.stringify({ title, summary, tasks, risk: riskLabel }),
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
  const taskIndex = Number(args.task_index);
  const status = String(args.status || "pending") as PlanStatus;

  if (isNaN(taskIndex)) {
    return [
      {
        name: "Update Error",
        description: "Invalid task index",
        content: `Index "${args.task_index}" is not a number.`,
      },
    ];
  }

  if (currentPlan && currentPlan.tasks[taskIndex]) {
    currentPlan.tasks[taskIndex].status = status;
    emit();
  }

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
