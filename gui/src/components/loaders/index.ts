/**
 * Barrel for the AI Firewall loader system.
 *
 * Every async state in the GUI resolves through one of these
 * components. Picking rule (from ui-polish-plan.md §2.1):
 *
 *   AfSpinner       → generic async, background refresh
 *   AfSkeleton      → known-shape data loading (lists, cards)
 *   AfTextShimmer   → streaming unknown-length text (LLM, reasoning)
 *   AfProgressBar   → multi-step pipeline (indeterminate) or
 *                     known-ratio work (determinate)
 *   AfPulseHalo     → ambient "working" halo around a static icon
 *   AfSuccessCheck  → one-shot completion confirmation
 *   AfStepper       → visible multi-stage pipeline (firewall scan)
 */
export { AfProgressBar } from "./AfProgressBar";
export type { AfProgressBarProps } from "./AfProgressBar";
export { AfPulseHalo } from "./AfPulseHalo";
export type { AfPulseHaloProps } from "./AfPulseHalo";
export { AfSkeleton, AfSkeletonCard, AfSkeletonRow } from "./AfSkeleton";
export { AfSpinner } from "./AfSpinner";
export type { AfSpinnerProps } from "./AfSpinner";
export { AfStepper } from "./AfStepper";
export type { AfStep, AfStepState } from "./AfStepper";
export { AfSuccessCheck } from "./AfSuccessCheck";
export type { AfSuccessCheckProps } from "./AfSuccessCheck";
export { AfTextShimmer } from "./AfTextShimmer";
export type { AfTextShimmerProps, AfTextShimmerVariant } from "./AfTextShimmer";
