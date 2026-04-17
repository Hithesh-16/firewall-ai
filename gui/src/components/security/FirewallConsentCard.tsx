import { useMainEditor } from "../mainInput/TipTapEditor";
import { useAppDispatch, useAppSelector } from "../../redux/hooks";
import {
  setFirewallOverride,
  setPendingFirewallConsent,
} from "../../redux/slices/securitySlice";
import { streamResponseThunk } from "../../redux/thunks/streamResponse";

/**
 * Inline consent popover for firewall flags. Renders above the chat
 * input in the same slot as the tool-permission card so the user never
 * sees a blocking modal — they choose to redact, bypass, or cancel and
 * keep going. The matching ScanResultBanner continues to show the
 * findings above the input while this card is open.
 */
export function FirewallConsentCard() {
  const dispatch = useAppDispatch();
  const { mainEditor } = useMainEditor();
  const detail = useAppSelector((s) => s.security.pendingFirewallConsent);
  const history = useAppSelector((s) => s.session.history);

  if (!detail) return null;

  const findings = detail.findings ?? [];
  const topFindings = findings.slice(0, 5);
  const moreCount = findings.length - topFindings.length;

  const clear = () => dispatch(setPendingFirewallConsent(null));

  const resubmitWith = (override: "bypass" | "redact") => {
    if (!mainEditor) {
      clear();
      return;
    }

    let index = -1;
    for (let i = history.length - 1; i >= 0; i--) {
      if (
        history[i].message.role === "user" ||
        history[i].message.role === "tool"
      ) {
        index = i;
        break;
      }
    }
    const editorState =
      index === -1 ? mainEditor.getJSON() : history[index].editorState;

    dispatch(setFirewallOverride(override));
    clear();
    void dispatch(
      streamResponseThunk({
        editorState,
        modifiers: { noContext: true, useCodebase: false },
        index: index === -1 ? 0 : index,
      }),
    );
  };

  return (
    <div className="flex w-full flex-col gap-1.5 pb-1">
      <div className="border-foreground/[0.08] bg-editor animate-in fade-in slide-in-from-top-1 rounded-[10px] border px-4 py-4 shadow-[0_8px_32px_rgba(0,0,0,0.55)] transition-all duration-200">
        <div className="mb-2.5 flex items-center gap-2">
          <span className="text-base leading-none">{"\u26A0\uFE0F"}</span>
          <p className="text-foreground m-0 text-xs font-semibold">
            AI Firewall flagged this prompt
          </p>
          <span className="text-description-muted ml-auto font-mono text-[10px]">
            Risk {detail.riskScore}/100
          </span>
        </div>

        {topFindings.length > 0 && (
          <div className="bg-input mb-3 flex flex-col gap-1 rounded-md px-2.5 py-2">
            {topFindings.map((f, i) => (
              <div
                key={`${f.type}-${i}`}
                className="flex items-center gap-2 text-[11px]"
              >
                <span
                  className={`rounded px-1 font-mono font-medium ${
                    f.severity === "critical" || f.severity === "high"
                      ? "bg-error/15 text-error"
                      : "bg-warning/15 text-warning"
                  }`}
                >
                  {(f.severity ?? "med").slice(0, 4).toUpperCase()}
                </span>
                <span className="text-description">{f.type}</span>
                {f.masked ? (
                  <code className="text-error font-mono font-semibold">
                    {f.masked}
                  </code>
                ) : null}
              </div>
            ))}
            {moreCount > 0 && (
              <span className="text-description-muted text-[10px]">
                +{moreCount} more
              </span>
            )}
          </div>
        )}

        <div className="mb-3 flex flex-col gap-1.5">
          <button
            onClick={() => resubmitWith("redact")}
            className="text-primary-foreground bg-primary flex items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-left text-xs font-semibold transition-all hover:brightness-110"
          >
            <span className="bg-primary-foreground/20 flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-bold">
              1
            </span>
            <span>Redact &amp; send</span>
          </button>

          <button
            onClick={() => resubmitWith("bypass")}
            className="border-foreground/[0.07] bg-input text-description-muted hover:bg-list-hover hover:border-foreground/[0.12] flex items-center gap-2.5 rounded-lg border px-2.5 py-2.5 text-left text-xs transition-colors"
          >
            <span className="bg-badge text-badge-foreground flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-bold">
              2
            </span>
            <span>Send as-is (bypass this request)</span>
          </button>

          <button
            onClick={clear}
            className="border-foreground/[0.07] bg-input text-description-muted hover:bg-list-hover hover:border-foreground/[0.12] flex items-center gap-2.5 rounded-lg border px-2.5 py-2.5 text-left text-xs transition-colors"
          >
            <span className="bg-badge text-badge-foreground flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-bold">
              3
            </span>
            <span>Cancel</span>
          </button>
        </div>

        {detail.reasons.length > 0 && (
          <p className="text-description-muted m-0 text-[10px]">
            {detail.reasons.slice(0, 2).join(" \u2022 ")}
            {detail.reasons.length > 2
              ? ` \u2022 +${detail.reasons.length - 2} more`
              : ""}
          </p>
        )}
      </div>
    </div>
  );
}
