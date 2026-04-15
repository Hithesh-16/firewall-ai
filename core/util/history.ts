import * as fs from "fs";

import { BaseSessionMetadata, Session } from "../index.js";
import { ListHistoryOptions } from "../protocol/core.js";

import { NEW_SESSION_TITLE } from "./constants.js";
import {
  getSessionFilePath,
  getSessionsFolderPath,
  getSessionsListPath,
} from "./paths.js";

/**
 * Refuse to persist a session larger than this. Beyond ~5 MB sessions
 * become unloadable in the webview and frequently end up corrupted on
 * sleep/wake (the webview replays partial state at unsafe times). Two
 * historic culprits: (1) `promptLogs[]` accumulating the full prompt
 * history per assistant turn — quadratic growth — which we strip
 * below; (2) tool outputs from binary files being persisted as raw
 * bytes which we sanitize below.
 */
const MAX_SESSION_FILE_BYTES = 5 * 1024 * 1024;

/**
 * Strip control characters that should never appear in chat content.
 * Keeps newlines, tabs, and carriage returns; replaces NULs and other
 * C0/C1 control bytes with the Unicode replacement char so they don't
 * get rendered as raw bytes in the chat panel.
 */
function sanitizeText(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g,
    "\uFFFD",
  );
}

function sanitizeMessageContent(content: unknown): unknown {
  if (typeof content === "string") return sanitizeText(content);
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (
        part &&
        typeof part === "object" &&
        "type" in part &&
        (part as { type: string }).type === "text" &&
        typeof (part as { text?: unknown }).text === "string"
      ) {
        return {
          ...(part as object),
          text: sanitizeText((part as { text: string }).text),
        };
      }
      return part;
    });
  }
  return content;
}

/**
 * Return a defensive copy of the session with promptLogs removed and
 * message/tool content sanitized. promptLogs are dev-console-only and
 * have no value across reloads — keeping them out of the persisted
 * file prevents the quadratic growth that produced 13 MB sessions in
 * the wild.
 */
function prepareSessionForPersistence(session: Session): Session {
  const cleanedHistory = session.history.map((item: any) => {
    const cleaned: any = { ...item };
    if (cleaned.message) {
      cleaned.message = {
        ...cleaned.message,
        content: sanitizeMessageContent(cleaned.message.content),
      };
    }
    // Drop dev-console-only prompt history.
    if ("promptLogs" in cleaned) delete cleaned.promptLogs;
    if (Array.isArray(cleaned.toolCallStates)) {
      cleaned.toolCallStates = cleaned.toolCallStates.map((tc: any) => {
        if (!Array.isArray(tc.output)) return tc;
        return {
          ...tc,
          output: tc.output.map((ci: any) =>
            typeof ci?.content === "string"
              ? { ...ci, content: sanitizeText(ci.content) }
              : ci,
          ),
        };
      });
    }
    if (Array.isArray(cleaned.contextItems)) {
      cleaned.contextItems = cleaned.contextItems.map((ci: any) =>
        typeof ci?.content === "string"
          ? { ...ci, content: sanitizeText(ci.content) }
          : ci,
      );
    }
    return cleaned;
  });
  return { ...session, history: cleanedHistory };
}

function safeParseArray<T>(
  value: string,
  errorMessage: string = "Error parsing array",
): T[] | undefined {
  try {
    return JSON.parse(value) as T[];
  } catch (e: any) {
    console.warn(`${errorMessage}: ${e}`);
    return undefined;
  }
}

export class HistoryManager {
  list(options: ListHistoryOptions): BaseSessionMetadata[] {
    const filepath = getSessionsListPath();
    if (!fs.existsSync(filepath)) {
      return [];
    }
    const content = fs.readFileSync(filepath, "utf8");

    let sessions = safeParseArray<BaseSessionMetadata>(content) ?? [];
    sessions = sessions
      .filter((session: any) => {
        // Filter out old format
        return typeof session.session_id !== "string";
        // Reverse to show newest first; sessions.json is chronological by creation
      })
      .reverse();

    // Apply limit and offset
    if (options.limit) {
      const offset = options.offset || 0;
      sessions = sessions.slice(offset, offset + options.limit);
    }

    return sessions;
  }

  delete(sessionId: string) {
    // Delete a session
    const sessionFile = getSessionFilePath(sessionId);
    if (!fs.existsSync(sessionFile)) {
      throw new Error(`Session file ${sessionFile} does not exist`);
    }
    fs.unlinkSync(sessionFile);

    // Read and update the sessions list
    const sessionsListFile = getSessionsListPath();
    const sessionsListRaw = fs.readFileSync(sessionsListFile, "utf-8");
    let sessionsList =
      safeParseArray<BaseSessionMetadata>(
        sessionsListRaw,
        "Error parsing sessions.json",
      ) ?? [];

    sessionsList = sessionsList.filter(
      (session) => session.sessionId !== sessionId,
    );

    fs.writeFileSync(
      sessionsListFile,
      JSON.stringify(sessionsList, undefined, 2),
    );
  }

