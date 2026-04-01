/**
 * Repo Memory Indicator
 *
 * Shows a subtle "🧠 Using repo memory" indicator below the input box
 * when the current workspace has past conversations that will be used
 * as context for new sessions.
 */

import { useContext, useEffect, useState } from "react";
import { IdeMessengerContext } from "../../context/IdeMessenger";

export function RepoMemoryIndicator() {
  const ideMessenger = useContext(IdeMessengerContext);
  const [repoInfo, setRepoInfo] = useState<{
    name: string;
    sessionCount: number;
  } | null>(null);

  useEffect(() => {
    const workspaceDir = (window as any).workspacePaths?.[0];
    if (!workspaceDir) return;

    // Request repo summary from core
    ideMessenger
      .request("history/repoSummary", { workspaceDirectory: workspaceDir })
      .then((result) => {
        if (result.status === "success" && result.content?.summary) {
          setRepoInfo({
            name: workspaceDir.split("/").pop() ?? workspaceDir,
            sessionCount: result.content.summary.sessionCount ?? 0,
          });
        }
      })
      .catch(() => {
        // Repo memory not available — hide indicator
      });
  }, []);

  if (!repoInfo || repoInfo.sessionCount === 0) return null;

  return (
    <div className="mt-1 flex items-center gap-1.5 px-3 text-[11px] text-description-muted">
      <span>{"\uD83E\uDDE0"}</span>
      <span>
        Using repo memory ({repoInfo.name}) &middot; {repoInfo.sessionCount} past conversation{repoInfo.sessionCount !== 1 ? "s" : ""}
      </span>
    </div>
  );
}
