import fs from "fs";
import path from "path";

import { IContextProvider } from "core";
import { ConfigHandler } from "core/config/ConfigHandler";
import { EXTENSION_NAME, getControlPlaneEnv } from "core/control-plane/env";
import { Core } from "core/core";
import { FromCoreProtocol, ToCoreProtocol } from "core/protocol";
import { InProcessMessenger } from "core/protocol/messenger";
import {
  getConfigJsonPath,
  getConfigTsPath,
  getConfigYamlPath,
  getAiFirewallGlobalPath,
} from "core/util/paths";
import { v4 as uuidv4 } from "uuid";
import * as vscode from "vscode";

import { ContinueCompletionProvider } from "../autocomplete/completionProvider";
import {
  monitorBatteryChanges,
  setupStatusBar,
  StatusBarStatus,
} from "../autocomplete/statusBar";
import { registerAllCommands } from "../commands";
import { ContinueConsoleWebviewViewProvider } from "../ContinueConsoleWebviewViewProvider";
import { ContinueGUIWebviewViewProvider } from "../ContinueGUIWebviewViewProvider";
import { VerticalDiffManager } from "../diff/vertical/manager";
import { registerAllCodeLensProviders } from "../lang-server/codeLens";
import { registerAllPromptFilesCompletionProviders } from "../lang-server/promptFileCompletions";
import EditDecorationManager from "../quickEdit/EditDecorationManager";
import { QuickEdit } from "../quickEdit/QuickEditQuickPick";
import { AiFirewallAuthService } from "../auth/aiFirewallAuthService";
import {
  registerRestrictedFileDecorator,
  refreshRestrictedFileDecorations,
} from "../security/restrictedFileDecorator";
import { setupRemoteConfigSync } from "../stubs/activation";
import { UriEventHandler } from "../stubs/uriHandler";
import {
  getControlPlaneSessionInfo,
  WorkOsAuthProvider,
} from "../stubs/WorkOsAuthProvider";
import { Battery } from "../util/battery";
import { FileSearch } from "../util/FileSearch";
import { VsCodeIdeUtils } from "../util/ideUtils";
import { VsCodeIde } from "../VsCodeIde";

import { onScanResult } from "@ai-firewall/fetch";
import { updateStatusBarAfterScan } from "../autocomplete/statusBar";
import { ProxyManager } from "../proxy/ProxyManager";
import { ConfigYamlDocumentLinkProvider } from "./ConfigYamlDocumentLinkProvider";
import { VsCodeMessenger } from "./VsCodeMessenger";

import { modelSupportsNextEdit } from "core/llm/autodetect";
import { NEXT_EDIT_MODELS } from "core/llm/constants";
import { NextEditProvider } from "core/nextEdit/NextEditProvider";
import { isNextEditTest } from "core/nextEdit/utils";
import { wrapWithScanner } from "core/util/scanning/ScanningIde";
import { JumpManager } from "../activation/JumpManager";
import setupNextEditWindowManager, {
  NextEditWindowManager,
} from "../activation/NextEditWindowManager";
import {
  HandlerPriority,
  SelectionChangeManager,
} from "../activation/SelectionChangeManager";
import { GhostTextAcceptanceTracker } from "../autocomplete/GhostTextAcceptanceTracker";
import { getDefinitionsFromLsp } from "../autocomplete/lsp";
import {
  clearDocumentContentCache,
  handleTextDocumentChange,
  initDocumentContentCache,
} from "../util/editLoggingUtils";
import type { VsCodeWebviewProtocol } from "../webviewProtocol";

export class VsCodeExtension {
  // Currently some of these are public so they can be used in testing (test/test-suites)

  private configHandler: ConfigHandler;
  private extensionContext: vscode.ExtensionContext;
  private ide: VsCodeIde;
  private ideUtils: VsCodeIdeUtils;
  private consoleView: ContinueConsoleWebviewViewProvider;
  private sidebar: ContinueGUIWebviewViewProvider;
  private windowId: string;
  private editDecorationManager: EditDecorationManager;
  private verticalDiffManager: VerticalDiffManager;
  webviewProtocolPromise: Promise<VsCodeWebviewProtocol>;
  private core: Core;
  private battery: Battery;
  private workOsAuthProvider: WorkOsAuthProvider;
  public aiFirewallAuth: AiFirewallAuthService;
  private fileSearch: FileSearch;
  private uriHandler = new UriEventHandler();
  private completionProvider: ContinueCompletionProvider;
  private proxyManager: ProxyManager;

