import { Box, Text, useInput } from "ink";
import React from "react";

import { LoadingAnimation } from "./LoadingAnimation.js";
import { Timer } from "./Timer.js";

interface TaskProgressProps {
  taskId: string;
  taskType: string;
  status: "pending" | "running" | "completed" | "failed" | "killed";
  toolUseCount?: number;
  tokensUsed?: number;
  startTime?: number;
  onKill?: () => void;
}

const STATUS_DISPLAY: Record<string, { icon: string; color: string }> = {
  pending: { icon: "\u25CB", color: "yellow" },
  running: { icon: "\u25CF", color: "green" },
  completed: { icon: "\u2714", color: "green" },
  failed: { icon: "\u2716", color: "red" },
  killed: { icon: "\u25A0", color: "red" },
};

const TaskProgress: React.FC<TaskProgressProps> = ({
  taskId,
  taskType,
  status,
  toolUseCount = 0,
  tokensUsed = 0,
  startTime,
  onKill,
}) => {
  useInput((_input, key) => {
    if (key.escape && onKill && status === "running") {
      onKill();
    }
  });

  const display = STATUS_DISPLAY[status] ?? STATUS_DISPLAY.pending;

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box gap={1}>
        {status === "running" ? (
          <LoadingAnimation />
        ) : (
          <Text color={display.color}>{display.icon}</Text>
        )}
        <Text bold>{taskType}</Text>
        <Text color="dim">({taskId.slice(0, 8)})</Text>
        <Text color={display.color}>{status}</Text>
        {startTime && status === "running" && <Timer startTime={startTime} />}
      </Box>
      <Box paddingLeft={2} gap={2}>
        <Text color="dim">Tools: {toolUseCount}</Text>
        <Text color="dim">Tokens: {tokensUsed.toLocaleString()}</Text>
      </Box>
      {status === "running" && onKill && (
        <Box paddingLeft={2}>
          <Text color="dim">Press Esc to kill</Text>
        </Box>
      )}
    </Box>
  );
};

export { TaskProgress };
