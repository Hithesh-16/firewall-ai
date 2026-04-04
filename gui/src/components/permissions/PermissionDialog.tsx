/**
 * PermissionDialog — base component for per-tool permission approval.
 *
 * Shows what the tool wants to do, the risk level, and offers
 * Allow Once / Allow Always / Deny buttons.
 *
 * Pushed via WebSocket (task_event with eventType "permission_request"),
 * managed by permissionSlice in Redux.
 */

import { useCallback } from "react";

export type PermissionDecision =
  | "allow_once"
  | "allow_always"
  | "deny"
  | "deny_always";

export interface PermissionRequest {
  id: string;
  toolName: string;
  input: Record<string, unknown>;
  description: string;
  riskLevel: "low" | "medium" | "high" | "critical";
  timestamp: number;
}

interface PermissionDialogProps {
  request: PermissionRequest;
  onResolve: (id: string, decision: PermissionDecision) => void;
}

const RISK_STYLES: Record<
  string,
  { border: string; badge: string; text: string }
> = {
  low: {
    border: "border-success/30",
    badge: "bg-success/10 text-success",
    text: "Low Risk",
  },
  medium: {
    border: "border-warning/30",
    badge: "bg-warning/10 text-warning",
    text: "Medium Risk",
  },
  high: {
    border: "border-error/30",
    badge: "bg-error/10 text-error",
    text: "High Risk",
  },
  critical: {
    border: "border-error/50",
    badge: "bg-error/20 text-error",
    text: "Critical Risk",
  },
};

export function PermissionDialog({
  request,
  onResolve,
}: PermissionDialogProps) {
  const style = RISK_STYLES[request.riskLevel] ?? RISK_STYLES.medium;

  const handleDecision = useCallback(
    (decision: PermissionDecision) => {
      onResolve(request.id, decision);
    },
    [request.id, onResolve],
  );

  // Format the tool input for display
  const inputPreview = formatInput(request.toolName, request.input);

  return (
    <div
      className={`rounded-lg border ${style.border} bg-editor max-w-lg p-4 shadow-lg`}
    >
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm">{"\u26A0\uFE0F"}</span>
          <span className="text-foreground text-sm font-semibold">
            Permission Required
          </span>
        </div>
        <span
          className={`text-2xs rounded-full px-2 py-0.5 font-semibold ${style.badge}`}
        >
          {style.text}
        </span>
      </div>

      {/* Tool info */}
      <div className="mb-3">
        <p className="text-foreground mb-1 text-sm">
          <span className="text-info font-mono">{request.toolName}</span>
          {" wants to:"}
        </p>
        <p className="text-description text-sm">{request.description}</p>
      </div>

      {/* Input preview */}
      {inputPreview && (
        <div className="bg-input mb-3 overflow-x-auto rounded p-2">
          <pre className="text-2xs text-input-foreground whitespace-pre-wrap font-mono">
            {inputPreview}
          </pre>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex justify-end gap-2">
        <button
          onClick={() => handleDecision("deny")}
          className="border-error/30 text-error hover:bg-error/10 rounded border px-3 py-1.5 text-xs transition-colors"
        >
          Deny
        </button>
        <button
          onClick={() => handleDecision("deny_always")}
          className="border-border text-description hover:bg-list-hover rounded border px-3 py-1.5 text-xs transition-colors"
        >
          Deny Always
        </button>
        <button
          onClick={() => handleDecision("allow_once")}
          className="border-success/30 text-success hover:bg-success/10 rounded border px-3 py-1.5 text-xs transition-colors"
        >
          Allow Once
        </button>
        <button
          onClick={() => handleDecision("allow_always")}
          className="bg-success/20 text-success hover:bg-success/30 rounded px-3 py-1.5 text-xs font-semibold transition-colors"
        >
          Allow Always
        </button>
      </div>
    </div>
  );
}

function formatInput(
  toolName: string,
  input: Record<string, unknown>,
): string | null {
  const lower = toolName.toLowerCase();

  if (lower === "bash" || lower === "terminal") {
    return typeof input.command === "string" ? `$ ${input.command}` : null;
  }

  if (lower.includes("edit") || lower.includes("write")) {
    const path = input.file_path ?? input.path;
    return typeof path === "string" ? `File: ${path}` : null;
  }

  if (lower === "webfetch" || lower === "web_fetch") {
    return typeof input.url === "string" ? `URL: ${input.url}` : null;
  }

  // Generic: show first few keys
  const entries = Object.entries(input).slice(0, 3);
  if (entries.length === 0) return null;
  return entries.map(([k, v]) => `${k}: ${String(v).slice(0, 100)}`).join("\n");
}