  private ARBITRARY_TYPING_DELAY = 2000;

  /**
   * This is how you turn next edit on or off at the extension level.
   * This is called on config reload and autocomplete menu updates.
   * This is also the place you want to check to enable/disable next edit during e2e tests,
   * because it tends to stain other e2e tests and make them fail.
   */
  private async updateNextEditState(
    context: vscode.ExtensionContext,
  ): Promise<void> {
    const { config: continueConfig } = await this.configHandler.loadConfig();
    const autocompleteModel = continueConfig?.selectedModelByRole.autocomplete;
    const vscodeConfig = vscode.workspace.getConfiguration(EXTENSION_NAME);

    const modelSupportsNext =
      autocompleteModel &&
      modelSupportsNextEdit(
        autocompleteModel.capabilities,
        autocompleteModel.model,
        autocompleteModel.title,
      );

    // Use smart defaults.
    let nextEditEnabled = vscodeConfig.get<boolean>("enableNextEdit");
    if (nextEditEnabled === undefined) {
      // First time - set smart default.
      nextEditEnabled = modelSupportsNext ?? false;
      await vscodeConfig.update(
        "enableNextEdit",
        nextEditEnabled,
        vscode.ConfigurationTarget.Global,
      );
    }

    // Check if Next Edit is enabled but model doesn't support it.
    if (
      nextEditEnabled &&
      !modelSupportsNext &&
      !isNextEditTest() &&
      process.env.AI_FIREWALL_E2E_NON_NEXT_EDIT_TEST === "true"
    ) {
      vscode.window
        .showWarningMessage(
          `The current autocomplete model (${autocompleteModel?.title || "unknown"}) does not support Next Edit.`,
          "Disable Next Edit",
          "Select different model",
        )
        .then((selection) => {
          if (selection === "Disable Next Edit") {
            vscodeConfig.update(
              "enableNextEdit",
              false,
              vscode.ConfigurationTarget.Global,
            );
          } else if (selection === "Select different model") {
            vscode.commands.executeCommand(
              "aiFirewall.openTabAutocompleteConfigMenu",
            );
          }
        });
    }

    const shouldEnableNextEdit =
      (modelSupportsNext && nextEditEnabled) || isNextEditTest();

    if (shouldEnableNextEdit) {
      await setupNextEditWindowManager(context);
      this.activateNextEdit();
      await NextEditWindowManager.freeTabAndEsc();

      const jumpManager = JumpManager.getInstance();
      jumpManager.registerSelectionChangeHandler();

      const ghostTextAcceptanceTracker =
        GhostTextAcceptanceTracker.getInstance();
      ghostTextAcceptanceTracker.registerSelectionChangeHandler();

      const nextEditWindowManager = NextEditWindowManager.getInstance();
      nextEditWindowManager.registerSelectionChangeHandler();
    } else {
      NextEditWindowManager.clearInstance();
      this.deactivateNextEdit();
      await NextEditWindowManager.freeTabAndEsc();

      JumpManager.clearInstance();
      GhostTextAcceptanceTracker.clearInstance();
    }
  }

