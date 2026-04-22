import { DocumentIcon, FolderIcon } from "@heroicons/react/24/outline";
import { useMemo } from "react";

import { DiffChanges } from "./DiffChanges";
import type { FileDiff } from "./types";

/**
 * Folder-grouped file tree (kilocode-parity).
 *
 * A lightweight sidebar for the MultiFileDiffPanel: every file in the
 * diff is grouped under its common-prefix folder. Clicking a file
 * scrolls its FileAccordion into view and also opens it if closed.
 *
 * The tree is flat-grouped by directory rather than recursively nested
 * — matches kilocode and reads better at narrow widths (VS Code
 * sidebar can be 250px or less).
 */
export function FileTree({
  diffs,
  selectedPath,
  onSelect,
}: {
  diffs: FileDiff[];
  selectedPath?: string;
  onSelect: (path: string) => void;
}) {
  const groups = useMemo(() => buildGroups(diffs), [diffs]);

  return (
    <aside
      className="border-border-weak bg-surface-inset flex w-48 shrink-0 flex-col overflow-y-auto border-r text-[11px]"
      aria-label="Changed files"
    >
      {groups.map((group) => (
        <div key={group.dir} className="flex flex-col">
          <div className="text-description-muted bg-surface-inset sticky top-0 z-[1] flex items-center gap-1 px-2 py-1 font-mono">
            <FolderIcon className="h-3 w-3 shrink-0" />
            <span className="truncate" title={group.dir}>
              {group.dir || "/"}
            </span>
          </div>
          <ul className="flex flex-col">
            {group.files.map((file) => {
              const isSelected = file.path === selectedPath;
              return (
                <li key={file.path}>
                  <button
                    type="button"
                    onClick={() => onSelect(file.path)}
                    className={`flex w-full items-center gap-1.5 px-2 py-1 text-left transition-colors ${
                      isSelected
                        ? "bg-list-active text-list-active-foreground"
                        : "hover:bg-surface-inset-hover text-weak hover:text-strong"
                    }`}
                    title={file.path}
                  >
                    <DocumentIcon className="h-3 w-3 shrink-0" />
                    <span className="flex-1 truncate font-mono">
                      {file.name}
                    </span>
                    <DiffChanges
                      additions={file.additions}
                      deletions={file.deletions}
                      className="shrink-0"
                    />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </aside>
  );
}

interface FileGroup {
  dir: string;
  files: Array<{
    path: string;
    name: string;
    additions: number;
    deletions: number;
  }>;
}

function buildGroups(diffs: FileDiff[]): FileGroup[] {
  const map = new Map<string, FileGroup>();
  for (const diff of diffs) {
    const parts = diff.path.split("/");
    const name = parts.pop() || diff.path;
    const dir = parts.join("/");
    if (!map.has(dir)) {
      map.set(dir, { dir, files: [] });
    }
    map.get(dir)!.files.push({
      path: diff.path,
      name,
      additions: diff.additions,
      deletions: diff.deletions,
    });
  }
  return Array.from(map.values()).sort((a, b) => a.dir.localeCompare(b.dir));
}
