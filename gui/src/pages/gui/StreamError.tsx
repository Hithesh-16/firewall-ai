import {
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  ClipboardIcon,
  Cog6ToothIcon,
  KeyIcon,
} from "@heroicons/react/24/outline";
import { DISCUSSIONS_LINK } from "core/util/constants";
import { useContext, useMemo } from "react";
import { GhostButton, SecondaryButton } from "../../components";
import { useEditModel } from "../../components/mainInput/Lump/useEditBlock";
import { useMainEditor } from "../../components/mainInput/TipTapEditor";
import { GithubIcon } from "../../components/svg/GithubIcon";
import ToggleDiv from "../../components/ToggleDiv";
import { useAuth } from "../../context/Auth";
import { IdeMessengerContext } from "../../context/IdeMessenger";
import { useAppDispatch, useAppSelector } from "../../redux/hooks";
import { selectSelectedChatModel } from "../../redux/slices/configSlice";
import { selectSelectedProfile } from "../../redux/slices/profilesSlice";
import { setPendingFirewallConsent } from "../../redux/slices/securitySlice";
import { setDialogMessage, setShowDialog } from "../../redux/slices/uiSlice";
import { streamResponseThunk } from "../../redux/thunks/streamResponse";
import { isLocalProfile } from "../../util";
import { analyzeError } from "../../util/errorAnalysis";
import { OutOfCreditsDialog } from "./OutOfCreditsDialog";

interface StreamErrorProps {
  error: unknown;
}

