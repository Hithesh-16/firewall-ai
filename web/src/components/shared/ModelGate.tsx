import { ReactNode, useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";

import { apiClient } from "../../api/client";
import { ENDPOINTS } from "../../api/endpoints";
import { getToken } from "../../utils/storage";
import { ROUTES } from "../../utils/routes";
import { LoadingSpinner } from "../ui/LoadingSpinner";

/**
 * Mandatory-model gate.
 *
 * Wraps every authenticated surface (dashboard, chat, settings
 * pages) so a signed-in user without at least one reachable model
 * is redirected to /setup-model before they can use anything else.
 *
 * Why it lives here and not in the onboarding wizard:
 *
 *   1. Users can skip onboarding via a deep link.
 *   2. Admins can revoke a user's model mid-session (the user
 *      returns to the tab → the gate catches it).
 *   3. A user who signs out and back in without having configured
 *      a model shouldn't bypass the check.
 *
 * Implementation:
 *
 *   - Calls GET /api/me/models on mount (with the stored bearer).
 *   - If response.hasAny === true, render children as normal.
 *   - If hasAny === false, redirect to /setup-model.
 *   - While the call is in flight, render a centred spinner — this
 *     is the same "loading" UX as ProtectedRoute so the page doesn't
 *     flash or layout-shift.
 *   - Pages inside /setup-model do NOT wrap themselves in this
 *     guard (otherwise you get an infinite redirect) — that's the
 *     `bypassPaths` list below.
 *
 * The gate is cheap: /api/me/models is a single DB round-trip and
 * the proxy caches the effective policy for the caller. In practice
 * each authenticated route load adds <5ms.
 */

interface ModelsResponse {
  models: Array<{
    provider: string;
    model: string;
    displayName?: string;
    source: "user" | "org";
  }>;
  availableProviders: Array<{
    providerSlug: string;
    source: "user" | "org";
    baseUrl: string | null;
  }>;
  hasAny: boolean;
  canAddPersonal: boolean;
  hasAssistant: boolean;
}

const BYPASS_PATHS: readonly string[] = [
  ROUTES.SETUP_MODEL,
  ROUTES.SETTINGS_MODELS,
  ROUTES.SETTINGS_ASSISTANT,
  ROUTES.ONBOARDING,
  ROUTES.LOGIN,
  ROUTES.REGISTER,
  ROUTES.FORBIDDEN,
];

function shouldBypass(pathname: string): boolean {
  return BYPASS_PATHS.some((prefix) => pathname === prefix || pathname.startsWith(prefix + "/"));
}

type GateState =
  | { kind: "unchecked" }
  | { kind: "loading" }
  | { kind: "ok" }
  | { kind: "no-model"; info: ModelsResponse }
  | { kind: "error"; message: string };

export function ModelGate({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [state, setState] = useState<GateState>({ kind: "unchecked" });

  useEffect(() => {
    // Skip the check on pages that exist precisely to fix the
    // no-model state (otherwise a user can never reach them).
    if (shouldBypass(location.pathname)) {
      setState({ kind: "ok" });
      return;
    }

    const token = getToken();
    if (!token) {
      // Not signed in — downstream ProtectedRoute / login redirect
      // handles this, we don't need to duplicate the check.
      setState({ kind: "ok" });
      return;
    }

    setState({ kind: "loading" });
    apiClient
      .get<ModelsResponse>(ENDPOINTS.me.modelsList)
      .then((res) => {
        if (res.hasAny) {
          setState({ kind: "ok" });
        } else {
          setState({ kind: "no-model", info: res });
        }
      })
      .catch((err) => {
        // Fail-open on network errors: the chat page will show its
        // own error state. We don't want a flaky /api/me/models
        // call to strand users on /setup-model.
        console.warn(
          "[ModelGate] /api/me/models failed:",
          err instanceof Error ? err.message : err,
        );
        setState({ kind: "ok" });
      });
  }, [location.pathname]);

  if (state.kind === "loading" || state.kind === "unchecked") {
    return (
      <div className="bg-background flex h-screen items-center justify-center">
        <LoadingSpinner />
      </div>
    );
  }

  if (state.kind === "no-model") {
    return <Navigate to={ROUTES.SETTINGS_MODELS} replace />;
  }

  return <>{children}</>;
}

export default ModelGate;
