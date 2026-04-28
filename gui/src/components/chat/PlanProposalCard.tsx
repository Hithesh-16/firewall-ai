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
  setMainEditorContentTrigger,
} from "../../redux/slices/sessionSlice";
import { setTodos } from "../../redux/slices/todosSlice";
import { IdeMessengerContext } from "../../context/IdeMessenger";
import { useContext } from "react";

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
  const ideMessenger = useContext(IdeMessengerContext);
  const proposal = useAppSelector((s) => s.session.pendingPlanProposal);
  const history = useAppSelector((s) => s.session.history);

  const onApprove = useCallback(() => {
    if (!proposal) return;
    dispatch(approvePendingPlanProposal());

    const tasks = Array.isArray(proposal.tasks) ? proposal.tasks : [];

    // Kilocode-parity: seed the sticky todo list so the user sees
    // progress checkboxes immediately.
    dispatch(
      setTodos(
        tasks.map((t, i) => ({
          id: String(i + 1),
          content: t.content,
          status: t.status as any,
          phase: t.phase,
        })),
      ),
    );
  }, [dispatch, proposal]);

  const onRevise = useCallback(() => {
    dispatch(clearPendingPlanProposal());
    // Focus user to provide feedback
    dispatch(setMainEditorContentTrigger({ type: "doc", content: [] }));
  }, [dispatch]);

  const onOpen = useCallback(() => {
    // Attempt to find an implementation_plan.md or any md file in history/context
    let mdFilePath: string | undefined;

    // Search back from history for any markdown file mention or code block
    for (let i = history.length - 1; i >= 0; i--) {
      const item = history[i];
      // Check context items
      const mdItem = item.contextItems?.find(
        (ci) => ci.uri?.type === "file" && ci.uri.value.endsWith(".md"),
      );
      if (mdItem) {
        mdFilePath = mdItem.uri?.value;
        break;
      }

      // Check code blocks in assistant content
      if (
        item.message.role === "assistant" &&
        typeof item.message.content === "string"
      ) {
        const match = item.message.content.match(/```\w+\s+([^\s\n]+\.md)/);
        if (match) {
          // This is a heuristic, ideally we'd have the absolute path.
          // But usually the model provides the relative path.
          // We'll rely on the IDE to resolve it.
          mdFilePath = match[1];
          break;
        }
      }
    }

    if (mdFilePath) {
      ideMessenger.post("showFile", { filepath: mdFilePath });
    } else {
      // Fallback: search for implementation_plan.md in the workspace
      ideMessenger.post("showFile", { filepath: "implementation_plan.md" });
    }
  }, [history, ideMessenger]);

  if (!proposal) return null;

  const tasks = Array.isArray(proposal.tasks) ? proposal.tasks : [];
  const riskTone = toneForRisk(proposal.risk);

  return (
    <div className="animate-in fade-in fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm transition-all duration-200">
      <div
        className="border-border bg-editor animate-in zoom-in-95 flex max-h-[85vh] w-[440px] flex-col overflow-hidden rounded-xl border shadow-2xl transition-all duration-200"
        role="dialog"
        aria-modal="true"
        aria-labelledby="plan-modal-title"
      >
        {/* Header */}
        <div className="border-border bg-surface-inset flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="bg-primary/10 rounded-lg p-1.5">
              <CheckCircleIcon className="text-primary h-5 w-5" />
            </div>
            <div>
              <h3
                id="plan-modal-title"
                className="text-foreground text-sm font-bold"
              >
                Review Implementation Plan
              </h3>
              <p className="text-description-muted text-[10px] font-medium uppercase tracking-wider">
                Agentic Workflow Approval
              </p>
            </div>
          </div>
          {proposal.risk && (
            <span
              className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-tight ${riskTone.badge}`}
            >
              <ExclamationTriangleIcon className="h-3 w-3" />
              {proposal.risk} Risk
            </span>
          )}
        </div>

        {/* Content Scroll Area */}
        <div className="thin-scrollbar flex-1 overflow-y-auto p-4">
          <div className="mb-4">
            <h4 className="text-foreground mb-1 text-xs font-bold">
              {proposal.title}
            </h4>
            <p className="text-description text-xs leading-relaxed">
              {proposal.summary}
            </p>
          </div>

          <div className="space-y-3">
            <div className="text-description-muted text-[10px] font-bold uppercase tracking-wider">
              Proposed Tasks
            </div>
            <ol className="space-y-2">
              {tasks.map((t, i) => (
                <li
                  key={`${i}-${t.content}`}
                  className="bg-surface-inset/50 border-border/40 hover:bg-surface-inset flex items-start gap-3 rounded-lg border p-2.5 text-xs transition-colors"
                >
                  <span className="text-description-muted mt-0.5 font-mono text-[10px] font-bold">
                    {(i + 1).toString().padStart(2, "0")}
                  </span>
                  <div className="flex flex-1 flex-col gap-1">
                    <span className="text-foreground font-medium leading-normal">
                      {t.content}
                    </span>
                    {t.phase && (
                      <span className="text-description-muted text-[10px] font-medium italic">
                        Phase: {t.phase}
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="border-border bg-surface-inset/80 flex items-center justify-end gap-3 border-t px-4 py-3 backdrop-blur-md">
          <button
            type="button"
            onClick={onRevise}
            className="text-description hover:text-foreground hover:bg-list-hover border-border inline-flex items-center gap-1.5 rounded-lg border bg-transparent px-3.5 py-2 text-xs font-semibold transition-all active:scale-95"
          >
            <ExclamationTriangleIcon className="h-3.5 w-3.5" />
            Revise
          </button>
          <button
            type="button"
            onClick={onOpen}
            className="text-description hover:text-foreground hover:bg-list-hover border-border inline-flex items-center gap-1.5 rounded-lg border bg-transparent px-3.5 py-2 text-xs font-semibold transition-all active:scale-95"
          >
            <PencilSquareIcon className="h-3.5 w-3.5" />
            Open MD
          </button>
          <button
            type="button"
            onClick={onApprove}
            className="bg-primary text-primary-foreground hover:bg-primary-hover shadow-sm-blue inline-flex items-center gap-2 rounded-lg border border-transparent px-6 py-2 text-sm font-bold transition-all hover:scale-[1.02] active:scale-[0.98]"
          >
            <CheckCircleIcon className="h-4 w-4" />
            Proceed
          </button>
        </div>
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
