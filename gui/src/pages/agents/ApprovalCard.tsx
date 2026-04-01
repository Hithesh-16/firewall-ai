import { useState } from "react";
import type { PendingApproval } from "../../redux/slices/agentSlice";
import { removePendingApproval } from "../../redux/slices/agentSlice";
import { useAppDispatch } from "../../redux/hooks";
import { useProxyApi } from "../../hooks/useProxyApi";

type ApprovalDecision = "allow_once" | "allow_always" | "deny" | "deny_always";

export function ApprovalCard({ approval }: { approval: PendingApproval }) {
  const dispatch = useAppDispatch();
  const api = useProxyApi();
  const [resolving, setResolving] = useState(false);

  const elapsed = Math.round((Date.now() - approval.createdAt) / 1000);
  const timeoutSec = Math.round(approval.timeoutMs / 1000);
  const remaining = Math.max(0, timeoutSec - elapsed);

  const handleResolve = async (decision: ApprovalDecision) => {
    setResolving(true);
    try {
      await api.post(`/api/approvals/${approval.requestId}/resolve`, {
        decision,
      });
      dispatch(removePendingApproval(approval.requestId));
    } catch {
      // Approval may have already timed out
      dispatch(removePendingApproval(approval.requestId));
    } finally {
      setResolving(false);
    }
  };

  return (
    <div className="rounded-lg border border-info/30 bg-info/5 px-4 py-3">
      <div className="flex items-center gap-2 mb-2">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-info flex-shrink-0">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
        <span className="text-sm font-medium text-foreground flex-1">
          Approval Required
        </span>
        <span className="text-xs text-description font-mono">
          {remaining}s left
        </span>
      </div>

      <div className="mb-3">
        <p className="text-xs text-description">
          <span className="font-medium">{approval.actionType}</span>
          {" on "}
          <span className="font-mono">{approval.resource}</span>
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => handleResolve("allow_once")}
          disabled={resolving}
          className="px-2.5 py-1 text-xs font-medium rounded-md bg-success/15 text-success border border-success/30
            hover:bg-success/25 transition-colors disabled:opacity-50"
        >
          Allow Once
        </button>
        <button
          onClick={() => handleResolve("allow_always")}
          disabled={resolving}
          className="px-2.5 py-1 text-xs font-medium rounded-md bg-success/10 text-success border border-success/20
            hover:bg-success/20 transition-colors disabled:opacity-50"
        >
          Always Allow
        </button>
        <button
          onClick={() => handleResolve("deny")}
          disabled={resolving}
          className="px-2.5 py-1 text-xs font-medium rounded-md bg-error/10 text-error border border-error/20
            hover:bg-error/20 transition-colors disabled:opacity-50"
        >
          Deny
        </button>
        <button
          onClick={() => handleResolve("deny_always")}
          disabled={resolving}
          className="px-2.5 py-1 text-xs font-medium rounded-md text-error border border-transparent
            hover:bg-error/10 transition-colors disabled:opacity-50"
        >
          Always Deny
        </button>
      </div>
    </div>
  );
}
