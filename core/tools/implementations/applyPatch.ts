import { applyPatch as applyUnifiedPatch, parsePatch } from "diff";

import { throwIfFileIsSecurityConcern } from "../../indexing/ignore";
import { ContinueError, ContinueErrorReason } from "../../util/errors";
import { inferResolvedUriFromRelativePath } from "../../util/ideUtils";
import { getCleanUriPath, getUriPathBasename } from "../../util/uri";
import { getStringArg } from "../parseArgs";

import { ToolImpl } from ".";

/**
 * apply_patch — applies a unified-diff patch covering one or more files.
 *
 * Input shape is the standard diff format produced by `git diff` /
 * `diff -u`. Multi-file patches are supported; hunks that don't apply
 * cleanly (context mismatch) reject that file, but other files still
 * land so the model gets per-file status feedback.
 *
 * Kilocode-parity naming + semantics (without Effect/Bus wiring):
 *   - same name "apply_patch" so prompts copy over cleanly
 *   - atomic per-file write (either the whole file flips to the new
 *     content or nothing changes on that file)
 *   - returns a summary context item per file with +N/-M counts
 *
 * NOT a drop-in for git-apply: no binary diffs, no file renames, no
 * mode bits. For those, the agent should shell out with run_terminal_command.
 */
export const applyPatchImpl: ToolImpl = async (args, extras) => {
  const patchText = getStringArg(args, "patch");
  if (!patchText.trim()) {
    throw new ContinueError(
      ContinueErrorReason.Unspecified,
      "apply_patch requires a non-empty `patch` argument.",
    );
  }

  const patches = parsePatch(patchText);
  if (patches.length === 0) {
    throw new ContinueError(
      ContinueErrorReason.Unspecified,
      "apply_patch could not parse any hunks from the provided patch text.",
    );
  }

  const results: Array<{
    file: string;
    status: "applied" | "rejected";
    additions: number;
    deletions: number;
    message?: string;
  }> = [];
  const touchedUris: string[] = [];

  for (const patch of patches) {
    const target =
      patch.newFileName && patch.newFileName !== "/dev/null"
        ? patch.newFileName
        : patch.oldFileName;
    if (!target || target === "/dev/null") {
      results.push({
        file: "<unknown>",
        status: "rejected",
        additions: 0,
        deletions: 0,
        message: "Patch header did not name a file.",
      });
      continue;
    }

    const cleanedPath = target.replace(/^(a|b)\//, "");
    const fileUri = await inferResolvedUriFromRelativePath(
      cleanedPath,
      extras.ide,
    );
    if (!fileUri) {
      results.push({
        file: cleanedPath,
        status: "rejected",
        additions: 0,
        deletions: 0,
        message: "Could not resolve path against the workspace.",
      });
      continue;
    }

    try {
      throwIfFileIsSecurityConcern(getCleanUriPath(fileUri));
    } catch (err) {
      results.push({
        file: cleanedPath,
        status: "rejected",
        additions: 0,
        deletions: 0,
        message:
          err instanceof Error
            ? err.message
            : "Security check rejected this path.",
      });
      continue;
    }

    let originalContent = "";
    const exists = await extras.ide.fileExists(fileUri);
    if (exists) {
      originalContent = await extras.ide.readFile(fileUri);
    }

    const applied = applyUnifiedPatch(originalContent, patch);
    if (applied === false) {
      results.push({
        file: cleanedPath,
        status: "rejected",
        additions: 0,
        deletions: 0,
        message:
          "Hunk context did not match file contents. Re-read the file with read_file and regenerate the patch.",
      });
      continue;
    }

    let additions = 0;
    let deletions = 0;
    for (const hunk of patch.hunks) {
      for (const line of hunk.lines) {
        if (line.startsWith("+") && !line.startsWith("+++")) additions++;
        else if (line.startsWith("-") && !line.startsWith("---")) deletions++;
      }
    }

    await extras.ide.writeFile(fileUri, applied);
    await extras.ide.saveFile(fileUri);
    touchedUris.push(fileUri);
    results.push({
      file: cleanedPath,
      status: "applied",
      additions,
      deletions,
    });
  }

  if (touchedUris.length > 0 && extras.codeBaseIndexer) {
    void extras.codeBaseIndexer.refreshCodebaseIndexFiles(touchedUris);
  }

  const appliedCount = results.filter((r) => r.status === "applied").length;
  const rejectedCount = results.length - appliedCount;
  const header =
    rejectedCount === 0
      ? `Applied patch to ${appliedCount} file${appliedCount === 1 ? "" : "s"}.`
      : `Applied to ${appliedCount}, rejected ${rejectedCount}. Fix rejected hunks and retry.`;

  const body = results
    .map((r) => {
      const stat = r.status === "applied" ? "✓" : "✗";
      const counts =
        r.status === "applied" ? ` (+${r.additions} -${r.deletions})` : "";
      const msg = r.message ? `\n   ${r.message}` : "";
      return `${stat} ${r.file}${counts}${msg}`;
    })
    .join("\n");

  return [
    {
      name: "apply_patch",
      description: header,
      content: `${header}\n\n${body}`,
    },
    ...touchedUris.map((uri) => ({
      name: getUriPathBasename(uri),
      description: getCleanUriPath(uri),
      content: "",
      uri: { type: "file" as const, value: uri },
    })),
  ];
};
