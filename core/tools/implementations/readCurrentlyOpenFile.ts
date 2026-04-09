import { getUriDescription } from "../../util/uri";

import { ToolImpl } from ".";
import { throwIfFileIsSecurityConcern } from "../../indexing/ignore";
import { ContinueError, ContinueErrorReason } from "../../util/errors";
import { scanFileViaProxy } from "../../util/fileScanProxy";
import { throwIfFileExceedsHalfOfContext } from "./readFileLimit";

export const readCurrentlyOpenFileImpl: ToolImpl = async (_, extras) => {
  const result = await extras.ide.getCurrentFile();

  if (result) {
    throwIfFileIsSecurityConcern(result.path);

    // Phase E: enforce role-aware file scope. The "currently open
    // file" tool is a common escape hatch for agents that can't
    // locate a file by path — we scan it just like a direct read
    // so a restricted file can't leak into context via a
    // different tool.
    const scanDecision = await scanFileViaProxy(
      result.path,
      extras.fetch as typeof fetch,
    );
    if (scanDecision.action === "BLOCK") {
      throw new ContinueError(
        ContinueErrorReason.FileIsSecurityConcern,
        `File blocked by security scan: ${scanDecision.reasons.join("; ")} (risk: ${scanDecision.riskScore})`,
      );
    }

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
    ];
  } else {
    return [
      {
        name: `No Current File`,
        description: "",
        content: "There are no files currently open.",
      },
    ];
  }
};
