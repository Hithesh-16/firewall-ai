import { resolveInputPath } from "../../util/pathResolver";
import { getUriPathBasename } from "../../util/uri";

import { ToolImpl } from ".";
import { throwIfFileIsSecurityConcern } from "../../indexing/ignore";
import { ContinueError, ContinueErrorReason } from "../../util/errors";
import {
  scanFileViaProxy,
  type FileScanFinding,
} from "../../util/fileScanProxy";
import {
  formatScanFindingsMarkdown,
  formatScanFindingsSummary,
} from "../../util/formatScanFindings";
import { getNumberArg, getStringArg } from "../parseArgs";
import { throwIfFileExceedsHalfOfContext } from "./readFileLimit";
import type { ContextItem } from "../../index";

// Use Int.MAX_VALUE from Java/Kotlin (2^31 - 1) instead of JavaScript's Number.MAX_SAFE_INTEGER
// to ensure compatibility with IntelliJ's Kotlin Position type which uses Int for character field
export const MAX_CHAR_POSITION = 2147483647;

export const readFileRangeImpl: ToolImpl = async (args, extras) => {
  const filepath = getStringArg(args, "filepath");
  const startLine = getNumberArg(args, "startLine");
  const endLine = getNumberArg(args, "endLine");

  // Validate that line numbers are positive integers
  if (startLine < 1) {
    throw new ContinueError(
      ContinueErrorReason.InvalidLineNumber,
      "startLine must be 1 or greater. Negative line numbers are not supported - use the terminal tool with 'tail' command for reading from file end.",
    );
  }
  if (endLine < 1) {
    throw new ContinueError(
      ContinueErrorReason.InvalidLineNumber,
      "endLine must be 1 or greater. Negative line numbers are not supported - use the terminal tool with 'tail' command for reading from file end.",
    );
  }
  if (endLine < startLine) {
    throw new ContinueError(
      ContinueErrorReason.InvalidLineNumber,
      `endLine (${endLine}) must be greater than or equal to startLine (${startLine})`,
    );
  }

  // Resolve the path first to get the actual path for security check
  const resolvedPath = await resolveInputPath(extras.ide, filepath);
  if (!resolvedPath) {
    throw new ContinueError(
      ContinueErrorReason.FileNotFound,
      `File "${filepath}" does not exist or is not accessible. You might want to check the path and try again.`,
    );
  }

  // Security check on the resolved display path
  throwIfFileIsSecurityConcern(resolvedPath.displayPath);

  // Phase E: route through the proxy's role-aware file scan before
  // reading any bytes. Blocks any file matching `file_scope.blocklist`
  // in the caller's effective policy — including per-role overrides
  // the admin configured in RBAC. Fail-open if the proxy is
  // unreachable; fail-closed is opt-in via policy.
  const scanDecision = await scanFileViaProxy(
    resolvedPath.displayPath,
    extras.fetch as typeof fetch,
  );

  // Only surface findings that fall inside the requested line range —
  // the user only sees lines startLine..endLine, so referencing line
  // 200 in a 1..50 read would just confuse them.
  const visibleFindings: FileScanFinding[] = (
    scanDecision.findings ?? []
  ).filter((f) => f.line >= startLine && f.line <= endLine);

  if (scanDecision.action === "BLOCK") {
    const detail =
      visibleFindings.length > 0
        ? `\n\n${formatScanFindingsMarkdown(
            resolvedPath.displayPath,
            "BLOCK",
            scanDecision.riskScore,
            visibleFindings,
          )}`
        : "";
    throw new ContinueError(
      ContinueErrorReason.FileIsSecurityConcern,
      `File blocked by security scan: ${scanDecision.reasons.join("; ")} (risk: ${scanDecision.riskScore})${detail}`,
    );
  }

  // Use the IDE's readRangeInFile method with 0-based range (IDE expects 0-based internally)
  const content = await extras.ide.readRangeInFile(resolvedPath.uri, {
    start: {
      line: startLine - 1, // Convert from 1-based to 0-based
      character: 0,
    },
    end: {
      line: endLine - 1, // Convert from 1-based to 0-based
      character: MAX_CHAR_POSITION, // Read to end of line
    },
  });

  await throwIfFileExceedsHalfOfContext(
    resolvedPath.displayPath,
    content,
    extras.config.selectedModelByRole.chat,
  );

  const rangeDescription = `${resolvedPath.displayPath} (lines ${startLine}-${endLine})`;

  const items: ContextItem[] = [
    {
      name: getUriPathBasename(resolvedPath.uri),
      description: rangeDescription,
      content,
      uri: {
        type: "file",
        value: resolvedPath.uri,
      },
    },
  ];
  if (scanDecision.action !== "ALLOW" || visibleFindings.length > 0) {
    items.push({
      name: "AI Firewall",
      description: formatScanFindingsSummary(
        scanDecision.action,
        visibleFindings,
      ),
      content: formatScanFindingsMarkdown(
        resolvedPath.displayPath,
        scanDecision.action,
        scanDecision.riskScore,
        visibleFindings,
      ),
      icon: "shield",
    });
  }
  return items;
};
