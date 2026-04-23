import { Location } from "../..";
import { ContinueError, ContinueErrorReason } from "../../util/errors";
import { inferResolvedUriFromRelativePath } from "../../util/ideUtils";
import { getCleanUriPath, getUriPathBasename } from "../../util/uri";
import { getStringArg } from "../parseArgs";

import { ToolImpl } from ".";

/**
 * lsp — Language Server Protocol queries over the active IDE.
 *
 * Four actions:
 *   definition  — jump from a symbol reference to its declaration
 *   references  — find every usage of the symbol at a given location
 *   symbols     — list top-level symbols (classes, functions) in a file
 *   type        — jump to the type's declaration (for a value)
 *
 * Location is specified either as (filepath, line, column) with line/column
 * 1-based OR as (filepath) alone for `symbols`. Everything else is
 * required. We keep the contract tight rather than accept ranges so the
 * tool has a single, predictable shape.
 */

type LspAction = "definition" | "references" | "symbols" | "type";

const VALID_ACTIONS: readonly LspAction[] = [
  "definition",
  "references",
  "symbols",
  "type",
];

export const lspImpl: ToolImpl = async (args, extras) => {
  const action = getStringArg(args, "action").toLowerCase() as LspAction;
  if (!VALID_ACTIONS.includes(action)) {
    throw new ContinueError(
      ContinueErrorReason.Unspecified,
      `lsp: unknown action "${action}". Use one of: ${VALID_ACTIONS.join(", ")}.`,
    );
  }

  const filepath = getStringArg(args, "filepath");
  const fileUri = await inferResolvedUriFromRelativePath(filepath, extras.ide);
  if (!fileUri) {
    throw new ContinueError(
      ContinueErrorReason.PathResolutionFailed,
      `lsp: could not resolve ${filepath} against the workspace.`,
    );
  }

  if (action === "symbols") {
    const symbols = await extras.ide.getDocumentSymbols(fileUri);
    if (symbols.length === 0) {
      return [
        {
          name: "lsp symbols",
          description: getCleanUriPath(fileUri),
          content: `No symbols indexed for ${filepath}. The language server may not have finished parsing.`,
        },
      ];
    }
    const rendered = symbols
      .map(
        (s) =>
          `- ${s.name} (${String(s.kind)}) @ L${s.range.start.line + 1}:${s.range.start.character + 1}`,
      )
      .join("\n");
    return [
      {
        name: `Symbols in ${getUriPathBasename(fileUri)}`,
        description: getCleanUriPath(fileUri),
        content: rendered,
      },
    ];
  }

  const line = parseInt(getStringArg(args, "line"), 10);
  const column = parseInt(getStringArg(args, "column"), 10);
  if (!Number.isFinite(line) || !Number.isFinite(column)) {
    throw new ContinueError(
      ContinueErrorReason.Unspecified,
      "lsp: line and column are required integers for definition/references/type actions.",
    );
  }
  const location: Location = {
    filepath: fileUri,
    position: { line: line - 1, character: column - 1 },
  };

  const ranges =
    action === "definition"
      ? await extras.ide.gotoDefinition(location)
      : action === "type"
        ? await extras.ide.gotoTypeDefinition(location)
        : await extras.ide.getReferences(location);

  if (ranges.length === 0) {
    return [
      {
        name: `lsp ${action}`,
        description: `${filepath}:${line}:${column}`,
        content: `No ${action} results. The symbol may be unresolved or the language server may still be indexing.`,
      },
    ];
  }

  const rendered = ranges
    .map((r) => {
      const path = getCleanUriPath(r.filepath);
      const l = r.range.start.line + 1;
      const c = r.range.start.character + 1;
      return `- ${path}:${l}:${c}`;
    })
    .join("\n");

  return [
    {
      name: `lsp ${action} · ${ranges.length}`,
      description: `${filepath}:${line}:${column}`,
      content: rendered,
    },
  ];
};
