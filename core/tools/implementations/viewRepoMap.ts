import generateRepoMap from "../../util/generateRepoMap";

import { ToolImpl } from ".";

const REPO_MAP_PREAMBLE =
  "Below is a repository map. \n" +
  "For each file in the codebase, " +
  "this map contains the name of the file, and the signature for any " +
  "classes, methods, or functions in the file.\n\n";

/**
 * Strip the boilerplate preamble so a preamble-only map doesn't look
 * like real content to the model. If what's left is whitespace, the
 * indexer hasn't finished (or the workspace has no indexable files)
 * and we return an error context item so Claude stops retrying.
 */
export const viewRepoMapImpl: ToolImpl = async (args, extras) => {
  const repoMap = await generateRepoMap(extras.llm, extras.ide, {
    outputRelativeUriPaths: true,
    includeSignatures: true,
  });

  const body = repoMap.startsWith(REPO_MAP_PREAMBLE)
    ? repoMap.slice(REPO_MAP_PREAMBLE.length)
    : repoMap;

  if (body.trim().length === 0) {
    return [
      {
        name: "Repo map unavailable",
        description: "Codebase index is empty or still building",
        content:
          "The repository map is empty. The codebase index is either still building or the workspace has no indexable files. " +
          "Do NOT call view_repository_map again — it will return the same empty result. " +
          "Answer the user from the messages already in context, ask them to wait for indexing to finish, " +
          "or use a different tool (read_file, ls, grep_search) to inspect specific paths.",
      },
    ];
  }

  return [
    {
      name: "Repo map",
      description: "Overview of the repository structure",
      content: repoMap,
    },
  ];
};
