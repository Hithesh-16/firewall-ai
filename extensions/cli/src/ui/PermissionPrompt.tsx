import { Box, Text, useInput } from "ink";
import React, { useState } from "react";

interface PermissionPromptProps {
  toolName: string;
  riskLevel: "low" | "medium" | "high" | "critical";
  description?: string;
  onResolve: (decision: "allow" | "deny" | "always") => void;
}

const RISK_COLORS: Record<string, string> = {
  low: "green",
  medium: "yellow",
  high: "red",
  critical: "redBright",
};

const PermissionPrompt: React.FC<PermissionPromptProps> = ({
  toolName,
  riskLevel,
  description,
  onResolve,
}) => {
  const [selected, setSelected] = useState(0);
  const options = ["Allow", "Deny", "Always Allow"] as const;
  const decisions = ["allow", "deny", "always"] as const;

  useInput((_input, key) => {
    if (key.leftArrow) {
      setSelected((prev) => Math.max(0, prev - 1));
    } else if (key.rightArrow) {
      setSelected((prev) => Math.min(options.length - 1, prev + 1));
    } else if (key.return) {
      onResolve(decisions[selected]);
    }
  });

  const riskColor = RISK_COLORS[riskLevel] ?? "dim";

  return (
    <Box
      flexDirection="column"
      paddingX={1}
      paddingY={1}
      borderStyle="single"
      borderColor="yellow"
    >
      <Box>
        <Text color="yellow" bold>
          {"\u26A0"} Permission Request
        </Text>
      </Box>
      <Box marginTop={1}>
        <Text>Tool: </Text>
        <Text bold>{toolName}</Text>
        <Text> Risk: </Text>
        <Text color={riskColor} bold>
          {riskLevel.toUpperCase()}
        </Text>
      </Box>
      {description && (
        <Box>
          <Text color="dim">{description}</Text>
        </Box>
      )}
      <Box marginTop={1} gap={2}>
        {options.map((label, i) => (
          <Text
            key={label}
            inverse={i === selected}
            color={i === 1 ? "red" : "green"}
          >
            {` ${label} `}
          </Text>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text color="dim">{"\u2190\u2192"} to select, Enter to confirm</Text>
      </Box>
    </Box>
  );
};

export { PermissionPrompt };
