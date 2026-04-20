/**
 * DiffView — Ink component for colored diff display in the terminal.
 * Supports inline (unified) and side-by-side modes.
 */

import { Box, Text } from "ink";
import React from "react";

interface DiffLine {
  type: "add" | "remove" | "context";
  content: string;
}

interface DiffViewProps {
  lines: DiffLine[];
  fileName?: string;
  mode?: "inline" | "side-by-side";
}

function InlineView({ lines }: { lines: DiffLine[] }) {
  return (
    <Box flexDirection="column">
      {lines.map((line, i) => (
        <Text
          key={i}
          color={
            line.type === "add"
              ? "green"
              : line.type === "remove"
                ? "red"
                : undefined
          }
        >
          {line.type === "add" ? "+ " : line.type === "remove" ? "- " : "  "}
          {line.content}
        </Text>
      ))}
    </Box>
  );
}

function SideBySideView({ lines }: { lines: DiffLine[] }) {
  const removed = lines.filter(
    (l) => l.type === "remove" || l.type === "context",
  );
  const added = lines.filter((l) => l.type === "add" || l.type === "context");
  const maxLen = Math.max(removed.length, added.length);

  return (
    <Box flexDirection="column">
      {Array.from({ length: maxLen }, (_, i) => {
        const left = removed[i];
        const right = added[i];
        return (
          <Box key={i} gap={2}>
            <Box width="50%">
              <Text color={left?.type === "remove" ? "red" : undefined}>
                {left?.content ?? ""}
              </Text>
            </Box>
            <Text dimColor>{"|"}</Text>
            <Box width="50%">
              <Text color={right?.type === "add" ? "green" : undefined}>
                {right?.content ?? ""}
              </Text>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}

export function DiffView({ lines, fileName, mode = "inline" }: DiffViewProps) {
  if (lines.length === 0) {
    return <Text dimColor>No changes</Text>;
  }

  return (
    <Box flexDirection="column" borderStyle="single" paddingX={1}>
      {fileName && (
        <Text bold dimColor>
          {fileName}
        </Text>
      )}
      {mode === "side-by-side" ? (
        <SideBySideView lines={lines} />
      ) : (
        <InlineView lines={lines} />
      )}
      <Text dimColor>
        {lines.filter((l) => l.type === "add").length} additions,{" "}
        {lines.filter((l) => l.type === "remove").length} removals
      </Text>
    </Box>
  );
}
