/**
 * AfStepper — vertical progress indicator for multi-stage pipelines.
 *
 * Replaces the flat "current activity" text currently used in the
 * firewall activity indicator. When the pipeline has known stages
 * (scanning → redacting → routing → forwarding), showing them as a
 * step list with one active + connector dots is dramatically more
 * informative than a single rotating label.
 *
 * Each step has a state:
 *   done     → filled emerald dot with inner check
 *   active   → pulsing emerald halo
 *   pending  → outline dot, muted text
 *   error    → red filled dot
 *   skipped  → greyed out, strikethrough
 */

import { AfPulseHalo } from "./AfPulseHalo";
import { AfSuccessCheck } from "./AfSuccessCheck";

export type AfStepState = "done" | "active" | "pending" | "error" | "skipped";

export interface AfStep {
  id: string;
  label: string;
  state: AfStepState;
  /** Optional short detail line under the step label (e.g. the
   *  per-step result count or duration). */
  hint?: string;
}

export function AfStepper({
  steps,
  className = "",
}: {
  steps: AfStep[];
  className?: string;
}) {
  return (
    <ol
      className={`text-af-caption flex flex-col gap-1.5 ${className}`}
      aria-label="Pipeline progress"
    >
      {steps.map((step, i) => (
        <StepRow key={step.id} step={step} isLast={i === steps.length - 1} />
      ))}
    </ol>
  );
}

function StepRow({ step, isLast }: { step: AfStep; isLast: boolean }) {
  const textClass =
    step.state === "done"
      ? "text-weak"
      : step.state === "active"
        ? "text-strong"
        : step.state === "error"
          ? "text-error"
          : step.state === "skipped"
            ? "text-description-muted line-through"
            : "text-description-muted";

  return (
    <li className="flex items-start gap-2">
      <span className="relative flex w-4 shrink-0 flex-col items-center">
        <StepGlyph state={step.state} />
        {!isLast && (
          <span
            aria-hidden
            className="bg-af-hairline mt-0.5 h-3 w-[1.5px] rounded-full"
          />
        )}
      </span>
      <div className="flex flex-col leading-tight">
        <span className={textClass}>{step.label}</span>
        {step.hint && (
          <span className="text-description-muted text-[10px]">
            {step.hint}
          </span>
        )}
      </div>
    </li>
  );
}

function StepGlyph({ state }: { state: AfStepState }) {
  if (state === "done") {
    return <AfSuccessCheck size={12} />;
  }
  if (state === "active") {
    return (
      <AfPulseHalo size="sm">
        <span className="bg-af-accent h-2 w-2 rounded-full" aria-hidden />
      </AfPulseHalo>
    );
  }
  if (state === "error") {
    return (
      <span
        className="bg-af-danger flex h-3 w-3 items-center justify-center rounded-full"
        aria-label="error"
      >
        <span className="h-0.5 w-1.5 bg-white" />
      </span>
    );
  }
  return (
    <span
      className="border-af-hairline h-3 w-3 rounded-full border"
      aria-hidden
    />
  );
}
