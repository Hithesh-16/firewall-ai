import * as fs from "fs";

import { throwIfFileIsSecurityConcern } from "core/indexing/ignore.js";
import { ContinueError, ContinueErrorReason } from "core/util/errors.js";
import { formatScanFindingsMarkdown } from "core/util/formatScanFindings.js";
import { isFileBlockedByScanError } from "core/util/scanning/FileBlockedByScanError.js";

import { scanningReadFile } from "../services/ScanningFileIo.js";
import { parseEnvNumber } from "../util/truncateOutput.js";

import { formatToolArgument } from "./formatters.js";
import { Tool, ToolRunContext } from "./types.js";

// Output truncation defaults
const DEFAULT_READ_FILE_MAX_CHARS = 100000; // ~25k tokens
const DEFAULT_READ_FILE_MAX_LINES = 5000;

function getReadFileMaxChars(): number {
  return parseEnvNumber(
    process.env.AI_FIREWALL_CLI_READ_FILE_MAX_OUTPUT_CHARS,
    DEFAULT_READ_FILE_MAX_CHARS,
  );
}

function getReadFileMaxLines(): number {
  return parseEnvNumber(
    process.env.AI_FIREWALL_CLI_READ_FILE_MAX_OUTPUT_LINES,
    DEFAULT_READ_FILE_MAX_LINES,
  );
}

// Track files that have been read in the current session
export const readFilesSet = new Set<string>();
export function markFileAsRead(filePath: string) {
  readFilesSet.add(filePath);
}

export const readFileTool: Tool = {
  name: "Read",
  displayName: "Read",
  description: "Read the contents of a file at the specified path",
  parameters: {
    type: "object",
    required: ["filepath"],
    properties: {
      filepath: {
        type: "string",
        description: "The path to the file to read",
      },
    },
  },
  readonly: true,
  isBuiltIn: true,
  preprocess: async (args) => {
    let { filepath } = args;
    if (filepath.startsWith("./")) {
      filepath = filepath.slice(2);
    }
    throwIfFileIsSecurityConcern(filepath);
    return {
      args,
      preview: [
        {
          type: "text",
          content: `Will read ${formatToolArgument(filepath)}`,
        },
      ],
    };
  },
  run: async (
    args: { filepath: string },
    context?: ToolRunContext,
  ): Promise<string> => {
    try {
      let { filepath } = args;
      if (filepath.startsWith("./")) {
        filepath = filepath.slice(2);
      }

      if (!fs.existsSync(filepath)) {
        throw new ContinueError(
          ContinueErrorReason.Unspecified,
          `File does not exist: ${filepath}`,
        );
      }
      const realPath = fs.realpathSync(filepath);

      // All scan enforcement + REDACT substitution + BLOCK throwing
      // lives in `ScanningFileIo` — the CLI parallel of the core
      // `ScanningIde` decorator. One chokepoint across IDE + CLI.
      let content: string;
      let report;
      try {
        const result = await scanningReadFile(realPath, "llm");
        content = result.content;
        report = result.report;
      } catch (e) {
        if (isFileBlockedByScanError(e)) {
          const detail =
            e.report.findings.length > 0
              ? `\n\n${formatScanFindingsMarkdown(
                  e.report.filePath,
                  "BLOCK",
                  e.report.riskScore,
                  [...e.report.findings],
                )}`
              : "";
          throw new ContinueError(
            ContinueErrorReason.FileIsSecurityConcern,
            `File blocked by security scan: ${e.report.reasons.join("; ") || `risk ${e.report.riskScore}`}${detail}`,
          );
        }
        throw e;
      }

      // Divide limits by parallel tool call count to avoid context overflow
      const parallelCount = context?.parallelToolCallCount ?? 1;
      const baseMaxLines = getReadFileMaxLines();
      const baseMaxChars = getReadFileMaxChars();
      const maxLines = Math.floor(baseMaxLines / parallelCount);
      const maxChars = Math.floor(baseMaxChars / parallelCount);
      const lineCount = content.split("\n").length;
      const charCount = content.length;

      if (charCount > maxChars || lineCount > maxLines) {
        // Include note about single-tool limit when parallel calls reduce the limit
        const parallelNote =
          parallelCount > 1
            ? ` (Note: limit reduced due to ${parallelCount} parallel tool calls. Single-tool limit: ${baseMaxChars.toLocaleString()} characters or ${baseMaxLines.toLocaleString()} lines.)`
            : "";

        throw new ContinueError(
          ContinueErrorReason.FileTooLarge,
          `File is too large to read: ${filepath} (${charCount.toLocaleString()} characters, ${lineCount.toLocaleString()} lines). ` +
            `Maximum allowed: ${maxChars.toLocaleString()} characters or ${maxLines.toLocaleString()} lines.${parallelNote} ` +
            `Consider using terminal commands like 'head', 'tail', 'sed', or 'grep' to read targeted parts of the file.`,
        );
      }

      // Mark this file as read for the edit tool
      markFileAsRead(realPath);

      // Prepend the scan report when the shim produced one so the
      // agent (and the CLI banner) sees exactly what was redacted
      // and where, instead of relying on a separate notification.
      if (report) {
        const markdown = formatScanFindingsMarkdown(
          report.filePath,
          report.action,
          report.riskScore,
          [...report.findings],
        );
        return `${markdown}\n\nContent of ${filepath}:\n${content}`;
      }
      return `Content of ${filepath}:\n${content}`;
    } catch (error) {
      if (error instanceof ContinueError) {
        throw error;
      }
      throw new Error(
        `Error reading file: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  },
};
