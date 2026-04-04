import { Box, Text } from "ink";
import React from "react";

interface MemoryItem {
  fileName: string;
  type: "user" | "feedback" | "project" | "reference";
  title?: string;
}

interface MemoryBrowserProps {
  memories: MemoryItem[];
}

const TYPE_COLORS: Record<string, string> = {
  user: "cyan",
  feedback: "yellow",
  project: "green",
  reference: "magenta",
};

const TYPE_ICONS: Record<string, string> = {
  user: "\uD83D\uDC64",
  feedback: "\uD83D\uDCAC",
  project: "\uD83D\uDCC1",
  reference: "\uD83D\uDCDA",
};

const MemoryBrowser: React.FC<MemoryBrowserProps> = ({ memories }) => {
  if (memories.length === 0) {
    return (
      <Box paddingX={1}>
        <Text color="dim">No memories stored yet.</Text>
      </Box>
    );
  }

  // Group by type
  const grouped = memories.reduce<Record<string, MemoryItem[]>>((acc, mem) => {
    const group = acc[mem.type] ?? [];
    return { ...acc, [mem.type]: [...group, mem] };
  }, {});

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>Memories ({memories.length})</Text>
      <Box marginTop={1} flexDirection="column">
        {Object.entries(grouped).map(([type, items]) => (
          <Box key={type} flexDirection="column" marginBottom={1}>
            <Box gap={1}>
              <Text>{TYPE_ICONS[type] ?? "\u2022"}</Text>
              <Text color={TYPE_COLORS[type] ?? "dim"} bold>
                {type} ({items.length})
              </Text>
            </Box>
            {items.map((item) => (
              <Box key={item.fileName} paddingLeft={3}>
                <Text color="dim">{"\u2022"} </Text>
                <Text>{item.title ?? item.fileName}</Text>
              </Box>
            ))}
          </Box>
        ))}
      </Box>
    </Box>
  );
};

export { MemoryBrowser };
