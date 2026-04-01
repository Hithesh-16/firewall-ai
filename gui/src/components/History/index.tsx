import { BaseSessionMetadata } from "core";
import type { RemoteSessionMetadata } from "core/control-plane/client";
import MiniSearch from "minisearch";
import React, {
  Fragment,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import Shortcut from "../gui/Shortcut";

import { XMarkIcon } from "@heroicons/react/24/solid";
import { useNavigate } from "react-router-dom";
import { IdeMessengerContext } from "../../context/IdeMessenger";
import { useAppDispatch, useAppSelector } from "../../redux/hooks";
import {
  newSession,
  setAllSessionMetadata,
} from "../../redux/slices/sessionSlice";
import { setDialogMessage, setShowDialog } from "../../redux/slices/uiSlice";
import { refreshSessionMetadata } from "../../redux/thunks/session";
import { getFontSize, getPlatform } from "../../util";
import { ROUTES } from "../../util/navigation";
import ConfirmationDialog from "../dialogs/ConfirmationDialog";
import { Button } from "../ui";
import { HistoryTableRow } from "./HistoryTableRow";
import { groupSessionsByDate, parseDate } from "./util";

export function History() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  const ideMessenger = useContext(IdeMessengerContext);

  const [searchTerm, setSearchTerm] = useState("");
  const [repoFilter, setRepoFilter] = useState<"current-repo" | "all">("current-repo");

  const allSessionMetadata = useAppSelector(
    (state) => state.session.allSessionMetadata,
  );
  const isSessionMetadataLoading = useAppSelector(
    (state) => state.session.isSessionMetadataLoading,
  );

  // Get current workspace for repo filtering
  const currentWorkspace = (window as any).workspacePaths?.[0] ?? "";

  // Filter sessions by repo before search
  const repoFilteredSessions = useMemo(() => {
    if (repoFilter === "all" || !currentWorkspace) return allSessionMetadata;
    return allSessionMetadata.filter(
      (s) => s.workspaceDirectory === currentWorkspace,
    );
  }, [allSessionMetadata, repoFilter, currentWorkspace]);

  const minisearch = useRef<MiniSearch>(
    new MiniSearch({
      fields: ["title"],
      storeFields: ["title", "sessionId", "id"],
    }),
  ).current;

  useEffect(() => {
    try {
      minisearch.removeAll();
      minisearch.addAll(
        repoFilteredSessions.map((session) => ({
          title: session.title,
          sessionId: session.sessionId,
          id: session.sessionId,
        })),
      );
    } catch (e) {
      // minisearch indexing error — non-critical
    }
  }, [repoFilteredSessions]);

  const platform = useMemo(() => getPlatform(), []);

  const filteredAndSortedSessions: (
    | BaseSessionMetadata
    | RemoteSessionMetadata
  )[] = useMemo(() => {
    // 1. Exact phrase matching
    const exactResults = minisearch.search(searchTerm, {
      fuzzy: false,
    });

    // 2. Fuzzy matching with higher tolerance
    const fuzzyResults = minisearch.search(searchTerm, {
      fuzzy: 0.3,
    });

    // 3. Prefix matching for partial words
    const prefixResults = minisearch.search(searchTerm, {
      prefix: true,
      fuzzy: 0.2,
    });

    // Combine results, with exact matches having higher priority
    const allResults = [
      ...exactResults.map((r) => ({ ...r, priority: 3 })),
      ...fuzzyResults.map((r) => ({ ...r, priority: 2 })),
      ...prefixResults.map((r) => ({ ...r, priority: 1 })),
    ];

    // Remove duplicates while preserving highest priority
    const uniqueResultsMap = new Map<string, any>();
    allResults.forEach((result) => {
      const existing = uniqueResultsMap.get(result.id);
      if (!existing || existing.priority < result.priority) {
        uniqueResultsMap.set(result.id, result);
      }
    });
    const uniqueResults = Array.from(uniqueResultsMap.values());

    const sessionIds = uniqueResults
      .sort((a, b) => b.priority - a.priority || b.score - a.score)
      .map((result) => result.id);

    return repoFilteredSessions
      .filter((session) => {
        return searchTerm === "" || sessionIds.includes(session.sessionId);
      })
      .sort(
        (a, b) =>
          parseDate(b.dateCreated).getTime() -
          parseDate(a.dateCreated).getTime(),
      );
  }, [repoFilteredSessions, searchTerm, minisearch]);

  // Separate pinned sessions and show them at the top
  const pinnedIds = useMemo(() => {
    try {
      return new Set<string>(JSON.parse(localStorage.getItem("pinnedSessions") || "[]"));
    } catch { return new Set<string>(); }
  }, [filteredAndSortedSessions]); // re-evaluate when sessions change

  const pinnedSessions = useMemo(
    () => filteredAndSortedSessions.filter((s) => pinnedIds.has(s.sessionId)),
    [filteredAndSortedSessions, pinnedIds],
  );

  const unpinnedSessions = useMemo(
    () => filteredAndSortedSessions.filter((s) => !pinnedIds.has(s.sessionId)),
    [filteredAndSortedSessions, pinnedIds],
  );

  const sessionGroups = useMemo(() => {
    return groupSessionsByDate(unpinnedSessions);
  }, [unpinnedSessions]);

  const showClearSessionsDialog = () => {
    dispatch(
      setDialogMessage(
        <ConfirmationDialog
          title={`Clear sessions`}
          text={`Are you sure you want to permanently delete all chat sessions, including the current chat session?`}
          onConfirm={async () => {
            // optimistic update
            dispatch(setAllSessionMetadata([]));

            // actual update + refresh
            await ideMessenger.request("history/clear", undefined);
            void dispatch(refreshSessionMetadata({}));

            // start a new session
            dispatch(newSession());
            navigate(ROUTES.HOME);
          }}
        />,
      ),
    );
    dispatch(setShowDialog(true));
  };

  return (
    <div
      style={{ fontSize: getFontSize() }}
      className="flex flex-1 flex-col overflow-auto overflow-x-hidden px-1"
    >
      <div className="relative my-2 mt-4 flex justify-center space-x-2">
        <input
          className="bg-vsc-input-background text-vsc-foreground flex-1 rounded-md border border-none py-1 pl-2 pr-8 text-sm outline-none focus:outline-none"
          ref={searchInputRef}
          placeholder="Search past sessions"
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
        {searchTerm && (
          <XMarkIcon
            className="text-vsc-foreground hover:bg-vsc-background duration-50 absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 transform cursor-pointer rounded-full p-0.5 transition-colors"
            onClick={() => {
              setSearchTerm("");
              if (searchInputRef.current) {
                searchInputRef.current.focus();
              }
            }}
          />
        )}
      </div>

      {/* Repo filter toggle */}
      {currentWorkspace && (
        <div className="mx-2 mb-1 flex items-center gap-1">
          <button
            onClick={() => setRepoFilter("current-repo")}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              repoFilter === "current-repo"
                ? "bg-primary text-primary-foreground"
                : "bg-secondary-background text-description hover:text-foreground"
            }`}
          >
            This Repo
          </button>
          <button
            onClick={() => setRepoFilter("all")}
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              repoFilter === "all"
                ? "bg-primary text-primary-foreground"
                : "bg-secondary-background text-description hover:text-foreground"
            }`}
          >
            All Repos
          </button>
          {repoFilter === "current-repo" && (
            <span className="ml-1 truncate text-[10px] text-description-muted">
              {currentWorkspace.split("/").pop() ?? currentWorkspace}
            </span>
          )}
        </div>
      )}

      <div className="thin-scrollbar flex w-full flex-1 flex-col overflow-y-auto">
        {filteredAndSortedSessions.length === 0 && (
          <div className="m-3 text-center">
            {isSessionMetadataLoading ? (
              "Loading Sessions..."
            ) : (
              <>
                No past sessions found. To start a new session, either click the
                "+" button or use the keyboard shortcut:{" "}
                <Shortcut>meta L</Shortcut>
              </>
            )}
          </div>
        )}

        <table className="flex w-full flex-1 flex-col">
          <tbody className="">
            {/* Pinned sessions */}
            {pinnedSessions.length > 0 && (
              <Fragment>
                <tr className="user-select-none sticky mb-3 ml-2 mt-2 flex h-6 items-center justify-start text-left text-base font-bold opacity-75">
                  <td colSpan={3} className="flex items-center gap-1.5">
                    <span className="text-warning text-sm">{"\u2B50"}</span>
                    Pinned
                  </td>
                </tr>
                {pinnedSessions.map((session, sessionIndex) => (
                  <HistoryTableRow
                    key={session.sessionId}
                    sessionMetadata={session}
                    index={sessionIndex}
                  />
                ))}
              </Fragment>
            )}

            {/* Regular sessions grouped by date */}
            {sessionGroups.map((group, groupIndex) => (
              <Fragment key={group.label}>
                <tr
                  className={`user-select-none sticky mb-3 ml-2 flex h-6 justify-start text-left text-base font-bold opacity-75 ${
                    groupIndex === 0 ? "mt-2" : "mt-8"
                  }`}
                >
                  <td colSpan={3}>{group.label}</td>
                </tr>
                {group.sessions.map((session, sessionIndex) => (
                  <HistoryTableRow
                    key={session.sessionId}
                    sessionMetadata={session}
                    index={sessionIndex}
                  />
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <div className="border-border flex flex-col items-end justify-center gap-1.5 border-0 border-t border-solid px-2 py-3 text-xs">
        <div className="flex items-center gap-2">
          {repoFilter === "current-repo" && currentWorkspace && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                ideMessenger.request("history/clearRepoSummary", {
                  workspaceDirectory: currentWorkspace,
                });
              }}
            >
              Clear repo memory
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={showClearSessionsDialog}>
            Clear chats
          </Button>
        </div>
        <span
          className="text-description text-2xs"
          data-testid="history-sessions-note"
        >
          Chat history is saved to{" "}
          <span className="italic">
            {platform === "windows"
              ? "%USERPROFILE%/.ai-firewall"
              : "~/.ai-firewall/sessions"}
          </span>
        </span>
      </div>
    </div>
  );
}
