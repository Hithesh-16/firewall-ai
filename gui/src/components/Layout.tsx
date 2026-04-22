import { OnboardingModes } from "core/protocol/core";
import { useContext, useEffect, useRef, useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import styled from "styled-components";
import { CustomScrollbarDiv } from ".";
import { AuthProvider } from "../context/Auth";
import { IdeMessengerContext } from "../context/IdeMessenger";
import { LocalStorageProvider } from "../context/LocalStorage";
import TelemetryProviders from "../hooks/TelemetryProviders";
import { useWebviewListener } from "../hooks/useWebviewListener";
import { useAppDispatch, useAppSelector } from "../redux/hooks";
import { EMPTY_CONFIG, updateConfig } from "../redux/slices/configSlice";
import { setCodeToEdit } from "../redux/slices/editState";
import {
  setOrganizations,
  setSelectedOrgId,
  setSelectedProfile,
} from "../redux/slices/profilesSlice";
import { setDialogMessage, setShowDialog } from "../redux/slices/uiSlice";
import { enterEdit, exitEdit } from "../redux/thunks/edit";
import { saveCurrentSession } from "../redux/thunks/session";
import { fontSize, isMetaEquivalentKeyPressed } from "../util";
import { ROUTES } from "../util/navigation";
import { FatalErrorIndicator } from "./config/FatalErrorNotice";
import TextDialog from "./dialogs";
import { GenerateRuleDialog } from "./GenerateRuleDialog";
import { useMainEditor } from "./mainInput/TipTapEditor";
import {
  isNewUserOnboarding,
  OnboardingCard,
  useOnboardingCard,
} from "./OnboardingCard";
import OSRContextMenu from "./OSRContextMenu";
import PostHogPageView from "./PosthogPageView";

const LayoutTopDiv = styled(CustomScrollbarDiv)`
  height: 100%;
  position: relative;
  overflow-x: hidden;
`;

const GridDiv = styled.div`
  display: grid;
  grid-template-rows: 1fr auto;
  height: 100vh;
  overflow-x: visible;
`;

const Layout = () => {
  const [showStagingIndicator, setShowStagingIndicator] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useAppDispatch();
  const onboardingCard = useOnboardingCard();
  const ideMessenger = useContext(IdeMessengerContext);

  // Auth is now handled by the host IDE's AiFirewallAuthService
  // (VS Code / JetBrains). The shared auth file at
  // ~/.ai-firewall/auth.json is the source of truth — not the
  // webview's localStorage. The old localStorage("afw_token")
  // check was redirecting to login even when the user was already
  // signed in via `cn login` or the web dashboard. Removed.
  //
  // If the user needs to sign in, they use:
  //   - The login page buttons (Sign In / Sign Out)
  //   - Command Palette → "AI Firewall: Sign In"
  //   - CLI: `cn login`

  const { mainEditor } = useMainEditor();
  const dialogMessage = useAppSelector((state) => state.ui.dialogMessage);

  const showDialog = useAppSelector((state) => state.ui.showDialog);
  const isInEdit = useAppSelector((store) => store.session.isInEdit);
  const isHome =
    location.pathname === ROUTES.HOME ||
    location.pathname === ROUTES.HOME_INDEX;

  useEffect(() => {
    (async () => {
      const response = await ideMessenger.request(
        "controlPlane/getEnvironment",
        undefined,
      );
      response.status === "success" &&
        setShowStagingIndicator(response.content.AUTH_TYPE.includes("staging"));
    })();
  }, []);

  useWebviewListener(
    "newSession",
    async () => {
      navigate(ROUTES.HOME);
      if (isInEdit) {
        await dispatch(exitEdit({}));
      } else {
        await dispatch(
          saveCurrentSession({
            openNewSession: true,
            generateTitle: true,
          }),
        );
      }
    },
    [isInEdit],
  );

  // ── AI Firewall sign-in gate ───────────────────────────────────────
  //
  // Listen for auth-state pushes from the extension host
  // (`AiFirewallAuthService.onDidChangeAuth` → `aiFirewall/authState`)
  // and also poll once on mount because push events sent before the
  // webview finished booting are dropped by `postMessage`.
  //
  // When the signed-in user changes (including signed-in → signed-out
  // and account A → account B), we:
  //   1. End the current chat session so the previous user's messages
  //      disappear from the UI (otherwise User B sees User A's chat).
  //   2. Navigate to `ROUTES.LOGIN` on sign-out so the webview renders
  //      the sign-in card instead of an empty chat that can't actually
  //      talk to any provider.
  //
  // The previous email is tracked in a ref so we don't dispatch a
  // `newSession` on every re-render — only on actual identity change.
  const lastAuthKeyRef = useRef<string | null>(null);

  const reactToAuthChange = async (
    signedIn: boolean,
    email: string | undefined,
  ) => {
    const key = signedIn ? `in:${email ?? ""}` : "out";
    const prev = lastAuthKeyRef.current;
    lastAuthKeyRef.current = key;

    // First observation on mount — don't clear anything, just sync.
    if (prev === null) {
      if (!signedIn) {
        navigate(ROUTES.LOGIN);
      }
      return;
    }

    if (prev === key) return;

    // Identity actually changed — drop the in-progress chat so it
    // isn't visible to the next user (or to the "no user" state).
    // Race the cleanup against a 500 ms budget: the save-session
    // thunk can stall if the control plane is slow (especially after
    // a sign-out where the token has just been revoked), and we'd
    // rather flicker the chat away on the way out than leave the
    // user stranded on a Layout that never navigates. The sync
    // fallback resolves immediately if the thunk wins, or aborts the
    // await so the navigate still fires.
    const cleanup = (async () => {
      try {
        if (isInEdit) {
          await dispatch(exitEdit({}));
        } else {
          await dispatch(
            saveCurrentSession({
              openNewSession: true,
              generateTitle: false,
            }),
          );
        }
      } catch {
        /* non-fatal */
      }
    })();
    const budget = new Promise<void>((resolve) => setTimeout(resolve, 500));
    await Promise.race([cleanup, budget]);

    // Clear every slice that redux-persist rehydrated from the
    // previous user's session. Three slices carry user-specific
    // data that would otherwise survive a sign-out:
    //
    //   1. `profiles`   — orgs list + selectedProfileId / selectedOrgId.
    //   2. `config`     — the full BrowserSerializedContinueConfig,
    //                     including `modelsByRole` + `selectedModelByRole`.
    //                     This is what the model dropdown actually
    //                     reads (see `ModelSelect.tsx` → `state.config`),
    //                     so without resetting it the picker keeps
    //                     showing User A's models until Continue core's
    //                     next `configUpdate` event fires — which can
    //                     be seconds later and is what the user was
    //                     seeing as "stale previous-user models".
    //
    // We reset `config` to `EMPTY_CONFIG` (not undefined) so
    // components that read `state.config.config.modelsByRole.*`
    // don't crash on the intermediate empty state — the
    // extension's next `configUpdate` push will repopulate within
    // a tick.
    dispatch(setOrganizations([]));
    dispatch(setSelectedOrgId(null));
    dispatch(setSelectedProfile(null));
    dispatch(updateConfig(EMPTY_CONFIG));

    navigate(signedIn ? ROUTES.HOME : ROUTES.LOGIN);
  };

  useWebviewListener(
    "aiFirewall/authState",
    async (data) => {
      await reactToAuthChange(data.signedIn, data.email);
    },
    [isInEdit],
  );

  useEffect(() => {
    (async () => {
      try {
        const response = await ideMessenger.request(
          "aiFirewall/getAuthState",
          undefined,
        );
        if (response.status === "success") {
          await reactToAuthChange(
            response.content.signedIn,
            response.content.email,
          );
        }
      } catch {
        /* extension host may not have the handler (older build) —
           fall through to the default "show chat" behavior */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useWebviewListener(
    "isFirewallInputFocused",
    async () => {
      return false;
    },
    [isHome],
    isHome,
  );

  useWebviewListener(
    "focusContinueInputWithNewSession",
    async () => {
      navigate(ROUTES.HOME);
      if (isInEdit) {
        await dispatch(
          exitEdit({
            openNewSession: true,
          }),
        );
      } else {
        await dispatch(
          saveCurrentSession({
            openNewSession: true,
            generateTitle: true,
          }),
        );
      }
    },
    [isHome, isInEdit],
    isHome,
  );

  useWebviewListener(
    "addModel",
    async () => {
      navigate("/models");
    },
    [navigate],
  );

  useWebviewListener(
    "navigateTo",
    async (data) => {
      if (data.toggle && location.pathname === data.path) {
        navigate("/");
      } else {
        navigate(data.path);
      }
    },
    [location, navigate],
  );

  useWebviewListener(
    "setupLocalConfig",
    async () => {
      onboardingCard.open(OnboardingModes.LOCAL);
    },
    [],
  );

  useWebviewListener(
    "freeTrialExceeded",
    async () => {
      dispatch(setShowDialog(true));
      onboardingCard.setActiveTab(OnboardingModes.MODELS_ADD_ON);
      dispatch(
        setDialogMessage(
          <div className="flex-1">
            <OnboardingCard isDialog />
          </div>,
        ),
      );
    },
    [],
  );

  useWebviewListener(
    "setupApiKey",
    async () => {
      onboardingCard.open(OnboardingModes.API_KEY);
    },
    [],
  );

  useWebviewListener(
    "focusEdit",
    async () => {
      await ideMessenger.request("edit/addCurrentSelection", undefined);
      await dispatch(enterEdit({ editorContent: mainEditor?.getJSON() }));
      mainEditor?.commands.focus();
    },
    [ideMessenger, mainEditor],
  );

  useWebviewListener(
    "setCodeToEdit",
    async (payload) => {
      dispatch(
        setCodeToEdit({
          codeToEdit: payload,
        }),
      );
    },
    [],
  );

  useWebviewListener(
    "exitEditMode",
    async () => {
      await dispatch(exitEdit({}));
    },
    [],
  );

  useWebviewListener(
    "generateRule",
    async () => {
      dispatch(setShowDialog(true));
      dispatch(setDialogMessage(<GenerateRuleDialog />));
    },
    [],
  );

  useEffect(() => {
    const handleKeyDown = (event: any) => {
      if (isMetaEquivalentKeyPressed(event) && event.code === "KeyC") {
        const selection = window.getSelection()?.toString();
        if (selection) {
          setTimeout(() => {
            void navigator.clipboard.writeText(selection);
          }, 100);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  useEffect(() => {
    if (isNewUserOnboarding() && isHome) {
      onboardingCard.open();
    }
  }, [isHome]);

  const mainContent = (
    <LayoutTopDiv>
      {showStagingIndicator && (
        <span
          title="Staging environment"
          className="absolute right-0 mx-1.5 h-1.5 w-1.5 rounded-full"
          style={{
            backgroundColor: "var(--vscode-list-warningForeground)",
          }}
        />
      )}
      <OSRContextMenu />
      <div
        style={{
          scrollbarGutter: "stable both-edges",
          minHeight: "100%",
          display: "grid",
          gridTemplateRows: "1fr auto",
        }}
      >
        <TextDialog
          showDialog={showDialog}
          onEnter={() => {
            dispatch(setShowDialog(false));
          }}
          onClose={() => {
            dispatch(setShowDialog(false));
          }}
          message={dialogMessage}
        />

        <GridDiv>
          <PostHogPageView />
          <Outlet />
          {/* The fatal error for chat is shown below input */}
          {!isHome && <FatalErrorIndicator />}
        </GridDiv>
      </div>
      <div style={{ fontSize: fontSize(-4) }} id="tooltip-portal-div" />
    </LayoutTopDiv>
  );

  return (
    <LocalStorageProvider>
      <AuthProvider>
        <TelemetryProviders>{mainContent}</TelemetryProviders>
      </AuthProvider>
    </LocalStorageProvider>
  );
};

export default Layout;
