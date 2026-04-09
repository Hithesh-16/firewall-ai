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

const ACTION_STYLES: Record<
  string,
  { color: string; icon: string; label: string }
> = {
  ALLOW: { color: "green", icon: "\u2714", label: "ALLOW" },
  REDACT: { color: "yellow", icon: "\u26A0", label: "REDACT" },
  BLOCK: { color: "red", icon: "\u2716", label: "BLOCK" },
};

const SEVERITY_SHORT: Record<string, string> = {
  critical: "CRIT",
  high: "HIGH",
  medium: "MED",
  low: "LOW",
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

  // Clean ALLOW with no risk — single minimal line
  if (action === "ALLOW" && riskScore === 0 && !hasFindings) {
    return (
      <Box paddingX={1}>
        <Text color="green" dimColor>
          {style.icon} Scanned
        </Text>
        <Text color="dim"> Risk: 0</Text>
      </Box>
    );
  }

  // Compact inline banner: icon + label + risk + counts + top findings on one or two lines
  const countParts: string[] = [];
  if (secretsCount > 0)
    countParts.push(`${secretsCount} secret${secretsCount > 1 ? "s" : ""}`);
  if (piiCount > 0) countParts.push(`${piiCount} PII`);
  const countsText =
    countParts.length > 0 ? ` \u2022 ${countParts.join(", ")}` : "";

  // Show up to 3 findings inline
  const topFindings = hasFindings ? findings.slice(0, 3) : [];
  const moreCount = hasFindings ? findings.length - topFindings.length : 0;

  return (
    <Box flexDirection="column" paddingX={1}>
      {/* Line 1: action + risk + counts */}
      <Box gap={0}>
        <Text color={style.color} bold>
          {style.icon} {style.label}
        </Text>
        <Text color="dim">
          {" "}
          Risk: {riskScore}/100{countsText}
        </Text>
      </Box>

      {/* Line 2 (optional): compact findings */}
      {topFindings.length > 0 && (
        <Box gap={1} paddingLeft={2}>
          {topFindings.map((f, i) => (
            <Box key={i} gap={0}>
              <Text color={SEVERITY_COLORS[f.severity] ?? "red"}>
                [{SEVERITY_SHORT[f.severity] ?? f.severity.toUpperCase()}]
              </Text>
              <Text color="dim"> {f.type}: </Text>
              <Text color="red" bold>
                {f.maskedValue}
              </Text>
              {i < topFindings.length - 1 && <Text color="dim"> </Text>}
            </Box>
          ))}
          {moreCount > 0 && <Text color="dim">+{moreCount} more</Text>}
        </Box>
      )}

      {/* Fallback: reasons if no findings */}
      {!hasFindings && reasons && reasons.length > 0 && (
        <Box paddingLeft={2}>
          <Text color="dim">{reasons.slice(0, 2).join(" \u2022 ")}</Text>
          {reasons.length > 2 && (
            <Text color="dim"> +{reasons.length - 2} more</Text>
          )}
        </Box>
      )}
    </Box>
  );
};

export { ScanBanner };
