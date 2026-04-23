import { Tool } from "../..";

import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../builtIn";

/**
 * Delegates a sub-task to a parallel worker agent. Max 3 concurrent;
 * queued if full. Each agent runs in its own worker_thread so a crash
 * can't take down the primary session.
 *
 * The orchestrator returns immediately with a handle — use
 * `list_agents` to check status and outputs. This mirrors Claude
 * Code's Agent tool and Kilocode's `task` tool.
 */
export const spawnAgentTool: Tool = {
  type: "function",
  displayTitle: "Spawn Sub-Agent",
  wouldLikeTo: 'spawn a sub-agent for "{{{ task }}}"',
  isCurrently: 'spawning sub-agent for "{{{ task }}}"',
  hasAlready: 'spawned sub-agent for "{{{ task }}}"',
  readonly: false,
  group: BUILT_IN_GROUP_NAME,
  function: {
    name: BuiltInToolNames.SpawnAgent,
    description:
      "Delegate an isolated sub-task to a worker agent that runs in parallel. Use for tasks that would bloat the main conversation — e.g. exploring an unfamiliar area of the repo, running a long search, or drafting a large change whose intermediate thinking you don't need to see. The agent returns a summary, not a full transcript. Max 3 concurrent agents; additional spawns are queued. Do NOT use for tasks you could complete in a single tool call.",
    parameters: {
      type: "object",
      required: ["task"],
      properties: {
        task: {
          type: "string",
          description:
            "Self-contained instruction for the sub-agent. Include success criteria and any constraints — the sub-agent has no memory of this conversation.",
        },
        model: {
          type: "string",
          description:
            "Optional model slug for the sub-agent. Defaults to the parent session's chat model.",
        },
      },
    },
  },
  defaultToolPolicy: "allowedWithPermission",
  systemMessageDescription: {
    prefix: `To delegate a self-contained sub-task to a parallel worker agent, use ${BuiltInToolNames.SpawnAgent} with a clear task description. For example:`,
    exampleArgs: [
      [
        "task",
        "Explore the authentication flow starting from proxy/src/auth/ and return a 10-bullet summary of the SSO verification path.",
      ],
    ],
  },
  toolCallIcon: "CpuChipIcon",
};

/**
 * Read-only status view. Returns whatever `listActiveAgents` knows
 * right now — running, completed, or failed — so the model can decide
 * whether to wait, retry, or move on.
 */
export const listAgentsTool: Tool = {
  type: "function",
  displayTitle: "List Agents",
  wouldLikeTo: "list active sub-agents",
  isCurrently: "listing active sub-agents",
  hasAlready: "listed active sub-agents",
  readonly: true,
  group: BUILT_IN_GROUP_NAME,
  function: {
    name: BuiltInToolNames.ListAgents,
    description:
      "List currently known sub-agents (running, completed, failed) with their status, task summary, and last output. Use after spawn_agent to poll for results.",
    parameters: {
      type: "object",
      properties: {},
    },
  },
  defaultToolPolicy: "allowedWithoutPermission",
  systemMessageDescription: {
    prefix: `To check the status of previously spawned sub-agents, call ${BuiltInToolNames.ListAgents} with no arguments.`,
    exampleArgs: [],
  },
  toolCallIcon: "ListBulletIcon",
};
