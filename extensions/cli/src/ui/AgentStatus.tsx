import { Box, Text } from "ink";
import React from "react";
import { LoadingAnimation } from "./LoadingAnimation.js";
import { Timer } from "./Timer.js";

interface AgentInfo {
  taskId: string;
  name: string;
  status: "running" | "completed" | "failed" | "killed";
  startTime: number;
  progress?: number;
}

interface AgentStatusProps {
  agents: AgentInfo[];
}

const STATUS_DISPLAY: Record<string, { color: string; icon: string }> = {
  running: { color: "green", icon: "\u25CF" },
  completed: { color: "green", icon: "\u2714" },
  failed: { color: "red", icon: "\u2716" },
  killed: { color: "red", icon: "\u25A0" },
};

function renderProgressBar(progress: number): string {
  const width = 20;
  const filled = Math.round((progress / 100) * width);
  const empty = width - filled;
  return "\u2588".repeat(filled) + "\u2591".repeat(empty);
}

const AgentStatus: React.FC<AgentStatusProps> = ({ agents }) => {
  if (agents.length === 0) {
    return (
      <Box paddingX={1}>
        <Text color="dim">No active agents.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>Agents ({agents.length})</Text>
      {agents.map((agent) => {
        const display = STATUS_DISPLAY[agent.status] ?? STATUS_DISPLAY.running;
        return (
          <Box key={agent.taskId} flexDirection="column" marginTop={1}>
            <Box gap={1}>
              {agent.status === "running" ? (
                <LoadingAnimation />
              ) : (
                <Text color={display.color}>{display.icon}</Text>
              )}
              <Text bold>{agent.name}</Text>
              <Text color={display.color}>{agent.status}</Text>
              {agent.status === "running" && (
                <Timer startTime={agent.startTime} />
              )}
            </Box>
            {agent.progress !== undefined && (
              <Box paddingLeft={2} gap={1}>
                <Text color="cyan">{renderProgressBar(agent.progress)}</Text>
                <Text color="dim">{agent.progress}%</Text>
              </Box>
            )}
          </Box>
        );
      })}
    </Box>
  );
};

export { AgentStatus };
