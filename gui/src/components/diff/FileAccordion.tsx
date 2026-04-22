import {
  ArrowUturnLeftIcon,
  ChevronDownIcon,
  DocumentIcon,
} from "@heroicons/react/24/outline";
import { forwardRef } from "react";

import { DiffChanges } from "./DiffChanges";
import { SideBySideDiff } from "./SideBySideDiff";
import type { DiffStyle, FileDiff } from "./types";
import { UnifiedDiff } from "./UnifiedDiff";

/**
 * Per-file expandable panel (kilocode-parity).
 *
 * Sticky header carries the file name + path + DiffChanges badge +
 * optional revert button. Body renders UnifiedDiff or SideBySideDiff
 * based on the panel's current style.
 *
 * `forwardRef` so the parent MultiFileDiffPanel can scroll a specific
 * accordion into view when the user clicks a file in the tree.
 */
export const FileAccordion = forwardRef<
  HTMLDivElement,
  {
    diff: FileDiff;
    open: boolean;
    style: DiffStyle;
    onToggle: () => void;
    onRevert?: (path: string) => void;
  }
>(function FileAccordion({ diff, open, style, onToggle, onRevert }, ref) {
  const name = getFilename(diff.path);
  const dir = getDirectory(diff.path);

  return (
    <div
      ref={ref}
      data-file-path={diff.path}
      className="border-border-weak border-b last:border-0"
    >
      <div className="border-border-weak bg-surface-inset sticky top-0 z-[1] flex items-center gap-2 border-b px-3 py-1.5">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="text-weak hover:text-strong flex flex-1 items-center gap-2 overflow-hidden text-left text-[12px] transition-colors"
        >
          <ChevronDownIcon
            className={`h-3 w-3 shrink-0 transition-transform duration-150 ${
              open ? "" : "-rotate-90"
            }`}
            aria-hidden
          />
          <DocumentIcon className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span className="text-strong shrink-0 font-mono">{name}</span>
          {dir && (
            <span
              className="text-description-muted truncate font-mono"
              title={diff.path}
            >
              {dir}
            </span>
          )}
        </button>
        <DiffChanges
          additions={diff.additions}
          deletions={diff.deletions}
          className="shrink-0"
        />
        {onRevert && (
          <button
            type="button"
            onClick={() => onRevert(diff.path)}
            title={`Revert changes to ${name}`}
            aria-label={`Revert changes to ${name}`}
            className="text-description-muted hover:text-error shrink-0 transition-colors"
          >
            <ArrowUturnLeftIcon className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {open &&
        (style === "split" ? (
          <SideBySideDiff
            oldLines={diff.before.split("\n")}
            newLines={diff.after.split("\n")}
            maxHeight="480px"
          />
        ) : (
          <UnifiedDiff before={diff.before} after={diff.after} />
        ))}
    </div>
  );
});

function getFilename(path: string): string {
  return path.split("/").pop() || path;
}

function getDirectory(path: string): string {
  const parts = path.split("/");
  parts.pop();
  return parts.join("/");
}
