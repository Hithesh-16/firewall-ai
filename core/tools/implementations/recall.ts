import fs from "node:fs";

import { ContinueError, ContinueErrorReason } from "../../util/errors";
import { renderChatMessage } from "../../util/messageContent";
import { getSessionFilePath, getSessionsListPath } from "../../util/paths";
import { getStringArg } from "../parseArgs";

import { ToolImpl } from ".";

/**
 * recall — Search prior chat sessions for text that matches a query.
 *
 * Kilocode has a `recall` tool that searches past session transcripts
 * so the agent can pull relevant prior context in without the user
 * having to re-explain. This is our local-only equivalent: we read the
 * sessions list JSON, scan each session file, and return the top
 * matching snippets with their session id + turn.
 *
 * Arguments:
 *   query: natural-language or keyword match (case-insensitive substring).
 *   limit: max matches to return (default 5, clamped to 20).
 *
 * Returns at most N context items, each showing the session title,
 * message role, and a 160-char snippet around the match so the agent
 * can decide whether to open the session for more context.
 */

interface SessionsListEntry {
  sessionId: string;
  title?: string;
  dateCreated?: string;
}

interface StoredSessionMessage {
  message: {
    role: string;
    content?: unknown;
  };
}

interface StoredSession {
  sessionId: string;
  title?: string;
  history?: StoredSessionMessage[];
}

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;
const SNIPPET_RADIUS = 80;

export const recallImpl: ToolImpl = async (args) => {
  const rawQuery = getStringArg(args, "query").trim();
  if (rawQuery.length === 0) {
    throw new ContinueError(
      ContinueErrorReason.Unspecified,
      "recall: `query` must be a non-empty string.",
    );
  }
  const query = rawQuery.toLowerCase();

  const limitInput = Number.parseInt(
    (args?.limit as string | number | undefined)?.toString() ?? "",
    10,
  );
  const limit = Number.isFinite(limitInput)
    ? Math.max(1, Math.min(MAX_LIMIT, limitInput))
    : DEFAULT_LIMIT;

  let entries: SessionsListEntry[] = [];
  try {
    const raw = fs.readFileSync(getSessionsListPath(), "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) entries = parsed;
  } catch {
    return [
      {
        name: "recall",
        description: "No sessions indexed",
        content:
          "There is no sessions list on disk to search. Start or save a session and try again.",
      },
    ];
  }

  const matches: Array<{
    sessionId: string;
    title: string;
    role: string;
    snippet: string;
    turn: number;
  }> = [];

  for (const entry of entries) {
    if (matches.length >= limit) break;
    const sessionPath = getSessionFilePath(entry.sessionId);
    let session: StoredSession | null = null;
    try {
      const raw = fs.readFileSync(sessionPath, "utf8");
      session = JSON.parse(raw) as StoredSession;
    } catch {
      continue; // skip unreadable/missing session files
    }
    if (!session?.history) continue;

    for (let i = 0; i < session.history.length && matches.length < limit; i++) {
      const item = session.history[i];
      const text = renderChatMessage(
        item.message as Parameters<typeof renderChatMessage>[0],
      );
      if (!text) continue;
      const idx = text.toLowerCase().indexOf(query);
      if (idx === -1) continue;
      const start = Math.max(0, idx - SNIPPET_RADIUS);
      const end = Math.min(text.length, idx + query.length + SNIPPET_RADIUS);
      const prefix = start > 0 ? "…" : "";
      const suffix = end < text.length ? "…" : "";
      matches.push({
        sessionId: session.sessionId,
        title: entry.title ?? session.title ?? "(untitled)",
        role: item.message.role ?? "unknown",
        snippet: `${prefix}${text.slice(start, end).replace(/\s+/g, " ").trim()}${suffix}`,
        turn: i,
      });
    }
  }

  if (matches.length === 0) {
    return [
      {
        name: "recall",
        description: `No matches for "${rawQuery}"`,
        content: `No prior sessions contained "${rawQuery}". Try a different keyword or a broader phrase.`,
      },
    ];
  }

  return matches.map((m) => ({
    name: m.title,
    description: `${m.sessionId.slice(0, 8)} · turn ${m.turn + 1} · ${m.role}`,
    content: m.snippet,
  }));
};
