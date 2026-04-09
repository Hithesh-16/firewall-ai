import { Navigate } from "react-router-dom";
import { ROUTES } from "../../util/navigation";

/**
 * Phase 8 — onboarding has moved to the standalone `web/` dashboard.
 *
 * The IDE webview no longer owns the first-run wizard (profile,
 * teams, policy, providers, notifications, review). That entire
 * flow — with 7 steps and persistence to the proxy — lives in
 * `web/src/pages/onboarding/OnboardingRoot.tsx` and is reached via
 * the browser when the user signs in for the first time.
 *
 * If the user somehow routes here inside the IDE webview, silently
 * bounce them to the home (chat) screen — they'll already have a
 * valid token from the IDE's `AI Firewall: Sign In` command by the
 * time they reach the webview, and the proxy will stream the
 * effective config down automatically.
 */
export default function OnboardingPage() {
  return <Navigate to={ROUTES.HOME} replace />;
}
