import {
  CheckCircleIcon,
  ExclamationTriangleIcon,
  PencilSquareIcon,
} from "@heroicons/react/24/outline";
import { useCallback } from "react";

import { useAppDispatch, useAppSelector } from "../../redux/hooks";
import {
  approvePendingPlanProposal,
  clearPendingPlanProposal,
} from "../../redux/slices/sessionSlice";

/**
 * Approval-gated plan card.
 *
 * Rendered whenever an agent has called `propose_plan` and the user
 * hasn't yet reacted. Renders the plan as a checklist with an
 * **Approve** action (promotes the proposal into `activePlan` so the
 * PlanPanel picks it up) and a **Revise** action (clears the proposal
 * and focuses the user to type feedback).
 *
 * Colour encoding for the risk badge:
 *   high   → error
 *   medium → warning
 *   low    → info
 *
 * The card sits above the chat input alongside the PlanPanel. It
 * auto-hides when there's no pending proposal.
 */
export function PlanProposalCard() {
  const dispatch = useAppDispatch();
  const proposal = useAppSelector((s) => s.session.pendingPlanProposal);

  const onApprove = useCallback(() => {
    dispatch(approvePendingPlanProposal());
  }, [dispatch]);

  const onRevise = useCallback(() => {
    dispatch(clearPendingPlanProposal());
  }, [dispatch]);

  if (!proposal) return null;

  const riskTone = toneForRisk(proposal.risk);

  return (
    <div
      className="border-border bg-editor mx-2 mb-3 overflow-hidden rounded-lg border"
      role="region"
      aria-label="Plan proposal awaiting approval"
    >
      <div className="border-border flex items-center gap-2 border-b px-3 py-2">
        <CheckCircleIcon className="text-info h-4 w-4 shrink-0" />
        <span className="text-foreground flex-1 truncate text-sm font-semibold">
          {proposal.title}
        </span>
        {proposal.risk && (
          <span
            className={`text-af-caption inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 font-medium uppercase ${riskTone.badge}`}
            title={`Risk: ${proposal.risk}`}
          >
            <ExclamationTriangleIcon className="h-3 w-3" />
            {proposal.risk}
          </span>
        )}
      </div>

      <p className="text-description px-3 py-2 text-xs leading-relaxed">
        {proposal.summary}
      </p>

      <ol className="flex flex-col gap-1 px-3 pb-2">
        {proposal.tasks.map((t, i) => (
          <li
            key={`${i}-${t.content}`}
            className="text-foreground flex items-start gap-2 text-xs leading-relaxed"
          >
            <span className="text-description-muted font-mono tabular-nums">
              {String(i + 1).padStart(2, "0")}
            </span>
            <span className="flex-1">{t.content}</span>
          </li>
        ))}
      </ol>

      <div className="border-border bg-secondary-background/40 flex items-center justify-end gap-2 border-t px-3 py-2">
        <button
          type="button"
          onClick={onRevise}
          className="text-description hover:text-foreground hover:bg-list-hover border-border inline-flex items-center gap-1.5 rounded border bg-transparent px-3 py-1 text-xs transition-colors"
        >
          <PencilSquareIcon className="h-3.5 w-3.5" />
          Revise
        </button>
        <button
          type="button"
          onClick={onApprove}
          className="bg-primary text-primary-foreground hover:bg-primary-hover inline-flex items-center gap-1.5 rounded border border-transparent px-3 py-1 text-xs font-medium transition-colors"
        >
          <CheckCircleIcon className="h-3.5 w-3.5" />
          Approve plan
        </button>
      </div>
    </div>
  );
}

function toneForRisk(risk?: string): { badge: string } {
  switch (risk?.toLowerCase()) {
    case "high":
      return { badge: "border-error/40 text-error bg-error/10" };
    case "medium":
      return { badge: "border-warning/40 text-warning bg-warning/10" };
    case "low":
      return { badge: "border-info/40 text-info bg-info/10" };
    default:
      return { badge: "border-border text-description" };
  }
}