  constructor(context: vscode.ExtensionContext) {
    // Register the Explorer badge for restricted files BEFORE the proxy
    // starts so the decorator is ready the moment the file scope loads.
    registerRestrictedFileDecorator(context);

    // Start AI Firewall proxy sidecar — deferred to avoid blocking extension activation
    this.proxyManager = new ProxyManager(context.extensionPath);
    // Defer proxy spawn by 1s so extension host stays responsive during activation
    setTimeout(async () => {
      await this.proxyManager.start();
      // Fetch file restriction policy from proxy after it's healthy
      try {
        const { refreshFileScope } =
          await import("../security/fileRestrictionChecker");
        await refreshFileScope(this.proxyManager.proxyUrl ?? undefined);
        refreshRestrictedFileDecorations();
      } catch {
        // Non-fatal — file restrictions checked server-side as fallback
      }
    }, 1000);
    context.subscriptions.push({ dispose: () => this.proxyManager.dispose() });

    // Phase 6: AI Firewall web-first auth. Constructed BEFORE the
    // legacy WorkOS provider so we can inject it — that provider's
    // removeSession() needs to call aiFirewallAuth.signOut() so a
    // VS Code Accounts-menu "Sign Out" clears the shared auth file,
    // revokes the proxy token, and clears SecretStorage (otherwise
    // the next profile-icon click silently rehydrates the old
    // session from ~/.ai-firewall/auth.json). Constructor is I/O-free.
    this.aiFirewallAuth = new AiFirewallAuthService(context);

    // Register auth provider
    this.workOsAuthProvider = new WorkOsAuthProvider(
      context,
      this.uriHandler,
      this.aiFirewallAuth,
    );

    // Defer session refresh — network call that can block
    setTimeout(() => void this.workOsAuthProvider.refreshSessions(), 1500);
    context.subscriptions.push(this.workOsAuthProvider);

    // Phase F2+ — pull the assistant YAML from /api/me/assistant and
    // write it to ~/.ai-firewall/config.yaml so Continue core's
    // ConfigHandler picks up the user's models. This is the VS Code
    // equivalent of the CLI's Phase G apiAssistantLoader — without it,
    // adding a model in the web dashboard would NOT show up in the
    // VS Code chat view.
    const runAssistantSync = async (token: string) => {
      try {
        const { syncAssistantToConfigYaml } =
          await import("../security/assistantSync");
        const proxyUrl = this.proxyManager.proxyUrl ?? "http://localhost:8080";
        const status = await syncAssistantToConfigYaml(proxyUrl, token);
        if (status.kind === "ok" && status.fresh) {
          // Ask the config handler to re-load the now-updated file.
          void this.core.invoke("config/refreshProfiles", {
            reason: "AI Firewall assistant sync",
          });
        }
      } catch {
        // Non-fatal — the extension stays usable with whatever
        // config is currently on disk.
      }
    };

    void this.aiFirewallAuth.initialize().then(async (state) => {
      // Phase E: whenever the auth state resolves, push the bearer
      // into the file-restriction checker so file-scope enforcement
      // reflects the signed-in user's role policy (not the legacy
      // unauthenticated global scope).
      if (state.signedIn && state.token) {
        const { refreshFileScope } =
          await import("../security/fileRestrictionChecker");
        await refreshFileScope(
          this.proxyManager.proxyUrl ?? undefined,
          state.token,
        );
        refreshRestrictedFileDecorations();
        // Initial assistant pull.
        await runAssistantSync(state.token);
      }
    });
    let lastAuthBroadcastKey: string | null = null;
    this.aiFirewallAuth.onDidChangeAuth(async (state) => {
      // ── 1. Broadcast to the webview FIRST ──────────────────────
      //
      // Everything below (file-scope refresh, assistant sync, and
      // especially `configHandler.refreshAll`) makes network calls
      // that can stall for seconds — refreshAll hits the control
      // plane, and on sign-out the token is invalid so the request
      // may sit until it 401s. If we `await` any of those before
      // posting `aiFirewall/authState`, the webview never sees the
      // event and Layout's `reactToAuthChange` never runs, so the
      // chat doesn't auto-navigate to /login on sign-out or back to
      // / on sign-in. Broadcasting first decouples the UI switch
      // from the slow/flaky cache refreshes.
      const key = state.signedIn
        ? `in:${state.user?.id ?? ""}:${state.user?.email ?? ""}`
        : "out";
      const shouldBroadcast = key !== lastAuthBroadcastKey;
      if (shouldBroadcast) {
        lastAuthBroadcastKey = key;
        try {
          this.sidebar.webviewProtocol.send("aiFirewall/authState", {
            signedIn: state.signedIn,
            email: state.user?.email,
            name: state.user?.name,
            role: state.user?.role,
            userId: state.user?.id,
          });
        } catch {
          // Sidebar not ready yet — the webview's on-mount poll
          // will pick up the current state as soon as it finishes
          // booting.
        }
      }

      // ── 2. File scope + assistant sync (fire-and-forget) ──────
      //
      // Kick these off but don't block the handler. They only
      // affect background concerns (file-restriction decorations,
      // the on-disk `config.yaml`) and the webview can update
      // independently.
      void (async () => {
        try {
          const { refreshFileScope, clearFileScope } =
            await import("../security/fileRestrictionChecker");
          if (state.signedIn && state.token) {
            await refreshFileScope(
              this.proxyManager.proxyUrl ?? undefined,
              state.token,
            );
            await runAssistantSync(state.token);
          } else {
            clearFileScope();
          }
          refreshRestrictedFileDecorations();
        } catch {
          /* non-fatal */
        }

        // Continue core's ConfigHandler caches orgs + profiles in
        // memory. Refresh AFTER the webview has been notified so a
        // slow control-plane fetch can't wedge the sign-in / sign-out
        // UI transition.
        try {
          await this.configHandler.refreshAll(
            state.signedIn
              ? "AI Firewall auth changed — reload profiles"
              : "AI Firewall signed out — clear profiles",
          );
        } catch {
          /* non-fatal */
        }
      })();
    });

    // Background sync every 10 minutes as a safety net for changes
    // the user makes in the web dashboard while VS Code is open.
    // The fetch is a conditional GET (304 on no change) so it's
    // effectively free. Cleared on dispose so we don't leak a
    // timer across reloads.
    const assistantSyncTimer = setInterval(
      () => {
        const s = this.aiFirewallAuth.getState();
        if (s.signedIn && s.token) {
          void runAssistantSync(s.token);
        }
      },
      10 * 60 * 1000,
    );

    // Policy refresh every 5 minutes so role-level file restrictions
    // and blocked_paths take effect without reloading VS Code when
    // an admin updates them in the web dashboard.
    const policySyncTimer = setInterval(
      async () => {
        const s = this.aiFirewallAuth.getState();
        if (s.signedIn && s.token) {
          try {
            const { refreshFileScope } =
              await import("../security/fileRestrictionChecker");
            await refreshFileScope(
              this.proxyManager.proxyUrl ?? undefined,
              s.token,
            );
            refreshRestrictedFileDecorations();
          } catch {
            // Non-fatal — stale policy is better than no policy
          }
        }
      },
      5 * 60 * 1000,
    );

    context.subscriptions.push({
      dispose: () => {
        clearInterval(assistantSyncTimer);
        clearInterval(policySyncTimer);
        this.aiFirewallAuth.dispose();
      },
    });

    this.editDecorationManager = new EditDecorationManager(context);

    let resolveWebviewProtocol: any = undefined;
    this.webviewProtocolPromise = new Promise<VsCodeWebviewProtocol>(
      (resolve) => {
        resolveWebviewProtocol = resolve;
      },
    );
    // AI Firewall scanning chokepoint: wrap the raw VsCodeIde so
    // every file read/write across context providers, tools,
    // indexing, and autocomplete routes through the central
    // scanner. Callers keep calling `ide.readFile(uri)` unchanged
    // and automatically get the safe default purpose (`"llm"`).
    this.ide = wrapWithScanner(
      new VsCodeIde(this.webviewProtocolPromise, context),
    );
    this.ideUtils = new VsCodeIdeUtils();
    this.extensionContext = context;
    this.windowId = uuidv4();

    // Check if model supports next edit to determine if we should use full file diff.
    const getUsingFullFileDiff = async () => {
      const { config } = await this.configHandler.loadConfig();
      const autocompleteModel = config?.selectedModelByRole.autocomplete;

      if (!autocompleteModel) {
        return false;
      }

      if (
        !modelSupportsNextEdit(
          autocompleteModel.capabilities,
          autocompleteModel.model,
          autocompleteModel.title,
        )
      ) {
        return false;
      }

      if (autocompleteModel.model.includes(NEXT_EDIT_MODELS.INSTINCT)) {
        return false;
      }

      return true;
    };

    const usingFullFileDiff = true;
    const selectionManager = SelectionChangeManager.getInstance();
    selectionManager.initialize(this.ide, usingFullFileDiff);

    selectionManager.registerListener(
      "typing",
      async (e, state) => {
        const timeSinceLastDocChange =
          Date.now() - state.lastDocumentChangeTime;
        if (
          state.isTypingSession &&
          timeSinceLastDocChange < this.ARBITRARY_TYPING_DELAY &&
          !NextEditWindowManager.getInstance().hasAccepted()
        ) {
          // console.debug(
          //   "VsCodeExtension: typing in progress, preserving chain",
          // );
          return true;
        }

        return false;
      },
      HandlerPriority.NORMAL,
    );

    // Dependencies of core
    let resolveVerticalDiffManager: any = undefined;
    const verticalDiffManagerPromise = new Promise<VerticalDiffManager>(
      (resolve) => {
        resolveVerticalDiffManager = resolve;
      },
    );
    let resolveConfigHandler: any = undefined;
    const configHandlerPromise = new Promise<ConfigHandler>((resolve) => {
      resolveConfigHandler = resolve;
    });
    this.sidebar = new ContinueGUIWebviewViewProvider(
      this.windowId,
      this.extensionContext,
    );

    // Sidebar
    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(
        "aiFirewall.aiFirewallGUIView",
        this.sidebar,
        {
          webviewOptions: { retainContextWhenHidden: true },
        },
      ),
    );
    resolveWebviewProtocol(this.sidebar.webviewProtocol);

