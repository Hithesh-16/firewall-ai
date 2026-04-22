/**
 * Barrel for the diff component family.
 *
 * Callers should import from `../components/diff` rather than the
 * individual files so we can refactor internals without breaking
 * downstream imports.
 */
export { DiffChanges } from "./DiffChanges";
export { FileAccordion } from "./FileAccordion";
export { FileTree } from "./FileTree";
export { InlineDiff, parseDiffString } from "./InlineDiff";
export { MultiFileDiffPanel } from "./MultiFileDiffPanel";
export type { MultiFileDiffPanelProps } from "./MultiFileDiffPanel";
export { SideBySideDiff } from "./SideBySideDiff";
export { countChanges, UnifiedDiff } from "./UnifiedDiff";
export type { DiffStyle, FileDiff } from "./types";
