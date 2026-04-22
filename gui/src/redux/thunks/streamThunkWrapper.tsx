import { createAsyncThunk } from "@reduxjs/toolkit";
import type { BlockDetail } from "core/llm/firewallScan";
import posthog from "posthog-js";
import StreamErrorDialog from "../../pages/gui/StreamError";
import { analyzeError } from "../../util/errorAnalysis";
import { selectSelectedChatModel } from "../slices/configSlice";
import { setPendingFirewallConsent } from "../slices/securitySlice";
import { setDialogMessage, setShowDialog } from "../slices/uiSlice";
import { ThunkApiType } from "../store";
import { cancelStream } from "./cancelStream";
import { saveCurrentSession } from "./session";

/**
 * Extract the firewall BlockDetail from a caught error regardless of
 * whether the Error prototype survived IPC. JetBrains' webview proxy
 * flattens errors into plain objects, so `instanceof` is unreliable —
 * match on `name` + presence of `detail` instead.
 *
 * Defensive: if the error looks like a firewall flag but `detail` has
 * been stripped by the transport layer, we still synthesise a minimal
 * BlockDetail from the error message rather than falling through to
 * the generic error dialog (P7 — the fallback modal was alarming and
 * user-visible even when the inline consent card path worked). A
 * firewall flag always belongs to the inline consent flow.
 */
function extractFirewallBlockDetail(e: unknown): BlockDetail | null {
  if (!e || typeof e !== "object") return null;
  const anyErr = e as { name?: string; message?: string; detail?: unknown };
  const looksLikeFirewallError =
    anyErr.name === "FirewallBlockedRequestError" ||
    (typeof anyErr.message === "string" &&
      anyErr.message.startsWith("AI Firewall"));
  if (!looksLikeFirewallError) return null;

  const detail = anyErr.detail;
  if (detail && typeof detail === "object") {
    const d = detail as Partial<BlockDetail>;
    return {
      riskScore: typeof d.riskScore === "number" ? d.riskScore : 0,
      reasons: Array.isArray(d.reasons) ? d.reasons : [],
      findings: Array.isArray(d.findings) ? d.findings : [],
      action: d.action ?? "BLOCK",
    };
  }

  // Detail was stripped in transit — best-effort parse from the
  // message so the user still lands on the inline consent card
  // rather than the disruptive StreamErrorDialog popover.
  const msg = typeof anyErr.message === "string" ? anyErr.message : "";
  const riskMatch = /risk:\s*(\d+)/i.exec(msg);
  return {
    riskScore: riskMatch ? Number(riskMatch[1]) : 0,
    reasons: msg ? [msg] : [],
    findings: [],
    action: "BLOCK",
  };
}

const OVERLOADED_RETRIES = 3;
const OVERLOADED_DELAY_MS = 1000;

function isOverloadedErrorMessage(message?: string | null): boolean {
  if (!message) return false;
  const lower = message.toLowerCase();
  return lower.includes("overloaded") || lower.includes("malformed json");
}

export const streamThunkWrapper = createAsyncThunk<
  void,
  () => Promise<void>,
  ThunkApiType
>("chat/streamWrapper", async (runStream, { dispatch, getState }) => {
  for (let attempt = 0; attempt <= OVERLOADED_RETRIES; attempt++) {
    try {
      await runStream();
      const state = getState();
      if (!state.session.isInEdit) {
        await dispatch(
          saveCurrentSession({
            openNewSession: false,
            generateTitle: true,
          }),
        );
      }
      return;
    } catch (e) {
      // Get the selected model from the state for error analysis
      const state = getState();
      const selectedModel = selectSelectedChatModel(state);
      const { parsedError, statusCode, message, modelTitle, providerName } =
        analyzeError(e, selectedModel);

      const shouldRetry =
        isOverloadedErrorMessage(message) && attempt < OVERLOADED_RETRIES;

      const firewallDetail = extractFirewallBlockDetail(e);

      if (shouldRetry) {
        await dispatch(cancelStream());
        const delayMs = OVERLOADED_DELAY_MS * 2 ** attempt;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        await dispatch(cancelStream());
      } else if (firewallDetail) {
        // Firewall flags surface inline above the chat input (like the
        // tool-permission card) instead of a blocking modal dialog. The
        // findings stay visible in the ScanResultBanner while the user
        // decides; see gui/src/components/security/FirewallConsentCard.tsx.
        await dispatch(cancelStream());
        dispatch(setPendingFirewallConsent(firewallDetail));
        return;
      } else {
        await dispatch(cancelStream());
        dispatch(setDialogMessage(<StreamErrorDialog error={e} />));
        dispatch(setShowDialog(true));

        const errorData = {
          error_type: statusCode ? `HTTP ${statusCode}` : "Unknown",
          error_message: parsedError,
          model_provider: providerName,
          model_title: modelTitle,
        };

        posthog.capture("gui_stream_error", errorData);
        return;
      }
    }
  }
});