    // Forward AI Firewall scan results from fetch layer → GUI webview + status bar
    const unsubScan = onScanResult((result) => {
      this.sidebar.webviewProtocol.request("firewallScanResult", result);
      updateStatusBarAfterScan({
        action: result.action,
        tokensUsed: result.tokensUsed,
        cost: result.cost,
        secretsCount: result.secretsCount,
        piiCount: result.piiCount,
        riskScore: result.riskScore,
        redactedTypes: result.redactedTypes,
      });
    });
    context.subscriptions.push({ dispose: unsubScan });

    // AI Firewall: Check if security perimeter needs setup on workspace open
    this.checkSecurityPerimeter(context);

    const inProcessMessenger = new InProcessMessenger<
      ToCoreProtocol,
      FromCoreProtocol
    >();

    new VsCodeMessenger(
      inProcessMessenger,
      this.sidebar.webviewProtocol,
      this.ide,
      verticalDiffManagerPromise,
      configHandlerPromise,
      this.workOsAuthProvider,
      this.editDecorationManager,
      context,
      this,
    );

    this.core = new Core(inProcessMessenger, this.ide);
    this.configHandler = this.core.configHandler;
    resolveConfigHandler?.(this.configHandler);

    void this.configHandler.loadConfig();

    this.verticalDiffManager = new VerticalDiffManager(
      this.sidebar.webviewProtocol,
      this.editDecorationManager,
      this.ide,
    );
    resolveVerticalDiffManager?.(this.verticalDiffManager);

