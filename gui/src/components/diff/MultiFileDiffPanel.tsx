import { useCallback, useEffect, useRef, useState } from "react";

import { FileAccordion } from "./FileAccordion";
import { FileTree } from "./FileTree";
import type { DiffStyle, FileDiff } from "./types";

/**
 * Multi-file edit panel (kilocode-parity).
 *
 * The headline Phase 3 component. Renders a sticky summary header
 * (file count + aggregate +/−), a Unified ↔ Split toggle that
 * persists across sessions in localStorage, a folder-grouped FileTree
 * on the left, and a vertical list of expandable FileAccordion
 * panels on the right.
 *
 * Click a file in the tree → the corresponding accordion opens (if
 * closed) and scrolls into view. Click an accordion chevron → toggles
 * open/closed for just that file. The first file opens by default so
 * single-edit tool calls render useful content immediately.
 *
 * Designed to be dropped into any tool output. Callers pass a
 * FileDiff[] array; optional onRevert/onOpenInEditor wire to the IDE.
 */
export interface MultiFileDiffPanelProps {
  diffs: FileDiff[];
  /** Fires when the user clicks the revert icon on a file header.
   *  Omit to hide the revert button (e.g. preview-only diffs). */
  onRevert?: (path: string) => void;
  /** Optional title shown in the summary row. Defaults to
   *  "N files changed". */
  title?: string;
  /** Persistence key for the unified↔split toggle. Different tool
   *  surfaces can have independent preferences — e.g. the preview
   *  dialog vs. the chat history panel. */
  storageKey?: string;
}

const DEFAULT_STORAGE_KEY = "aiFirewall.diffStyle.v1";

export function MultiFileDiffPanel({
  diffs,
  onRevert,
  title,
  storageKey = DEFAULT_STORAGE_KEY,
}: MultiFileDiffPanelProps) {
  const [style, setStyle] = useState<DiffStyle>(() =>
    readStoredStyle(storageKey),
  );
  const [openFiles, setOpenFiles] = useState<Set<string>>(
    () =>
      // Open the first file by default — single-file tool outputs should
      // not require a click to see any content.
      new Set(diffs.length > 0 ? [diffs[0].path] : []),
  );
  const [selectedPath, setSelectedPath] = useState<string | undefined>(
    diffs[0]?.path,
  );

  // Keep refs to each accordion so the tree can scroll them into view.
  const accordionRefs = useRef<Map<string, HTMLDivElement | null>>(new Map());

  const toggleFile = useCallback((path: string) => {
    setOpenFiles((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const handleSelectFile = useCallback((path: string) => {
    setSelectedPath(path);
    setOpenFiles((prev) => {
      if (prev.has(path)) return prev;
      const next = new Set(prev);
      next.add(path);
      return next;
    });
    // Scroll the file's accordion into view on the next paint.
    requestAnimationFrame(() => {
      const el = accordionRefs.current.get(path);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  }, []);

  const handleStyleChange = useCallback(
    (next: DiffStyle) => {
      setStyle(next);
      try {
        localStorage.setItem(storageKey, next);
      } catch {
        // ignore (private browsing mode etc.)
      }
    },
    [storageKey],
  );

  // If the diffs prop changes (agent emits a new edit set), rehydrate
  // selection + default-open to the new first file.
  useEffect(() => {
    if (diffs.length === 0) {
      setSelectedPath(undefined);
      setOpenFiles(new Set());
      return;
    }
    if (!diffs.some((d) => d.path === selectedPath)) {
      setSelectedPath(diffs[0].path);
      setOpenFiles(new Set([diffs[0].path]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diffs]);

  if (diffs.length === 0) {
    return (
      <div className="text-description-muted border-border-weak rounded-md border p-3 text-xs italic">
        No file changes to show
      </div>
    );
  }

  const totalAdds = diffs.reduce((s, d) => s + d.additions, 0);
  const totalDels = diffs.reduce((s, d) => s + d.deletions, 0);

  return (
    <div className="border-border-weak bg-surface-base flex flex-col overflow-hidden rounded-md border">
      {/* Summary header */}
      <div className="border-border-weak bg-surface-inset flex items-center gap-3 border-b px-3 py-2 text-[12px]">
        <span className="text-strong font-semibold">
          {title ??
            `${diffs.length} file${diffs.length !== 1 ? "s" : ""} changed`}
        </span>
        <span className="text-success font-mono tabular-nums">
          +{totalAdds}
        </span>
        <span className="text-error font-mono tabular-nums">−{totalDels}</span>
        <div className="ml-auto flex gap-1">
          <StyleToggleButton
            label="Unified"
            active={style === "unified"}
            onClick={() => handleStyleChange("unified")}
          />
          <StyleToggleButton
            label="Split"
            active={style === "split"}
            onClick={() => handleStyleChange("split")}
          />
        </div>
      </div>

      {/* Body: tree + accordions */}
      <div className="flex max-h-[70vh] flex-1 overflow-hidden">
        {diffs.length > 1 && (
          <FileTree
            diffs={diffs}
            selectedPath={selectedPath}
            onSelect={handleSelectFile}
          />
        )}
        <div className="flex-1 overflow-y-auto">
          {diffs.map((diff) => (
            <FileAccordion
              key={diff.path}
              ref={(el) => {
                accordionRefs.current.set(diff.path, el);
              }}
              diff={diff}
              open={openFiles.has(diff.path)}
              style={style}
              onToggle={() => toggleFile(diff.path)}
              onRevert={onRevert}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function StyleToggleButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded px-2 py-0.5 text-[11px] transition-colors ${
        active ? "bg-input text-strong" : "text-weak hover:text-strong"
      }`}
    >
      {label}
    </button>
  );
}

function readStoredStyle(key: string): DiffStyle {
  try {
    const raw = localStorage.getItem(key);
    if (raw === "split" || raw === "unified") return raw;
  } catch {
    /* private-browsing or no-storage context */
  }
  return "unified";
}
