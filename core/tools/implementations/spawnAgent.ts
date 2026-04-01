/**
 * Spawn Agent Tool
 *
 * Tool that spawns a sub-agent via the orchestrator for parallel task execution.
 * Each agent gets isolated context and crash boundaries.
 *
 * SOLID:
 * - SRP: Only spawns agents via orchestrator. No execution logic.
 */

import { spawnAgent, listActiveAgents, getActiveCount } from "../../agents/agentOrchestrator";
import type { ContextItem } from "../../";

interface SpawnAgentArgs {
  task: string;
  model?: string;
}

export async function spawnAgentImpl(
  args: SpawnAgentArgs,
): Promise<ContextItem[]> {
  const activeCount = getActiveCount();
  if (activeCount >= 3) {
    return [
      {
        name: "Spawn Agent",
        description: "Agent spawn queued",
        content: `All 3 agent slots are occupied. Your task has been queued and will start when a slot opens (30s timeout).\n\nActive agents:\n${listActiveAgents().map((a) => `- ${a.id.slice(0, 8)}: ${a.task.slice(0, 60)}`).join("\n")}`,
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
        `Agent spawned successfully.`,
        `- **ID:** ${handle.id}`,
        `- **Task:** ${handle.task}`,
        `- **Model:** ${handle.model}`,
        `- **Status:** ${handle.status}`,
        ``,
        `The agent is running in parallel. Check the Agent Manager (/agents) for status.`,
      ].join("\n"),
    },
  ];
}
