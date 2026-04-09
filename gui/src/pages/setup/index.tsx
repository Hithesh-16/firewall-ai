import { Navigate } from "react-router-dom";
import { ROUTES } from "../../util/navigation";

/**
 * Phase 8 — the old `OnboardingWizard` lived here and ran a mini
 * first-run experience inside the IDE. Onboarding has moved to the
 * standalone web dashboard (`web/src/pages/onboarding/OnboardingRoot.tsx`)
 * which is the only place the 7-step flow exists. Inside the IDE, we
 * just redirect to chat — the proxy is the source of truth for
 * effective config and it's already authoritative by the time the
 * webview mounts.
 */
function SetupWizardPage() {
  return <Navigate to={ROUTES.HOME} replace />;
}

export default SetupWizardPage;
