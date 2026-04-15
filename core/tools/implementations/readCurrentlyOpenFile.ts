import { getUriDescription } from "../../util/uri";

import { ToolImpl } from ".";
import { throwIfFileIsSecurityConcern } from "../../indexing/ignore";
import { ContinueError, ContinueErrorReason } from "../../util/errors";
import { formatScanFindingsMarkdown } from "../../util/formatScanFindings";
import { isFileBlockedByScanError } from "../../util/scanning";
import { throwIfFileExceedsHalfOfContext } from "./readFileLimit";
import type { ContextItem } from "../../index";

export const readCurrentlyOpenFileImpl: ToolImpl = async (_, extras) => {
  // The `ScanningIde` decorator intercepts `getCurrentFile` at `llm`
  // purpose: ALLOW passes through, REDACT rewrites `contents`, and
  // BLOCK throws the typed error we translate below. The inline
  // "AI Firewall" report is merged into the chat by core.ts via
  // the scan report channel — no per-site plumbing here.
  let result;
  try {
    result = await extras.ide.getCurrentFile();
  } catch (e) {
    if (isFileBlockedByScanError(e)) {
      const report = e.report;
      const detail =
        report.findings.length > 0
          ? `\n\n${formatScanFindingsMarkdown(
              report.filePath,
              "BLOCK",
              report.riskScore,
              [...report.findings],
            )}`
          : "";
      throw new ContinueError(
        ContinueErrorReason.FileIsSecurityConcern,
        `File blocked by security scan: ${report.reasons.join("; ") || `risk ${report.riskScore}`}${detail}`,
      );
    }
    throw e;
  }

  if (!result) {
    return [
      {
        name: `No Current File`,
        description: "",
        content: "There are no files currently open.",
      },
    ];
  }

  throwIfFileIsSecurityConcern(result.path);

  await throwIfFileExceedsHalfOfContext(
    result.path,
    result.contents,
    extras.config.selectedModelByRole.chat,
  );

  const { relativePathOrBasename, last2Parts, baseName } = getUriDescription(
    result.path,
    await extras.ide.getWorkspaceDirs(),
  );

  return [
    {
      name: `Current file: ${baseName}`,
      description: last2Parts,
      content: `\`\`\`${relativePathOrBasename}\n${result.contents}\n\`\`\``,
      uri: {
        type: "file",
        value: result.path,
      },
    },
  ] satisfies ContextItem[];
};