    void setupRemoteConfigSync(() =>
      this.configHandler.reloadConfig.bind(this.configHandler)(
        "Remote config sync",
      ),
    );

    void this.configHandler.loadConfig().then(async ({ config }) => {
      const shouldUseFullFileDiff = await getUsingFullFileDiff();
      this.completionProvider.updateUsingFullFileDiff(shouldUseFullFileDiff);
      selectionManager.updateUsingFullFileDiff(shouldUseFullFileDiff);

      const { verticalDiffCodeLens } = registerAllCodeLensProviders(
        context,
        this.verticalDiffManager.fileUriToCodeLens,
        config,
      );

      this.verticalDiffManager.refreshCodeLens =
        verticalDiffCodeLens.refresh.bind(verticalDiffCodeLens);
    });

    this.configHandler.onConfigUpdate(
      async ({ config: newConfig, configLoadInterrupted }) => {
        const shouldUseFullFileDiff = await getUsingFullFileDiff();
        this.completionProvider.updateUsingFullFileDiff(shouldUseFullFileDiff);
        selectionManager.updateUsingFullFileDiff(shouldUseFullFileDiff);

        await this.updateNextEditState(context);

        if (configLoadInterrupted) {
          // Show error in status bar
          setupStatusBar(undefined, undefined, true);
        } else if (newConfig) {
          setupStatusBar(undefined, undefined, false);

          registerAllCodeLensProviders(
            context,
            this.verticalDiffManager.fileUriToCodeLens,
            newConfig,
          );
        }
      },
    );

