import * as fs from "fs";
import * as path from "path";

import { ContinueError, ContinueErrorReason } from "core/util/errors.js";
import { scanFileViaProxy } from "core/util/fileScanProxy.js";
import { isFileBlockedByScanError } from "core/util/scanning/FileBlockedByScanError.js";
import { createTwoFilesPatch } from "diff";

import { scanningReadFile } from "../services/ScanningFileIo.js";
import { telemetryService } from "../telemetry/telemetryService.js";
import {
  calculateLinesOfCodeDiff,
  getLanguageFromFilePath,
} from "../telemetry/utils.js";

import { Tool, ToolCallPreview } from "./types.js";

export function generateDiff(
  oldContent: string,
  newContent: string,
  filePath: string,
): string {
  return createTwoFilesPatch(
    filePath,
    filePath,
    oldContent,
    newContent,
    undefined,
    undefined,
    { context: 3 },
  );
}

export const writeFileTool: Tool = {
  name: "Write",
  displayName: "Write",
  description: "Write content to a file at the specified path",
  parameters: {
    type: "object",
    required: ["filepath", "content"],
    properties: {
      filepath: {
        type: "string",
        description: "The path to the file to write",
      },
      content: {
        type: "string",
        description: "The content to write to the file",
      },
    },
  },
  readonly: false,
  isBuiltIn: true,
  preprocess: async (args) => {
    const filepath = args?.filepath;
    const content = args?.content ?? "";
    if (typeof filepath !== "string") {
      throw new Error("Filepath must be a string");
    }
    if (typeof content !== "string") {
      throw new Error("New file content must be a string");
    }

    // Phase E: block writes to any path the effective policy's
    // file_scope.blocklist rejects. Without this, an agent can
    // create/overwrite an .env file even when the role policy
    // forbids reading one. We scan the *target* path (which may
    // not exist yet) — the proxy's scan returns BLOCK purely on
    // path-pattern match when the file is missing, which is what
    // we want here.
    const writeScan = await scanFileViaProxy(filepath);
    if (writeScan.action === "BLOCK") {
      throw new ContinueError(
        ContinueErrorReason.FileIsSecurityConcern,
        `Write blocked by security scan: ${writeScan.reasons.join("; ")} (risk: ${writeScan.riskScore})`,
      );
    }

    try {
      if (fs.existsSync(filepath)) {
        // Phase B (SECURITY_HARDENING_PLAN.md CH6): route the
        // preview read through the scanning shim. The write itself
        // was already gated by the `scanFileViaProxy(filepath)`
        // check above, so this isn't a security gap per se — but
        // routing through the shim keeps the invariant "no CLI tool
        // touches `fs.readFileSync` on a project file directly" so
        // future tool authors can't mistakenly bypass scanning.
        let oldContent: string;
        try {
          const result = await scanningReadFile(filepath, "llm");
          oldContent = result.content;
        } catch (err) {
          if (isFileBlockedByScanError(err)) {
            throw new ContinueError(
              ContinueErrorReason.FileIsSecurityConcern,
              `Write preview blocked by security scan: ${err.report.reasons.join("; ")} ` +
                `(risk: ${err.report.riskScore})`,
            );
          }
          throw err;
        }

        const diff = createTwoFilesPatch(
          args.filepath,
          args.filepath,
          oldContent,
          content,
          undefined,
          undefined,
          { context: 2 },
        );

        return {
          args,
          preview: [
            {
              type: "text",
              content: "Preview of changes:",
            },
            {
              type: "diff",
              content: diff,
            },
          ],
        };
      }
    } catch (err) {
      // Re-throw security errors — they're explicit user-facing
      // BLOCKs and must not be swallowed by the original "do nothing"
      // catch-all (which existed only to tolerate file-doesn't-exist
      // races on `existsSync` → `readFileSync`).
      if (err instanceof ContinueError) {
        throw err;
      }
      // do nothing for benign errors (e.g., race on existsSync)
    }
    const lines: string[] = content.split("\n");
    const previewLines = lines.slice(0, 3);

    const preview: ToolCallPreview[] = [
      {
        type: "text",
        content: "New file content:",
      },
      ...previewLines.map((line) => ({
        type: "text" as const,
        content: line || " ",
        paddingLeft: 2,
      })),
    ];
    if (lines.length > 3) {
      preview.push({
        type: "text",
        content: `... (${lines.length - 3} more lines)`,
      });
    }

    return {
      args: {
        filepath,
        content,
      },
      preview,
    };
  },
  run: async (args: { filepath: string; content: string }): Promise<string> => {
    try {
      const dirPath = path.dirname(args.filepath);
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
      }

      // Read existing file content if it exists.
      // Routes through the chokepoint shim — the preprocess step
      // already populated the decision cache for this path+mtime, so
      // this read is essentially free (cache hit). Keeps Phase B's
      // "no CLI tool calls fs.readFileSync on a project file directly"
      // invariant intact.
      let oldContent = "";
      if (fs.existsSync(args.filepath)) {
        try {
          const result = await scanningReadFile(args.filepath, "llm");
          oldContent = result.content;
        } catch {
          // BLOCK shouldn't happen here (preprocess already passed),
          // but if it does we treat oldContent as empty so the diff
          // logic below produces an "added" stat instead of crashing
          // the write. The actual write was permitted upstream.
          oldContent = "";
        }
      }

      // Write new content
      fs.writeFileSync(args.filepath, args.content, "utf-8");

      // Track lines of code changes if file existed before
      if (oldContent) {
        const { added, removed } = calculateLinesOfCodeDiff(
          oldContent,
          args.content,
        );
        const language = getLanguageFromFilePath(args.filepath);

        if (added > 0) {
          telemetryService.recordLinesOfCodeModified("added", added, language);
        }
        if (removed > 0) {
          telemetryService.recordLinesOfCodeModified(
            "removed",
            removed,
            language,
          );
        }

        // Generate diff for result display
        const diff = generateDiff(oldContent, args.content, args.filepath);

        return `Successfully wrote to file: ${args.filepath}\nDiff:\n${diff}`;
      } else {
        // New file creation - count all lines as added
        const lineCount = args.content.split("\n").length;
        const language = getLanguageFromFilePath(args.filepath);

        telemetryService.recordLinesOfCodeModified(
          "added",
          lineCount,
          language,
        );

        return `Successfully created file: ${args.filepath}`;
      }
    } catch (error) {
      if (error instanceof ContinueError) {
        throw error;
      }
      throw new ContinueError(
        ContinueErrorReason.FileWriteError,
        `Error writing to file: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  },
};