const StreamErrorDialog = ({ error }: StreamErrorProps) => {
  const dispatch = useAppDispatch();
  const ideMessenger = useContext(IdeMessengerContext);
  const selectedModel = useAppSelector(selectSelectedChatModel);
  const selectedProfile = useAppSelector(selectSelectedProfile);
  const { session, refreshProfiles } = useAuth();
  const { mainEditor } = useMainEditor();

  const {
    parsedError,
    statusCode,
    message,
    modelTitle,
    providerName,
    apiKeyUrl,
  } = useMemo(() => analyzeError(error, selectedModel), [error, selectedModel]);

  const handleRefreshProfiles = () => {
    void refreshProfiles("Clicked reload config from stream error dialog");
    dispatch(setShowDialog(false));
    dispatch(setDialogMessage(undefined));
  };

  const copyErrorToClipboard = () => {
    void navigator.clipboard.writeText(parsedError);
  };

  const history = useAppSelector((store) => store.session.history);

  const checkKeysButton = apiKeyUrl ? (
    <GhostButton
      className="flex items-center"
      onClick={() => ideMessenger.ide.openUrl(apiKeyUrl)}
    >
      <KeyIcon className="mr-1.5 h-3.5 w-3.5" />
      <span>View key</span>
    </GhostButton>
  ) : null;

  const handleEditModel = useEditModel();

  const configButton = (
    <GhostButton
      className="flex items-center"
      onClick={() => handleEditModel(selectedModel)}
    >
      <Cog6ToothIcon className="mr-1.5 h-3.5 w-3.5" />
      <span>View config</span>
    </GhostButton>
  );

  const resubmitButton = (
    <GhostButton
      className="flex items-center"
      onClick={() => {
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

        if (!mainEditor) {
          console.error("Main editor not found, cannot resubmit message.");
          return;
        }

        const editorState =
          index === -1 ? mainEditor.getJSON() : history[index].editorState;

        void dispatch(
          streamResponseThunk({
            editorState,
            modifiers: {
              noContext: true,
              useCodebase: false,
            },
            index: index === -1 ? 0 : index,
          }),
        );
        dispatch(setShowDialog(false));
        dispatch(setDialogMessage(undefined));
      }}
    >
      <ArrowPathIcon className="mr-1.5 h-3.5 w-3.5" />
      <span>Resubmit last message</span>
    </GhostButton>
  );

  if (parsedError.includes("You're out of credits!")) {
    return <OutOfCreditsDialog />;
  }

  // ── AI Firewall block — this dialog is the fallback path only ───
  //
  // Firewall flags now surface as an inline consent popover above the
  // chat input (see `streamThunkWrapper` routing to
  // `setPendingFirewallConsent` + gui/src/components/security/FirewallConsentCard.tsx).
  // If some transport strips the typed error and this branch still gets
  // hit, we render the findings + the same three choices so the user
  // isn't stuck with a generic "error handling model response" panel.
  const isFirewallBlock =
    (error instanceof Error && error.name === "FirewallBlockedRequestError") ||
    (typeof message === "string" && message.startsWith("AI Firewall"));

  if (isFirewallBlock) {
    // Pull structured detail off the error if available; fall back to
    // string parsing if a downstream wrapper has stripped the typed
    // class (e.g. JSON-serialized over IPC).
    const detail =
      error instanceof Error &&
      "detail" in error &&
      typeof (error as { detail?: unknown }).detail === "object"
        ? (
            error as {
              detail: {
                riskScore?: number;
                reasons?: string[];
                findings?: Array<{
                  type: string;
                  severity?: string;
                  masked?: string;
                }>;
              };
            }
          ).detail
        : undefined;
    const riskScore =
      detail?.riskScore ??
      (() => {
        const m = /risk:\s*(\d+)/i.exec(message ?? "");
        return m ? Number(m[1]) : undefined;
      })();
    const reasons = detail?.reasons ?? [];
    const findings = detail?.findings ?? [];

    const closeAndOpenInlineConsent = () => {
      if (detail && "action" in detail) {
        dispatch(
          setPendingFirewallConsent({
            riskScore: detail.riskScore ?? 0,
            reasons: detail.reasons ?? [],
            findings: (detail.findings ?? []).map((f) => ({
              type: f.type,
              severity: f.severity,
              masked: f.masked,
            })),
            action: "BLOCK",
          }),
        );
      }
      dispatch(setShowDialog(false));
      dispatch(setDialogMessage(undefined));
    };

    return (
      <div className="flex flex-col gap-4 px-3 pb-3 pt-3">
        <div className="flex items-center gap-2">
          <span className="text-xl">{"\u26A0\uFE0F"}</span>
          <h3 className="text-warning m-0 p-0 text-lg font-medium">
            AI Firewall flagged this request
          </h3>
        </div>

        <p className="m-0 p-0 text-sm">
          The proxy detected sensitive content in your message before forwarding
          it to <code>{selectedModel?.title ?? "the model"}</code>. Choose how
          to proceed in the consent card above the chat input.
          {typeof riskScore === "number" ? (
            <>
              {" "}
              <span className="text-description">
                (risk score:&nbsp;<strong>{riskScore}</strong>/100)
              </span>
            </>
          ) : null}
        </p>

        {findings.length > 0 ? (
          <div className="bg-warning/5 border-warning/30 flex flex-col gap-2 rounded border p-3">
            <div className="text-xs font-semibold uppercase tracking-wider">
              Findings
            </div>
            <ul className="m-0 flex flex-col gap-1 p-0">
              {findings.map((f, i) => (
                <li
                  key={`${f.type}-${i}`}
                  className="flex items-center gap-2 text-sm"
                >
                  <code className="bg-warning/10 rounded px-1.5 py-0.5 text-xs">
                    {f.type}
                  </code>
                  {f.severity ? (
                    <span className="text-description text-xs">
                      {f.severity}
                    </span>
                  ) : null}
                  {f.masked ? (
                    <code className="text-description font-mono text-xs">
                      {f.masked}
                    </code>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {reasons.length > 0 ? (
          <div className="flex flex-col gap-1 text-sm">
            <span className="text-description text-xs font-semibold uppercase tracking-wider">
              Reasons
            </span>
            <ul className="m-0 flex flex-col gap-0.5 pl-5">
              {reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="flex flex-row flex-wrap gap-2">
          <GhostButton
            className="flex items-center"
            onClick={closeAndOpenInlineConsent}
          >
            <ArrowPathIcon className="mr-1.5 h-3.5 w-3.5" />
            <span>Review &amp; resubmit</span>
          </GhostButton>
        </div>
      </div>
    );
  }

  let errorContent = (
    <div className="mb-1 mt-3">
      <div className="m-0 p-0">
        <p className="m-0 mb-2 p-0">
          There was an error handling the response from{" "}
          {selectedModel?.title || "the model"}.
        </p>
        <p className="m-0 p-0">
          Please try to submit your message again, and if the error persists,
          let us know by reporting the issue using the buttons below.
        </p>
        <div className="mt-3">{resubmitButton}</div>
      </div>
    </div>
  );

  // Display components for specific errors
  if (statusCode === 429) {
    errorContent = (
      <div className="flex flex-col gap-2">
        <span>
          {`This might mean your ${modelTitle} usage has been rate limited
                by ${providerName}.`}
        </span>
        <div className="flex flex-row flex-wrap justify-start gap-3 py-4">
          {checkKeysButton}
          {configButton}
        </div>
      </div>
    );
  }

  if (statusCode === 404) {
    errorContent = (
      <div className="flex flex-col gap-2">
        <span>Likely causes:</span>
        <ul className="m-0">
          <li>
            <span>Invalid</span>
            <code>apiBase</code>
            {selectedModel && (
              <>
                <span>{`: `}</span>
                <code>{selectedModel.apiBase}</code>
              </>
            )}
          </li>
          <li>
            <span>Model/deployment not found</span>
            {selectedModel && (
              <>
                <span>{` for: `}</span>
                <code>{selectedModel.model}</code>
              </>
            )}
          </li>
        </ul>
        <div>{configButton}</div>
      </div>
    );
  }

  if (statusCode === 401) {
    errorContent = (
      <div className="flex flex-col gap-2">
        {session && selectedProfile && !isLocalProfile(selectedProfile) && (
          <div className="flex flex-col gap-1">
            <span>{`If your hub secret values may have changed, refresh your agents`}</span>
            <SecondaryButton onClick={handleRefreshProfiles}>
              Refresh agent secrets
            </SecondaryButton>
          </div>
        )}
        <span>{`It's possible that your API key is invalid.`}</span>
        <div className="flex flex-row flex-wrap gap-2">
          {checkKeysButton}
          {configButton}
        </div>
      </div>
    );
  }

  if (statusCode === 403) {
    errorContent = (
      <div className="flex flex-col gap-2">
        <span>{`Likely cause: not authorized to access the model deployment.`}</span>
        <div className="flex flex-row flex-wrap gap-2">
          {checkKeysButton}
          {configButton}
        </div>
      </div>
    );
  }

  if (
    message &&
    (message.toLowerCase().includes("overloaded") ||
      message.toLowerCase().includes("malformed json"))
  ) {
    errorContent = (
      <div className="flex flex-col gap-2">
        <span>{`Most likely, the provider's server(s) are overloaded and streaming was interrupted. Try again later`}</span>
        {selectedModel ? (
          <span>
            {`Provider: `}
            <code>{selectedModel.underlyingProviderName}</code>
          </span>
        ) : null}
        {/* TODO: status page links for providers? */}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 px-3 pb-3 pt-3">
      {/* Concise error title */}
      <h3 className="text-error m-0 p-0 text-lg font-medium">
        Error handling model response
      </h3>

      {errorContent}

      {/* Expandable technical details using ToggleDiv */}
      {message && (
        <div className="mb-2">
          <ToggleDiv
            title="View error output"
            testId="error-output-toggle"
            defaultOpen
          >
            <div className="flex flex-col gap-0 rounded-sm">
              <code className="text-editor-foreground block max-h-48 overflow-y-auto p-3 font-mono text-xs">
                {parsedError}
              </code>

              <div className="flex flex-row items-center justify-end gap-2 p-2">
                <GhostButton
                  onClick={copyErrorToClipboard}
                  className="flex items-center"
                >
                  <ClipboardIcon className="mr-1.5 h-3.5 w-3.5" />
                  <span>Copy output</span>
                </GhostButton>

                <GhostButton
                  onClick={() => {
                    ideMessenger.post("toggleDevTools", undefined);
                  }}
                  className="flex items-center"
                >
                  <ArrowTopRightOnSquareIcon className="mr-1.5 h-4 w-4" />
                  <span className="text-xs">View Logs</span>
                </GhostButton>
              </div>
            </div>
          </ToggleDiv>
        </div>
      )}

      <div>
        <span className="text-base font-medium">Report this error</span>
        <div className="mt-2 flex flex-row flex-wrap items-center gap-2">
          <GhostButton
            className="flex flex-row items-center gap-2 rounded px-3 py-1.5"
            onClick={() => {
              const issueTitle = `Error: ${selectedModel?.title || "Model"} - ${statusCode || "Unknown error"}`;
              const issueBody = `**Error Details**

Model: ${selectedModel?.title || "Unknown"}
Provider: ${selectedModel ? `${selectedModel.underlyingProviderName}${selectedModel.provider === "continue-proxy" ? " (ai-firewall-proxy)" : ""}` : "Unknown"}
Status Code: ${statusCode || "N/A"}

**Error Output**
\`\`\`
${parsedError}
\`\`\`

**Additional Context**
Please add any additional context about the error here
`;
              const url = `https://github.com/ai-firewall/ai-firewall/issues/new?title=${encodeURIComponent(issueTitle)}&body=${encodeURIComponent(issueBody)}`;
              ideMessenger.post("openUrl", url);
            }}
          >
            <GithubIcon className="h-5 w-5" />
            <span className="xs:flex hidden">Open GitHub issue</span>
          </GhostButton>
          <GhostButton
            className="flex flex-row items-center gap-2 rounded px-3 py-1.5"
            onClick={() => {
              ideMessenger.post("openUrl", DISCUSSIONS_LINK);
            }}
          >
            <GithubIcon className="h-5 w-5" />
            <span className="xs:flex hidden">Discussions</span>
          </GhostButton>
        </div>
      </div>
    </div>
  );
};

export default StreamErrorDialog;