    // Tab autocomplete
    const config = vscode.workspace.getConfiguration(EXTENSION_NAME);
    const enabled = config.get<boolean>("enableTabAutocomplete");

    // Register inline completion provider
    setupStatusBar(
      enabled ? StatusBarStatus.Enabled : StatusBarStatus.Disabled,
    );
    this.completionProvider = new ContinueCompletionProvider(
      this.configHandler,
      this.ide,
      this.sidebar.webviewProtocol,
      usingFullFileDiff,
    );
    context.subscriptions.push(
      vscode.languages.registerInlineCompletionItemProvider(
        [{ pattern: "**" }],
        this.completionProvider,
      ),
    );

    // Handle uri events
    this.uriHandler.event((uri) => {
      // Phase 6: intercept the AI Firewall auth callback before any
      // other handler. The web dashboard posts
      // `vscode://ai-firewall.ai-firewall/authCallback?token=...&state=...`
      // after a successful sign-in. The auth service validates the
      // state nonce and stores the token in SecretStorage.
      if (uri.path === "/authCallback") {
        const consumed = this.aiFirewallAuth.handleCallbackUri(uri);
        if (consumed) return;
      }

      const queryParams = new URLSearchParams(uri.query);
      let profileId = queryParams.get("profile_id");
      let orgId = queryParams.get("org_id");

      this.core.invoke("config/refreshProfiles", {
        reason: "VS Code deep link",
        selectOrgId: orgId === "null" ? undefined : (orgId ?? undefined),
        selectProfileId:
          profileId === "null" ? undefined : (profileId ?? undefined),
      });
    });

    // Battery
    this.battery = new Battery();
    context.subscriptions.push(this.battery);
    context.subscriptions.push(monitorBatteryChanges(this.battery));

    // FileSearch
    this.fileSearch = new FileSearch(this.ide);
    registerAllPromptFilesCompletionProviders(
      context,
      this.fileSearch,
      this.ide,
    );

    const quickEdit = new QuickEdit(
      this.verticalDiffManager,
      this.configHandler,
      this.sidebar.webviewProtocol,
      this.ide,
      context,
      this.fileSearch,
    );

    // LLM Log view
    this.consoleView = new ContinueConsoleWebviewViewProvider(
      this.windowId,
      this.extensionContext,
      this.core.llmLogger,
    );

    context.subscriptions.push(
      vscode.window.registerWebviewViewProvider(
        "aiFirewall.aiFirewallConsoleView",
        this.consoleView,
      ),
    );

    // Commands
    registerAllCommands(
      context,
      this.ide,
      context,
      this.sidebar,
      this.consoleView,
      this.configHandler,
      this.verticalDiffManager,
      this.battery,
      quickEdit,
      this.core,
      this.editDecorationManager,
      this.aiFirewallAuth,
    );

    // Disabled due to performance issues
    // registerDebugTracker(this.sidebar.webviewProtocol, this.ide);

    // Listen for file saving - use global file watcher so that changes
    // from outside the window are also caught
    fs.watchFile(getConfigJsonPath(), { interval: 1000 }, async (stats) => {
      if (stats.size === 0) {
        return;
      }
      await this.configHandler.reloadConfig(
        "Global JSON config updated - fs file watch",
      );
    });

    fs.watchFile(
      getConfigYamlPath("vscode"),
      { interval: 1000 },
      async (stats) => {
        if (stats.size === 0) {
          return;
        }
        await this.configHandler.reloadConfig(
          "Global YAML config updated - fs file watch",
        );
      },
    );

    fs.watchFile(getConfigTsPath(), { interval: 1000 }, (stats) => {
      if (stats.size === 0) {
        return;
      }
      void this.configHandler.reloadConfig("config.ts updated - fs file watch");
    });

    // watch global rules directory for changes
    const globalRulesDir = path.join(getAiFirewallGlobalPath(), "rules");
    if (fs.existsSync(globalRulesDir)) {
      fs.watch(globalRulesDir, { recursive: true }, (eventType, filename) => {
        if (filename && filename.endsWith(".md")) {
          void this.configHandler.reloadConfig(
            "Global rules directory updated - fs file watch",
          );
        }
      });
    }

