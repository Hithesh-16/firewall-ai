/**
 * Glob-pattern file search for the CLI agent — Phase J.J4
 * (SECURITY_HARDENING_PLAN.md). Mirrors the IDE's
 * `core/tools/implementations/globSearch.ts` so both surfaces let
 * the model find files by pattern (e.g. `**\/*.test.ts`).
 *
 * Why a separate tool from `searchCode` (grep): grep matches on
 * file CONTENT; glob matches on file PATHS. Models routinely need
 * both ("find every .yaml under packages/", "show me all README
 * files"). Without glob the model resorts to chained terminal
 * commands, which is slower and harder to scope.
 */

import * as path from "node:path";

import { glob } from "glob";

import type { Tool } from "./types.js";

const MAX_RESULTS = 100;

interface GlobArgs {
  pattern: string;
  cwd?: string;
}

export const globSearchTool: Tool = {
  name: "GlobSearch",
  displayName: "GlobSearch",
  description:
    "Find files by glob pattern (e.g. '**/*.test.ts', 'packages/*/package.json'). " +
    "Returns up to 100 matching paths relative to the workspace root. " +
    "Use this for path-based discovery; use SearchCode for content/grep matches.",
  readonly: true,
  isBuiltIn: true,
  parameters: {
    type: "object",
    required: ["pattern"],
    properties: {
      pattern: {
        type: "string",
        description:
          "A glob pattern. Supports '**' (any depth), '*' (single segment), " +
          "'?' (single char), and '{a,b}' (alternation). " +
          "Examples: '**/*.ts', 'src/**/index.{ts,tsx}', 'packages/*/package.json'.",
      },
      cwd: {
        type: "string",
        description:
          "Optional working directory the glob is rooted at. Defaults to the current process cwd.",
      },
    },
  },
  preprocess: async (args: GlobArgs) => {
    return {
      args,
      preview: [
        {
          type: "text",
          content: `Will glob "${args.pattern}" in ${args.cwd ?? process.cwd()}`,
        },
      ],
    };
  },
  run: async (args: GlobArgs) => {
    const cwd = args.cwd ?? process.cwd();
    const results = await glob(args.pattern, {
      cwd,
      // Standard ignore set — keep results focused on user code.
      ignore: ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/build/**"],
      nodir: true,
      dot: false,
    });

    if (results.length === 0) {
      return `No files matched "${args.pattern}" under ${cwd}.`;
    }

    const truncated = results.slice(0, MAX_RESULTS);
    // Return paths relative to cwd for compactness.
    const lines = truncated.map((p) =>
      path.relative(cwd, path.resolve(cwd, p)),
    );
    let out = lines.join("\n");
    if (results.length > MAX_RESULTS) {
      out +=
        `\n\n…truncated to ${MAX_RESULTS} of ${results.length} matches. ` +
        `Refine the pattern for a smaller set.`;
    }
    return out;
  },
};
