import crypto from "node:crypto";

/**
 * Extracts a thinned version of context to send to the preflight scanner.
 * It retains the system message and ONLY the last N (default 6) turns of conversations
 * to drastically reduce the number of tokens spent on scanning against security classifiers.
 */

export interface ThinContextResult<T> {
  thinnedMessages: T[];
  stateHash: string;
}

/**
 * Generates a short hash representing the current session state.
 * Used to detect when context hasn't changed and skip re-scanning.
 */
function generateStateHash(
  messages: { role: string; content?: unknown }[],
): string {
  const content = messages
    .map((m) => `${m.role}:${JSON.stringify(m.content ?? "")}`)
    .join("|");

  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
}

/**
 * Extracts thinned context + a hash representing current session state.
 * If stateHash matches previous scan, skip re-scanning (identical context).
 *
 * @param messages Array of message objects
 * @param maxTurns Maximum number of non-system turns to include (default 6)
 * @returns Thinned messages and state hash
 */
export function getThinnedContextWithHash<T extends { role: string }>(
  messages: T[],
  maxTurns: number = 6,
): ThinContextResult<T> {
  if (!messages || messages.length === 0) {
    return { thinnedMessages: [], stateHash: "" };
  }

  const thinned: T[] = [];

  // Always include the system message to enforce bounding rules
  const systemMessage = messages.find((m) => m.role === "system");
  if (systemMessage) {
    thinned.push(systemMessage);
  }

  // Find the last N turns (excluding system message if it was already selected)
  const nonSystemIdxs = messages.filter((m) => m.role !== "system");

  const recent = nonSystemIdxs.slice(-maxTurns);

  const result = [...thinned, ...recent];
  const stateHash = generateStateHash(result);

  return { thinnedMessages: result, stateHash };
}

/**
 * Legacy function for backward compatibility.
 * Extracts thinned context WITHOUT state hash.
 */
export function getThinnedContext<T extends { role: string }>(
  messages: T[],
  maxTurns: number = 6,
): T[] {
  return getThinnedContextWithHash(messages, maxTurns).thinnedMessages;
}