    // Initialize document content cache for tracking pre-edit content
    vscode.workspace.onDidOpenTextDocument((document) => {
      initDocumentContentCache(document);
    });

    // Initialize cache for all currently open documents
    for (const document of vscode.workspace.textDocuments) {
      initDocumentContentCache(document);
    }

    vscode.workspace.onDidChangeTextDocument(async (event) => {
      if (event.contentChanges.length > 0) {
        selectionManager.documentChanged();
      }

      const editInfo = await handleTextDocumentChange(
        event,
        this.configHandler,
        this.ide,
        this.completionProvider,
        getDefinitionsFromLsp,
      );

      if (editInfo) this.core.invoke("files/smallEdit", editInfo);
    });

    vscode.workspace.onDidSaveTextDocument(async (event) => {
      this.core.invoke("files/changed", {
        uris: [event.uri.toString()],
      });
    });

    vscode.workspace.onDidDeleteFiles(async (event) => {
      this.core.invoke("files/deleted", {
        uris: event.files.map((uri) => uri.toString()),
      });
    });

    vscode.workspace.onDidCloseTextDocument(async (event) => {
      clearDocumentContentCache(event.uri.toString());
      this.core.invoke("files/closed", {
        uris: [event.uri.toString()],
      });
    });

    vscode.workspace.onDidCreateFiles(async (event) => {
      this.core.invoke("files/created", {
        uris: event.files.map((uri) => uri.toString()),
      });
    });

    vscode.workspace.onDidChangeWorkspaceFolders(async (event) => {
      const dirs = vscode.workspace.workspaceFolders?.map(
        (folder) => folder.uri,
      );

      this.ideUtils.setWokspaceDirectories(dirs);

      this.core.invoke("index/forceReIndex", {
        dirs: [
          ...event.added.map((folder) => folder.uri.toString()),
          ...event.removed.map((folder) => folder.uri.toString()),
        ],
      });
    });

    // TODO merge this and re-enable https://github.com/ai-firewall/ai-firewall/pull/8364
    // vscode.workspace.onDidOpenTextDocument(async (event) => {
    //   const ast = await getAst(event.fileName, event.getText());
    //   if (ast) {
    //     DocumentHistoryTracker.getInstance().addDocument(
    //       localPathOrUriToPath(event.fileName),
    //       event.getText(),
    //       ast,
    //     );
    //   }
    // });

    // When GitHub sign-in status changes, reload config
    vscode.authentication.onDidChangeSessions(async (e) => {
      const env = await getControlPlaneEnv(this.ide.getIdeSettings());
      if (e.provider.id === env.AUTH_TYPE) {
        void vscode.commands.executeCommand(
          "setContext",
          "aiFirewall.isSignedInToControlPlane",
          true,
        );

        const sessionInfo = await getControlPlaneSessionInfo(true, false);
        void this.core.invoke("didChangeControlPlaneSessionInfo", {
          sessionInfo,
        });
      } else {
        void vscode.commands.executeCommand(
          "setContext",
          "aiFirewall.isSignedInToControlPlane",
          false,
        );

        if (e.provider.id === "github") {
          this.configHandler.reloadConfig("Github sign-in status changed");
        }
      }
    });

    // Listen for editor changes to clean up decorations when editor closes.
    vscode.window.onDidChangeVisibleTextEditors(async () => {
      // If our active editor is no longer visible, clear decorations.
      console.log("deleteChain called from onDidChangeVisibleTextEditors");
      await NextEditProvider.getInstance().deleteChain();
    });

    // Listen for selection changes to hide tooltip when cursor moves.
    vscode.window.onDidChangeTextEditorSelection(async (e) => {
      await selectionManager.handleSelectionChange(e);
    });