  clearAll() {
    fs.rmSync(getSessionsFolderPath(), { recursive: true, force: true });
  }

  load(sessionId: string): Session {
    try {
      const sessionFile = getSessionFilePath(sessionId);
      if (!fs.existsSync(sessionFile)) {
        throw new Error(`Session file ${sessionFile} does not exist`);
      }

      // Refuse to load a session that's bloated past the safety
      // ceiling. The webview can't render multi-megabyte chat
      // histories without crashing, and a corrupted file from a
      // pre-fix build would just keep crashing on every reload.
      const stat = fs.statSync(sessionFile);
      if (stat.size > MAX_SESSION_FILE_BYTES) {
        console.warn(
          `[HistoryManager] Skipping bloated session ${sessionId}: ` +
            `${(stat.size / 1024 / 1024).toFixed(1)} MB. Returning empty session.`,
        );
        return {
          history: [],
          title: NEW_SESSION_TITLE,
          workspaceDirectory: "",
          sessionId,
        };
      }

      const raw: Session = JSON.parse(fs.readFileSync(sessionFile, "utf8"));
      // Sanitize on load too — defends against any corrupted file
      // written by an older build before the save-side fix existed.
      const sanitized = prepareSessionForPersistence(raw);
      sanitized.sessionId = sessionId;
      return sanitized;
    } catch (e) {
      // Session file missing is expected for stale tab references — not an error
      return {
        history: [],
        title: NEW_SESSION_TITLE,
        workspaceDirectory: "",
        sessionId: sessionId,
      };
    }
  }

  save(session: Session) {
    // Save the main session json file
    // Explicitely rewriting here to influence the written key order in the file!
    // e.g. id at the top, history next, etc.
    const cleaned = prepareSessionForPersistence(session);
    const orderedSession: Session = {
      sessionId: cleaned.sessionId,
      title: cleaned.title,
      workspaceDirectory: cleaned.workspaceDirectory,
      history: cleaned.history,
    };
    if (cleaned.mode) {
      orderedSession.mode = cleaned.mode;
    }
    if (cleaned.chatModelTitle !== undefined) {
      orderedSession.chatModelTitle = cleaned.chatModelTitle;
    }
    if (cleaned.usage !== undefined) {
      orderedSession.usage = cleaned.usage;
    }

    const serialized = JSON.stringify(orderedSession, undefined, 2);
    if (serialized.length > MAX_SESSION_FILE_BYTES) {
      // Refuse to persist a session that's grown past the safety
      // ceiling. Loud warning — the user will see this in the
      // dev tools console — and the session stays in memory so
      // they can manually save what they need before continuing.
      console.warn(
        `[HistoryManager] Refusing to persist session ${session.sessionId}: ` +
          `${(serialized.length / 1024 / 1024).toFixed(1)} MB exceeds the ` +
          `${(MAX_SESSION_FILE_BYTES / 1024 / 1024).toFixed(0)} MB ceiling. ` +
          `Start a new chat to keep history light.`,
      );
      return;
    }

    fs.writeFileSync(getSessionFilePath(session.sessionId), serialized);

    // Read and update the sessions list
    const sessionsListFilePath = getSessionsListPath();
    try {
      const rawSessionsList = fs.readFileSync(sessionsListFilePath, "utf-8");

      let sessionsList: BaseSessionMetadata[];
      try {
        sessionsList = JSON.parse(rawSessionsList);
      } catch (e) {
        if (rawSessionsList.trim() === "") {
          fs.writeFileSync(sessionsListFilePath, JSON.stringify([]));
          sessionsList = [];
        } else {
          throw e;
        }
      }

      let found = false;
      const messageCount = session.history.filter(
        (item) => item.message.role === "assistant",
      ).length;
      for (const sessionMetadata of sessionsList) {
        if (sessionMetadata.sessionId === session.sessionId) {
          sessionMetadata.title = session.title;
          sessionMetadata.workspaceDirectory = session.workspaceDirectory;
          sessionMetadata.messageCount = messageCount;
          found = true;
          break;
        }
      }

      if (!found) {
        const sessionMetadata: BaseSessionMetadata = {
          sessionId: session.sessionId,
          title: session.title,
          dateCreated: String(Date.now()),
          workspaceDirectory: session.workspaceDirectory,
          messageCount,
        };
        sessionsList.push(sessionMetadata);
      }

      fs.writeFileSync(
        sessionsListFilePath,
        JSON.stringify(sessionsList, undefined, 2),
      );
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new Error(
          `It looks like there is a JSON formatting error in your sessions.json file (${sessionsListFilePath}). Please fix this before creating a new session.`,
        );
      }
      throw new Error(
        `It looks like there is a validation error in your sessions.json file (${sessionsListFilePath}). Please fix this before creating a new session. Error: ${error}`,
      );
    }
  }
}

const historyManager = new HistoryManager();

export default historyManager;
