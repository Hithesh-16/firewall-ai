import { Tool } from "../..";

import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../builtIn";

/**
 * Tool definitions for the plan workflow. Three tools work together:
 *
 *   propose_plan → agent pitches a plan, UI gates it with Approve/Revise
 *   create_plan  → commits a plan into the PlanPanel after approval
 *   update_plan  → flips task status as work progresses
 *
 * propose_plan carries `defaultToolPolicy: "allowedWithPermission"`
 * because the whole point is to pause before anything else runs.
 * create_plan and update_plan run without permission — they're the
 * plumbing that keeps the panel in sync with the agent's progress.
 */

export const proposePlanTool: Tool = {
  type: "function",
  displayTitle: "Propose Plan",
  wouldLikeTo: 'propose a plan: "{{{ title }}}"',
  isCurrently: 'proposing plan "{{{ title }}}"',
  hasAlready: 'proposed the plan "{{{ title }}}"',
  readonly: true,
  group: BUILT_IN_GROUP_NAME,
  function: {
    name: BuiltInToolNames.ProposePlan,
    description:
      "Emit a step-by-step plan for the user to approve BEFORE making changes. Use for any task that spans multiple files or touches risky surfaces (auth, schema, CI/CD, deletes). The UI blocks further tool calls until the user approves. Do NOT call any other tools in the same turn as propose_plan.",
    parameters: {
      type: "object",
      required: ["title", "summary", "tasks"],
      properties: {
        title: { type: "string", description: "Short plan title" },
        summary: {
          type: "string",
          description:
            "One paragraph describing intent, expected impact, and files/areas touched.",
        },
        tasks: {
          type: "string",
          description:
            'JSON array of {content, status} objects, e.g. [{"content":"Add route handler","status":"pending"}]',
        },
        risk: {
          type: "string",
          description: 'Optional: "low" | "medium" | "high"',
        },
      },
    },
  },
  defaultToolPolicy: "allowedWithPermission",
  systemMessageDescription: {
    prefix: `To propose an approval-gated plan, call ${BuiltInToolNames.ProposePlan}. Always set an honest risk level. After calling, stop and wait for approval. Example:`,
    exampleArgs: [
      ["title", "Add /v1/web-search route"],
      [
        "summary",
        "Introduce a proxy endpoint that wraps Tavily for agent web search, with Zod validation and rate limiting.",
      ],
      [
        "tasks",
        '[{"content":"Add Zod schema","status":"pending"},{"content":"Register route","status":"pending"},{"content":"Add integration test","status":"pending"}]',
      ],
      ["risk", "medium"],
    ],
  },
  toolCallIcon: "ClipboardDocumentCheckIcon",
};

export const createPlanTool: Tool = {
  type: "function",
  displayTitle: "Create Plan",
  wouldLikeTo: 'commit the plan "{{{ title }}}"',
  isCurrently: 'creating plan "{{{ title }}}"',
  hasAlready: 'created the plan "{{{ title }}}"',
  readonly: false,
  group: BUILT_IN_GROUP_NAME,
  function: {
    name: BuiltInToolNames.CreatePlan,
    description:
      "Commit a plan into the PlanPanel so it stays visible while work proceeds. Prefer propose_plan first for anything non-trivial.",
    parameters: {
      type: "object",
      required: ["title", "tasks"],
      properties: {
        title: { type: "string" },
        tasks: {
          type: "string",
          description: "JSON array of {content, status} objects.",
        },
      },
    },
  },
  defaultToolPolicy: "allowedWithoutPermission",
  systemMessageDescription: {
    prefix: `To commit an approved or low-risk plan, call ${BuiltInToolNames.CreatePlan}.`,
    exampleArgs: [
      ["title", "Refactor auth middleware"],
      [
        "tasks",
        '[{"content":"Extract middleware","status":"pending"},{"content":"Add tests","status":"pending"}]',
      ],
    ],
  },
  toolCallIcon: "ClipboardDocumentListIcon",
};

export const updatePlanTool: Tool = {
  type: "function",
  displayTitle: "Update Plan",
  wouldLikeTo: "update plan task {{{ task_index }}}",
  isCurrently: "updating plan task {{{ task_index }}}",
  hasAlready: "updated plan task {{{ task_index }}}",
  readonly: false,
  group: BUILT_IN_GROUP_NAME,
  function: {
    name: BuiltInToolNames.UpdatePlan,
    description:
      "Flip a plan task's status. Call as soon as work on that task starts and again when it finishes — don't batch.",
    parameters: {
      type: "object",
      required: ["task_index", "status"],
      properties: {
        task_index: {
          type: "string",
          description: "0-based index of the task to update.",
        },
        status: {
          type: "string",
          description: '"pending" | "in_progress" | "completed"',
        },
      },
    },
  },
  defaultToolPolicy: "allowedWithoutPermission",
  systemMessageDescription: {
    prefix: `To flip a plan task's status, call ${BuiltInToolNames.UpdatePlan}.`,
    exampleArgs: [
      ["task_index", "0"],
      ["status", "in_progress"],
    ],
  },
  toolCallIcon: "CheckCircleIcon",
};
