import type { BlockDetail } from "core/llm/firewallScan.js";
import { Box, Text, useInput } from "ink";
import React, { useState } from "react";

interface FirewallConsentRequestProps {
  detail: BlockDetail;
  onResponse: (choice: "bypass" | "redact" | "cancel") => void;
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: "red",
  high: "red",
  medium: "yellow",
  low: "gray",
};

export const FirewallConsentRequest: React.FC<FirewallConsentRequestProps> = ({
  detail,
  onResponse,
}) => {
  const [responded, setResponded] = useState(false);

  useInput((input) => {
    if (responded) return;
    const key = input.toLowerCase();
    if (key === "r") {
      setResponded(true);
      onResponse("redact");
    } else if (key === "s") {
      setResponded(true);
      onResponse("bypass");
    } else if (key === "n" || key === "c") {
      setResponded(true);
      onResponse("cancel");
    }
  });

  if (responded) return null;

  const findings = detail.findings ?? [];
  const topFindings = findings.slice(0, 5);
  const moreCount = findings.length - topFindings.length;

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color="yellow">{"\u26A0 "}</Text>
        <Text color="yellow" bold>
          AI Firewall flagged this request
        </Text>
        <Text color="gray">
          {"  "}Risk {detail.riskScore}/100
        </Text>
      </Box>

      {topFindings.length > 0 && (
        <Box flexDirection="column" marginLeft={2}>
          {topFindings.map((f, i) => (
            <Box key={i}>
              <Text color={SEVERITY_COLORS[f.severity ?? "medium"] ?? "red"}>
                [{(f.severity ?? "med").toUpperCase()}]
              </Text>
              <Text color="gray"> {f.type}</Text>
              {f.masked ? (
                <>
                  <Text color="gray">: </Text>
                  <Text color="red" bold>
                    {f.masked}
                  </Text>
                </>
              ) : null}
            </Box>
          ))}
          {moreCount > 0 && (
            <Text color="gray">
              {"  "}+{moreCount} more
            </Text>
          )}
        </Box>
      )}

      {detail.reasons.length > 0 && (
        <Box marginLeft={2}>
          <Text color="gray">
            {detail.reasons.slice(0, 2).join(" \u2022 ")}
            {detail.reasons.length > 2
              ? ` \u2022 +${detail.reasons.length - 2} more`
              : ""}
          </Text>
        </Box>
      )}

      <Box marginLeft={2} marginTop={1}>
        <Text>
          {"["}
          <Text color="yellow" bold>
            r
          </Text>
          {"] Redact & send   ["}
          <Text color="red" bold>
            s
          </Text>
          {"] Send as-is   ["}
          <Text color="gray" bold>
            n
          </Text>
          {"] Cancel"}
        </Text>
      </Box>
    </Box>
  );
};
