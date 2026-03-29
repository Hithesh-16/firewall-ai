import { resolveInputPath } from "../../util/pathResolver";
import { getUriPathBasename } from "../../util/uri";

import { ToolImpl } from ".";
import { throwIfFileIsSecurityConcern } from "../../indexing/ignore";
import { getStringArg } from "../parseArgs";
import { throwIfFileExceedsHalfOfContext } from "./readFileLimit";
import { ContinueError, ContinueErrorReason } from "../../util/errors";
import { countTokensAsync } from "../../llm/countTokens";

/**
 * Default proxy URL for the AI Firewall reducer endpoint.
 * Falls back to returning full file content if proxy is unreachable.
 */
const PROXY_BASE_URL = process.env.AF_PROXY_URL ?? "http://localhost:8080";
const REDUCE_ENDPOINT = `${PROXY_BASE_URL}/api/reduce`;

/**
 * Token threshold: if file exceeds this % of context window, try to reduce it.
 * Below this threshold, send the full file (no reduction needed).
 */
const REDUCTION_THRESHOLD_PERCENT = 0.25; // 25% of context window

export const readFileImpl: ToolImpl = async (args, extras) => {
  const filepath = getStringArg(args, "filepath");

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

  const content = await extras.ide.readFile(resolvedPath.uri);

  // Try context reduction for large files before throwing "too large" error
  const reducedContent = await tryReduceContent(
    content,
    resolvedPath.displayPath,
    extras,
  );

  // Validate reduced content fits (this may still throw for truly massive files)
  await throwIfFileExceedsHalfOfContext(
    resolvedPath.displayPath,
    reducedContent,
    extras.config.selectedModelByRole.chat,
  );

  return [
    {
      name: getUriPathBasename(resolvedPath.uri),
      description: resolvedPath.displayPath,
      content: reducedContent,
      uri: {
        type: "file",
        value: resolvedPath.uri,
      },
    },
  ];
};

/**
 * Try to reduce file content via the proxy reducer if it's large.
 * Falls back to returning full content if:
 *   - File is small enough (below threshold)
 *   - Proxy is unreachable
 *   - Reducer returns an error
 *
 * Design: Reduction is automatic for large files but the proxy reducer
 * is opt-in infrastructure. If the proxy isn't running, full content is used.
 */
async function tryReduceContent(
  content: string,
  filepath: string,
  extras: { fetch: Function; config: { selectedModelByRole: { chat?: { contextLength: number; title?: string } | null } } },
): Promise<string> {
  const model = extras.config.selectedModelByRole.chat;
  if (!model) return content;

  // Check if file is large enough to bother reducing
  let tokenCount: number;
  try {
    tokenCount = await countTokensAsync(content, model.title ?? "gpt-4");
  } catch {
    return content; // Can't count tokens — return full content
  }

  const threshold = model.contextLength * REDUCTION_THRESHOLD_PERCENT;
  if (tokenCount <= threshold) {
    return content; // Small file — no reduction needed
  }

  // File is large — try to reduce via proxy
  try {
    const response = await (extras.fetch as Function)(REDUCE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content,
        maxTokens: Math.floor(threshold),
        stripComments: true,
        stripBlanks: true,
        stripDuplicates: true,
        language: detectLanguageFromPath(filepath),
      }),
    });

    if (response && typeof response.json === "function") {
      const data = await response.json();
      if (data?.reduced && typeof data.reduced === "string" && data.reduced.length > 0) {
        return data.reduced;
      }
    }
  } catch {
    // Proxy unreachable or error — fall back to full content
    // This preserves existing behavior for users who don't run the proxy
  }

  return content;
}

/**
 * Detect language from file path for comment stripping.
 */
function detectLanguageFromPath(filepath: string): string | undefined {
  const ext = filepath.split(".").pop()?.toLowerCase();
  if (!ext) return undefined;
  if (["py", "pyw"].includes(ext)) return "python";
  if (["rb"].includes(ext)) return "ruby";
  if (["html", "htm", "xml", "svg"].includes(ext)) return "html";
  return undefined; // Default C-family handling
}
