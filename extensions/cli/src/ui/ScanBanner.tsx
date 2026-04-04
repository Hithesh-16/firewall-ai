import { Box, Text } from "ink";
import React from "react";

import type { ScanFinding } from "@ai-firewall/fetch";

interface ScanBannerProps {
  visible: boolean;
  action: "ALLOW" | "REDACT" | "BLOCK" | string;
  riskScore: number;
  secretsCount?: number;
  piiCount?: number;
  reasons?: string[];
  findings?: ScanFinding[];
}

const ACTION_STYLES: Record<string, { color: string; icon: string }> = {
  ALLOW: { color: "green", icon: "\u2714" },
  REDACT: { color: "yellow", icon: "\u26A0" },
  BLOCK: { color: "red", icon: "\u2716" },
};

const SEVERITY_COLORS: Record<string, string> = {
  critical: "red",
  high: "red",
  medium: "yellow",
  low: "dim",
};

const ScanBanner: React.FC<ScanBannerProps> = ({
  visible,
  action,
  riskScore,
  secretsCount = 0,
  piiCount = 0,
  reasons,
  findings,
}) => {
  if (!visible) return null;

  const style = ACTION_STYLES[action] ?? ACTION_STYLES.ALLOW;
  const hasFindings = findings && findings.length > 0;

  // Minimal one-line display for clean ALLOW results
  if (action === "ALLOW" && riskScore === 0 && !hasFindings) {
    return (
      <Box paddingX={1}>
        <Text color={style.color}>{style.icon} Scan: ALLOW</Text>
        <Text color="dim"> Risk: 0/100</Text>
      </Box>
    );
  }

  return (
    <Box
      flexDirection="column"
      paddingX={1}
      borderStyle="single"
      borderColor={style.color}
    >
      {/* Header */}
      <Box gap={1}>
        <Text color={style.color} bold>
          {style.icon} {action}
        </Text>
        <Text color="dim">Risk: {riskScore}/100</Text>
      </Box>

      {/* Counts */}
      {(secretsCount > 0 || piiCount > 0) && (
        <Box gap={2}>
          {secretsCount > 0 && <Text color="red">Secrets: {secretsCount}</Text>}
          {piiCount > 0 && <Text color="yellow">PII: {piiCount}</Text>}
        </Box>
      )}

      {/* Findings — show each malicious match in red */}
      {hasFindings && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="dim" bold>
            Detected:
          </Text>
          {findings.map((f, i) => (
            <Box key={i} gap={1}>
              <Text color={SEVERITY_COLORS[f.severity] ?? "red"}>
                {"\u2022"} [{f.severity.toUpperCase()}]
              </Text>
              <Text color="dim">{f.type}:</Text>
              <Text color="red" bold>
                {f.maskedValue}
              </Text>
            </Box>
          ))}
        </Box>
      )}

      {/* Reasons */}
      {reasons && reasons.length > 0 && !hasFindings && (
        <Box flexDirection="column" marginTop={1}>
          {reasons.map((reason, i) => (
            <Text key={i} color="dim">
              {"\u2022"} {reason}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
};

export { ScanBanner };
