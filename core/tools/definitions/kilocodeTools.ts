import { Tool } from "../..";

import { BUILT_IN_GROUP_NAME, BuiltInToolNames } from "../builtIn";

/**
 * Kilocode-parity tools ported into the AI Firewall toolset.
 *
 * - apply_patch: write a unified diff that spans one or more files
 * - lsp: language-server queries (definition/references/type/symbols)
 * - recall: grep prior chat sessions for prior context
 *
 * These complement our existing edit/read tools by covering the specific
 * cases they miss: multi-file refactors (apply_patch), semantic
 * navigation (lsp), and cross-session memory (recall).
 */

export const applyPatchTool: Tool = {
  type: "function",
  displayTitle: "Apply Patch",
  wouldLikeTo: "apply a multi-file patch",
  isCurrently: "applying a multi-file patch",
  hasAlready: "applied the patch",
  readonly: false,
  group: BUILT_IN_GROUP_NAME,
  function: {
    name: BuiltInToolNames.ApplyPatch,
    description:
      "Apply a unified-diff patch to one or more files. Accepts the standard `git diff` format — use this instead of multiple edit calls when a change touches several files, especially for coordinated refactors. Each hunk that doesn't match file context is rejected individually, the rest still apply. Returns per-file status with +N/-M counts. NOT for renames, binary diffs, or mode bits — use run_terminal_command with git for those.",
    parameters: {
      type: "object",
      required: ["patch"],
      properties: {
        patch: {
          type: "string",
          description:
            "The full unified-diff text. Include file headers (`--- a/path`, `+++ b/path`) for each file touched.",
        },
      },
    },
  },
  defaultToolPolicy: "allowedWithPermission",
  systemMessageDescription: {
    prefix: `For multi-file or multi-hunk changes call ${BuiltInToolNames.ApplyPatch} with a unified diff. Example:`,
    exampleArgs: [
      [
        "patch",
        "--- a/src/index.ts\n+++ b/src/index.ts\n@@ -10,3 +10,4 @@\n import x from 'x';\n+import y from 'y';\n ...",
      ],
    ],
  },
  toolCallIcon: "WrenchScrewdriverIcon",
};

export const lspTool: Tool = {
  type: "function",
  displayTitle: "LSP",
  wouldLikeTo: "query the language server",
  isCurrently: "querying the language server",
  hasAlready: "queried the language server",
  readonly: true,
  group: BUILT_IN_GROUP_NAME,
  function: {
    name: BuiltInToolNames.Lsp,
    description:
      "Query the active IDE's language server. Actions: `definition` (jump from a use to its declaration), `references` (find all callers/uses), `type` (jump to the type's declaration), `symbols` (list symbols in a file). Line and column are 1-based. Use this over grep when you need semantic — not textual — navigation, e.g. finding every caller of a function name that's also a common word.",
    parameters: {
      type: "object",
      required: ["action", "filepath"],
      properties: {
        action: {
          type: "string",
          description: "One of: definition, references, type, symbols",
        },
        filepath: {
          type: "string",
          description: "Workspace-relative file path",
        },
        line: {
          type: "string",
          description:
            "1-based line number of the symbol. Required for definition/references/type; omitted for symbols.",
        },
        column: {
          type: "string",
          description: "1-based column of the symbol.",
        },
      },
    },
  },
  defaultToolPolicy: "allowedWithoutPermission",
  systemMessageDescription: {
    prefix: `To semantically navigate code, call ${BuiltInToolNames.Lsp}. Prefer it over grep when a name is ambiguous. Example:`,
    exampleArgs: [
      ["action", "references"],
      ["filepath", "core/tools/callTool.ts"],
      ["line", "232"],
      ["column", "15"],
    ],
  },
  toolCallIcon: "MagnifyingGlassIcon",
};

export const researchWebTool: Tool = {
  type: "function",
  displayTitle: "Research Web",
  wouldLikeTo: 'research the web for "{{{ query }}}"',
  isCurrently: 'researching "{{{ query }}}" on the web',
  hasAlready: 'researched "{{{ query }}}" on the web',
  readonly: true,
  group: BUILT_IN_GROUP_NAME,
  function: {
    name: BuiltInToolNames.ResearchWeb,
    description:
      "Search the web and automatically extract full article content from the top results. Use whenever the user asks you to 'search online', 'analyse on the web', 'find information about X', or anything where reading actual web pages matters. Returns a summary header plus one context item per source with extracted markdown content — cite by source number when synthesising. Prefer this over search_web when the user wants an actual analysis; prefer search_web when only URLs + snippets are needed.",
    parameters: {
      type: "object",
      required: ["query"],
      properties: {
        query: {
          type: "string",
          description: "Natural-language research question.",
        },
        max_sources: {
          type: "string",
          description: "Max number of pages to extract. Default 5, max 10.",
        },
      },
    },
  },
  defaultToolPolicy: "allowedWithoutPermission",
  systemMessageDescription: {
    prefix: `To research a topic with extracted page content, call ${BuiltInToolNames.ResearchWeb}. Example:`,
    exampleArgs: [
      [
        "query",
        "trade-offs of tiktoken vs llama-tokenizer for Node.js servers",
      ],
      ["max_sources", "5"],
    ],
  },
  toolCallIcon: "GlobeAltIcon",
};

export const recallTool: Tool = {
  type: "function",
  displayTitle: "Recall",
  wouldLikeTo: 'recall prior sessions for "{{{ query }}}"',
  isCurrently: 'recalling prior sessions for "{{{ query }}}"',
  hasAlready: 'recalled prior sessions for "{{{ query }}}"',
  readonly: true,
  group: BUILT_IN_GROUP_NAME,
  function: {
    name: BuiltInToolNames.Recall,
    description:
      "Search prior chat session transcripts (local only) for a keyword or phrase. Returns up to N snippets showing the session title, turn number, and the matched context. Use when the user refers to 'the plan we had last time' or 'what we decided yesterday'. Searches only this user's saved sessions — no network.",
    parameters: {
      type: "object",
      required: ["query"],
      properties: {
        query: {
          type: "string",
          description: "Text to search for (case-insensitive substring).",
        },
        limit: {
          type: "string",
          description: "Max matches to return. Default 5, max 20.",
        },
      },
    },
  },
  defaultToolPolicy: "allowedWithoutPermission",
  systemMessageDescription: {
    prefix: `When the user references prior work, call ${BuiltInToolNames.Recall} before asking them to re-explain. Example:`,
    exampleArgs: [
      ["query", "web search proxy plan"],
      ["limit", "5"],
    ],
  },
  toolCallIcon: "ClockIcon",
};
