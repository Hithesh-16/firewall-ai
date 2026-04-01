import { useState } from "react";
import { useAppDispatch, useAppSelector } from "../../../../redux/hooks";
import { selectPendingToolCalls } from "../../../../redux/selectors/selectToolCalls";
import { callToolById } from "../../../../redux/thunks/callToolById";
import { cancelToolCallThunk } from "../../../../redux/thunks/cancelToolCall";
import { setToolPolicy } from "../../../../redux/slices/uiSlice";
import { getAltKeyLabel, getMetaKeyLabel, isJetBrains } from "../../../../util";
import { useMainEditor } from "../../TipTapEditor";

export const generateToolCallButtonTestId = (
  action: "accept" | "reject",
  toolCallId: string,
) => {
  return `${action}-tool-call-button-${toolCallId}`;
};

function formatToolCall(toolCall: {
  tool?: { displayTitle?: string };
  toolCall: { function: { name: string; arguments: string } };
  parsedArgs?: Record<string, unknown>;
}): { fnName: string; displayArgs: string; displayTitle: string } {
  const fnName = toolCall.toolCall.function.name;
  const displayTitle = toolCall.tool?.displayTitle ?? fnName;
  const rawArgs = toolCall.parsedArgs ?? {};
  const argValues = Object.values(rawArgs)
    .filter((v) => typeof v === "string" || typeof v === "number")
    .map((v) => {
      const s = String(v);
      return `"${s.length > 50 ? s.slice(0, 50) + "..." : s}"`;
    })
    .join(", ");
  return { fnName, displayArgs: argValues, displayTitle };
}

export function PendingToolCallToolbar() {
  const dispatch = useAppDispatch();
  const jetbrains = isJetBrains();
  const pendingToolCalls = useAppSelector(selectPendingToolCalls);
  const editor = useMainEditor();

  if (pendingToolCalls.length === 0) {
    return null;
  }

  return (
    <div className="flex w-full flex-col gap-1.5 pb-1">
      {pendingToolCalls.map((toolCall, index) => {
        const { fnName, displayArgs, displayTitle } = formatToolCall(toolCall);
        return (
          <PermissionCard
            key={toolCall.toolCallId}
            toolCallId={toolCall.toolCallId}
            fnName={fnName}
            displayArgs={displayArgs}
            displayTitle={displayTitle}
            isFirst={index === 0}
            jetbrains={jetbrains}
            onAccept={() => dispatch(callToolById({ toolCallId: toolCall.toolCallId }))}
            onAcceptSession={() => {
              dispatch(setToolPolicy({ toolName: fnName, policy: "allowedWithoutPermission" }));
              dispatch(callToolById({ toolCallId: toolCall.toolCallId }));
            }}
            onReject={() => {
              if (pendingToolCalls.length === 1) {
                editor.mainEditor?.commands.focus();
              }
              dispatch(cancelToolCallThunk({ toolCallId: toolCall.toolCallId }));
            }}
          />
        );
      })}
    </div>
  );
}

function PermissionCard({
  toolCallId,
  fnName,
  displayArgs,
  displayTitle,
  isFirst,
  jetbrains,
  onAccept,
  onAcceptSession,
  onReject,
}: {
  toolCallId: string;
  fnName: string;
  displayArgs: string;
  displayTitle: string;
  isFirst: boolean;
  jetbrains: boolean;
  onAccept: () => void;
  onAcceptSession: () => void;
  onReject: () => void;
}) {
  const [showFeedback, setShowFeedback] = useState(false);

  return (
    <div className="rounded-[10px] border border-foreground/[0.08] bg-editor px-4 py-4 shadow-[0_8px_32px_rgba(0,0,0,0.55)] transition-all duration-200 animate-in fade-in slide-in-from-top-1">
      <p className="text-xs font-semibold text-foreground mb-2.5">Allow this tool call?</p>

      <div className="rounded-md bg-input px-2.5 py-1.5 mb-1.5 font-mono text-xs text-description overflow-x-auto">
        {fnName}({displayArgs})
      </div>

      <p className="text-[11px] text-description-muted mb-3">{displayTitle}</p>

      <div className="flex flex-col gap-1.5 mb-3">
        {/* Option 1: Yes — solid blue highlight (Claude style) */}
        <button
          onClick={onAccept}
          data-testid={generateToolCallButtonTestId("accept", toolCallId)}
          className="flex items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-xs font-semibold text-primary-foreground bg-primary hover:brightness-110 transition-all text-left"
        >
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-primary-foreground/20 text-[10px] font-bold">1</span>
          <span>Yes</span>
          {isFirst && <span className="ml-auto text-[10px] opacity-70">{getMetaKeyLabel()}{"\u23CE"}</span>}
        </button>

        {/* Option 2: Yes for session — dark bg + subtle border */}
        <button
          onClick={onAcceptSession}
          className="flex items-center gap-2.5 rounded-lg border border-foreground/[0.07] bg-input px-2.5 py-2.5 text-xs text-description-muted hover:bg-list-hover hover:border-foreground/[0.12] transition-colors text-left"
        >
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-badge text-[10px] font-bold text-badge-foreground">2</span>
          <span>Yes, allow <span className="font-mono text-[11px] text-description">{fnName}</span> for this session</span>
        </button>

        {/* Option 3: No — dark bg + subtle border */}
        <button
          onClick={onReject}
          data-testid={generateToolCallButtonTestId("reject", toolCallId)}
          className="flex items-center gap-2.5 rounded-lg border border-foreground/[0.07] bg-input px-2.5 py-2.5 text-xs text-description-muted hover:bg-list-hover hover:border-foreground/[0.12] transition-colors text-left"
        >
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-badge text-[10px] font-bold text-badge-foreground">3</span>
          <span>No</span>
          {isFirst && <span className="ml-auto text-[10px] text-description-muted">{jetbrains ? getAltKeyLabel() : getMetaKeyLabel()}{"\u232B"}</span>}
        </button>
      </div>

      {!showFeedback ? (
        <button
          onClick={() => setShowFeedback(true)}
          className="w-full text-left text-[11px] text-description-muted hover:text-description transition-colors rounded-md border border-foreground/[0.07] bg-input px-2.5 py-2 hover:bg-list-hover italic"
        >
          Tell AI Firewall what to do instead
        </button>
      ) : (
        <input
          autoFocus
          className="w-full rounded-md border border-foreground/[0.10] bg-input px-2.5 py-2 text-xs text-input-foreground placeholder:text-input-placeholder focus:border-foreground/[0.22] focus:outline-none"
          placeholder="Type instructions and press Enter..."
          onKeyDown={(e) => {
            if (e.key === "Enter" && e.currentTarget.value.trim()) onReject();
            if (e.key === "Escape") setShowFeedback(false);
          }}
        />
      )}

      <p className="text-[10px] text-description-muted mt-2 text-center">Esc to cancel</p>
    </div>
  );
}
