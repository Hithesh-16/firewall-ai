/**
 * Spawn Agent Tool
 *
 * Delegates a self-contained task to a parallel worker spawned by
 * `agentOrchestrator`. Each worker runs in its own thread so a crash
 * can't take down the primary session. Max 3 concurrent agents.
 */

import type { ContextItem } from "../../";
import {
  spawnAgent,
  listActiveAgents,
  getActiveCount,
} from "../../agents/agentOrchestrator";
import { ToolImpl } from ".";

interface SpawnAgentArgs {
  task: string;
  model?: string;
}

export const spawnAgentImpl: ToolImpl = async (
  rawArgs,
): Promise<ContextItem[]> => {
  const args = rawArgs as SpawnAgentArgs;
  if (!args?.task || typeof args.task !== "string") {
    return [
      {
        name: "Spawn Agent",
        description: "Missing task",
        content:
          "spawn_agent requires a `task` string. Do not retry without providing one.",
      },
    ];
  }

  if (getActiveCount() >= 3) {
    const queued = listActiveAgents()
      .map((a) => `- ${a.id.slice(0, 8)}: ${a.task.slice(0, 80)}`)
      .join("\n");
    return [
      {
        name: "Spawn Agent",
        description: "Queued — max concurrency reached",
        content: [
          "All 3 worker slots are busy. Your task was queued and will start when a slot frees up (30s timeout).",
          "",
          "Currently running:",
          queued || "(none)",
        ].join("\n"),
      },
    ];
  }

  const handle = await spawnAgent({
    task: args.task,
    model: args.model,
  });

  return [
    {
      name: "Spawn Agent",
      description: `Agent ${handle.id.slice(0, 8)} spawned`,
      content: [
        `Sub-agent spawned in parallel. It will run to completion independently.`,
        "",
        `- **ID:** ${handle.id}`,
        `- **Task:** ${handle.task}`,
        `- **Model:** ${handle.model}`,
        `- **Status:** ${handle.status}`,
        "",
        `Call list_agents to check progress. Do NOT spawn additional agents for the same task.`,
      ].join("\n"),
    },
  ];
};

export const listAgentsImpl: ToolImpl = async (): Promise<ContextItem[]> => {
  const agents = listActiveAgents();
  if (agents.length === 0) {
    return [
      {
        name: "List Agents",
        description: "No active sub-agents",
        content: "There are no sub-agents spawned in this session.",
      },
    ];
  }

  const lines = agents.map((a) => {
    const elapsed = Math.max(0, Math.round((Date.now() - a.startedAt) / 1000));
    const tail = a.output ? `\n  output: ${a.output.slice(-240)}` : "";
    const err = a.error ? `\n  error: ${a.error}` : "";
    return `- **${a.id.slice(0, 8)}** [${a.status}, ${elapsed}s]: ${a.task.slice(0, 120)}${tail}${err}`;
  });

  return [
    {
      name: "List Agents",
      description: `${agents.length} sub-agent${agents.length === 1 ? "" : "s"}`,
      content: lines.join("\n\n"),
    },
  ];
};
