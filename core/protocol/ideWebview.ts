import { ToIdeFromWebviewOrCoreProtocol } from "./ide";
import { ToWebviewFromIdeOrCoreProtocol } from "./webview";

import {
  AcceptOrRejectDiffPayload,
  AddToChatPayload,
  ApplyState,
  ApplyToFilePayload,
  ContextItemWithId,
  HighlightedCodePayload,
  MessageContent,
  RangeInFile,
  RangeInFileWithContents,
  SetCodeToEditPayload,
  ShowFilePayload,
} from "../";

export type ToIdeFromWebviewProtocol = ToIdeFromWebviewOrCoreProtocol & {
  openUrl: [string, void];
  applyToFile: [ApplyToFilePayload, void];
  overwriteFile: [{ filepath: string; prevFileContent: string | null }, void];
  showTutorial: [undefined, void];
  showFile: [ShowFilePayload, void];
  toggleDevTools: [undefined, void];
  reloadWindow: [undefined, void];
  focusEditor: [undefined, void];
  toggleFullScreen: [{ newWindow?: boolean } | undefined, void];
  insertAtCursor: [{ text: string }, void];
  copyText: [{ text: string }, void];
  "jetbrains/isOSREnabled": [undefined, boolean];
  "jetbrains/onLoad": [
    undefined,
    {
      windowId: string;
      serverUrl: string;
      workspacePaths: string[];
      vscMachineId: string;
      vscMediaUrl: string;
    },
  ];
  "jetbrains/getColors": [undefined, Record<string, string | null | undefined>];
  "vscode/openMoveRightMarkdown": [undefined, void];
  acceptDiff: [AcceptOrRejectDiffPayload, void];
  rejectDiff: [AcceptOrRejectDiffPayload, void];
  "edit/sendPrompt": [
    {
      prompt: MessageContent;
      range: RangeInFileWithContents;
    },
    string | undefined,
  ];
  "edit/addCurrentSelection": [undefined, void];
  "edit/clearDecorations": [undefined, void];
  "session/share": [{ sessionId: string }, void];
  createBackgroundAgent: [
    {
      content: MessageContent;
      contextItems: ContextItemWithId[];
      selectedCode: RangeInFile[];
      organizationId?: string;
      agent?: string;
    },
    void,
  ];
  listBackgroundAgents: [
    { organizationId?: string; limit?: number },
    {
      agents: Array<{
        id: string;
        name: string | null;
        status: string;
        repoUrl: string;
        createdAt: string;
        metadata?: {
          github_repo?: string;
        };
      }>;
      totalCount: number;
    },
  ];
  openAgentLocally: [
    {
      agentSessionId: string;
    },
    void,
  ];

  // Webview polls this on mount to hydrate the sign-in gate before
  // any push event from the extension arrives (protocol messages
  // sent by the host are dropped if the webview hasn't finished
  // booting yet, so we can't rely on push-only state).
  "aiFirewall/getAuthState": [
    undefined,
    {
      signedIn: boolean;
      email?: string;
      name?: string;
      role?: string;
      userId?: number;
    },
  ];

  // Add a model to the signed-in user's account via the proxy's
  // unified /api/me/models/add endpoint. The request is proxied
  // through the extension host (not made directly from the webview)
  // so the bearer token never leaves the extension sandbox.
  //
  // ok=true  → the model was persisted to proxy `user_models` table;
  //            webview should close the form + refresh its model list.
  // ok=false → `error` holds a human-readable reason (not signed in,
  //            proxy unreachable, validation failure, etc.). Webview
  //            may fall back to the local config/addModel path for
  //            fully-offline users.
  "aiFirewall/addUserModel": [
    {
      providerSlug: string;
      modelSlug: string;
      displayName?: string;
      apiKey: string;
      apiBase?: string;
      roles?: string[];
    },
    {
      ok: boolean;
      model?: {
        id: number;
        providerSlug: string;
        modelSlug: string;
        displayName: string | null;
        apiBase: string | null;
        roles: string[];
      };
      error?: string;
    },
  ];
};

export type ToWebviewFromIdeProtocol = ToWebviewFromIdeOrCoreProtocol & {
  setInactive: [undefined, void];
  newSessionWithPrompt: [{ prompt: string }, void];
  userInput: [{ input: string }, void];
  focusContinueInput: [undefined, void];
  focusContinueInputWithoutClear: [undefined, void];
  focusContinueInputWithNewSession: [undefined, void];
  highlightedCode: [HighlightedCodePayload, void];
  setCodeToEdit: [SetCodeToEditPayload, void];
  navigateTo: [{ path: string; toggle?: boolean }, void];
  addModel: [undefined, void];

  focusContinueSessionId: [{ sessionId: string | undefined }, void];
  newSession: [undefined, void];
  loadAgentSession: [{ session: any }, void];
  setTheme: [{ theme: any }, void];
  setColors: [{ [key: string]: string }, void];
  "jetbrains/editorInsetRefresh": [undefined, void];
  "jetbrains/isOSREnabled": [boolean, void];
  setupApiKey: [undefined, void];
  setupLocalConfig: [undefined, void];
  incrementFtc: [undefined, void];
  openOnboardingCard: [undefined, void];
  applyCodeFromChat: [undefined, void];
  updateApplyState: [ApplyState, void];
  exitEditMode: [undefined, void];
  focusEdit: [undefined, void];
  generateRule: [undefined, void];
  addToChat: [AddToChatPayload, void];
  customEvent: [{ eventName: string; data: any }, void];

  // Pushed by the extension host whenever AiFirewallAuthService.onDidChangeAuth
  // fires. The webview uses this to clear chat history on sign-out or
  // account switch, and to toggle the sign-in gate vs the chat UI.
  "aiFirewall/authState": [
    {
      signedIn: boolean;
      email?: string;
      name?: string;
      role?: string;
      userId?: number;
    },
    void,
  ];
};
