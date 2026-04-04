import { Box, Text } from "ink";
import React from "react";

interface ModelCost {
  model: string;
  requests: number;
  tokens: number;
  cost: number;
}

interface CostDisplayProps {
  totalCost: number;
  breakdown: ModelCost[];
  sessionDuration?: string;
}

const CostDisplay: React.FC<CostDisplayProps> = ({
  totalCost,
  breakdown,
  sessionDuration,
}) => {
  return (
    <Box
      flexDirection="column"
      paddingX={1}
      borderStyle="single"
      borderColor="dim"
    >
      <Box gap={1}>
        <Text bold>Session Cost:</Text>
        <Text
          color={totalCost > 1.0 ? "red" : totalCost > 0.1 ? "yellow" : "green"}
          bold
        >
          ${totalCost.toFixed(4)}
        </Text>
        {sessionDuration && <Text color="dim">({sessionDuration})</Text>}
      </Box>
      {breakdown.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Box>
            <Text color="dim">{"Model".padEnd(28)}</Text>
            <Text color="dim">{"Reqs".padStart(6)}</Text>
            <Text color="dim">{"Tokens".padStart(10)}</Text>
            <Text color="dim">{"Cost".padStart(10)}</Text>
          </Box>
          {breakdown.map((row) => (
            <Box key={row.model}>
              <Text>{row.model.slice(0, 27).padEnd(28)}</Text>
              <Text>{String(row.requests).padStart(6)}</Text>
              <Text>{row.tokens.toLocaleString().padStart(10)}</Text>
              <Text color="yellow">
                {`$${row.cost.toFixed(4)}`.padStart(10)}
              </Text>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
};

export { CostDisplay };