    // Refresh index when branch is changed
    void this.ide.getWorkspaceDirs().then((dirs) =>
      dirs.forEach(async (dir) => {
        const repo = await this.ide.getRepo(dir);
        if (repo) {
          repo.state.onDidChange(() => {
            // args passed to this callback are always undefined, so keep track of previous branch
            const currentBranch = repo?.state?.HEAD?.name;
            if (currentBranch) {
              if (this.PREVIOUS_BRANCH_FOR_WORKSPACE_DIR[dir]) {
                if (
                  currentBranch !== this.PREVIOUS_BRANCH_FOR_WORKSPACE_DIR[dir]
                ) {
                  // Trigger refresh of index only in this directory
                  this.core.invoke("index/forceReIndex", { dirs: [dir] });
                }
              }

              this.PREVIOUS_BRANCH_FOR_WORKSPACE_DIR[dir] = currentBranch;
            }
          });
        }
      }),
    );

    // Register a content provider for the readonly virtual documents
    const documentContentProvider = new (class
      implements vscode.TextDocumentContentProvider
    {
      // emitter and its event
      onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
      onDidChange = this.onDidChangeEmitter.event;

      provideTextDocumentContent(uri: vscode.Uri): string {
        return uri.query;
      }
    })();
    context.subscriptions.push(
      vscode.workspace.registerTextDocumentContentProvider(
        VsCodeExtension.continueVirtualDocumentScheme,
        documentContentProvider,
      ),
    );

    const linkProvider = vscode.languages.registerDocumentLinkProvider(
      { language: "yaml" },
      new ConfigYamlDocumentLinkProvider(),
    );
    context.subscriptions.push(linkProvider);

    this.ide.onDidChangeActiveTextEditor((filepath) => {
      void this.core.invoke("files/opened", { uris: [filepath] });
    });

    // initializes openedFileLruCache with files that are already open when the extension is activated
    let initialOpenedFilePaths = this.ideUtils
      .getOpenFiles()
      .map((uri) => uri.toString());
    this.core.invoke("files/opened", { uris: initialOpenedFilePaths });

    // This is how you would enable/disable next edit in the autocomplete menu.
    // See extensions/vscode/src/autocomplete/statusBar.ts.
    vscode.workspace.onDidChangeConfiguration(async (event) => {
      if (event.affectsConfiguration(EXTENSION_NAME)) {
        const settings = await this.ide.getIdeSettings();
        void this.core.invoke("config/ideSettingsUpdate", settings);

        if (event.affectsConfiguration(`${EXTENSION_NAME}.enableNextEdit`)) {
          await this.updateNextEditState(context);
        }
      }
    });
  }

  static continueVirtualDocumentScheme = EXTENSION_NAME;

  // eslint-disable-next-line @typescript-eslint/naming-convention
  private PREVIOUS_BRANCH_FOR_WORKSPACE_DIR: { [dir: string]: string } = {};

  registerCustomContextProvider(contextProvider: IContextProvider) {
    this.configHandler.registerCustomContextProvider(contextProvider);
  }

  public activateNextEdit() {
    this.completionProvider.activateNextEdit();
  }

  public deactivateNextEdit() {
    this.completionProvider.deactivateNextEdit();
  }

  /**
   * Check if the security perimeter has been configured for this workspace.
   * If not, prompt the GUI to show the First Look setup page.
   * This is client-agnostic — it queries the proxy API, not VS Code state.
   */
  private async checkSecurityPerimeter(
    context: vscode.ExtensionContext,
  ): Promise<void> {
    const workspaceId =
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "";
    if (!workspaceId) return;

    // Check if user already dismissed this for this workspace
    const dismissKey = `aiFirewall.perimeterDismissed.${workspaceId}`;
    if (context.globalState.get<boolean>(dismissKey)) return;

    // Wait for proxy to be healthy before checking
    const proxyUrl = this.proxyManager.proxyUrl ?? "http://localhost:8080";
    try {
      const res = await fetch(`${proxyUrl}/api/perimeter/status`);
      if (!res.ok) return;
      const data = (await res.json()) as {
        configured: boolean;
        restricted_count: number;
      };
      if (!data.configured || data.restricted_count === 0) {
        // Delay slightly so the webview has time to initialize
        setTimeout(() => {
          this.sidebar.webviewProtocol.request("showFirstLook", undefined);
        }, 2000);
      }
    } catch {
      // Proxy not ready yet — skip First Look for now
    }
  }
}
