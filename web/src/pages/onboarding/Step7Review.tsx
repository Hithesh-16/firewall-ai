import { useState } from "react";
import { CheckCircleIcon, ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import { apiClient } from "../../api/client";
import { ENDPOINTS } from "../../api/endpoints";
import { setCredentials } from "../../store/slices/authSlice";
import { getToken } from "../../utils/storage";
import type { User } from "../../api/types";
import { WizardCard, WizardError, WizardNav } from "./_shared";

/**
 * Step 7 — Review & finish.
 *
 * Summary card showing every choice from Steps 1–6, plus the big
 * "Finish" button that:
 *   1. Marks users.onboarding_complete = 1 via
 *      POST /api/users/me/onboarding/complete
 *   2. Refreshes the auth slice with the new user (so AppShell stops
 *      redirecting to /onboarding).
 *   3. Calls POST /api/auth/handoff (best-effort) so the shared auth
 *      file is refreshed with the now-complete onboarding flag.
 *   4. Delegates to onFinish() which navigates to /dashboard.
 */
export function Step7Review({ onFinish, onBack }: { onFinish: () => void; onBack: () => void }) {
  const dispatch = useAppDispatch();
  const wizard = useAppSelector((s) => s.onboarding);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isIndividual = wizard.workspaceType === "individual";
  const enabledScanners = Object.entries(wizard.policy.scanners).filter(
    ([, v]) => v.enabled,
  ).length;

  const summary: { label: string; value: string; warn?: boolean }[] = [
    {
      label: "Workspace type",
      value:
        wizard.workspaceType === "individual"
          ? "Individual"
          : wizard.workspaceType === "team"
            ? "Team"
            : "Organization",
    },
    {
      label: "Workspace name",
      value: wizard.org.name || "—",
    },
    {
      label: "Scanners enabled",
      value: `${enabledScanners} of 5`,
    },
    {
      label: "MCP gateway",
      value: wizard.policy.mcpGateway ? "On" : "Off",
    },
    {
      label: "Providers added",
      value: String(wizard.providers.length),
      warn: wizard.providers.length === 0,
    },
  ];

  if (!isIndividual) {
    summary.splice(3, 0, {
      label: "Teams created",
      value: String(wizard.teams.length),
    });
    summary.splice(4, 0, {
      label: "Members invited",
      value: String(wizard.invites.length),
    });
  }

  async function handleFinish() {
    setError(null);
    setBusy(true);
    try {
      // Step 1: flip onboarding_complete on the server
      const resp = await apiClient.post<{
        ok: boolean;
        user: User;
      }>(ENDPOINTS.me.onboardingComplete);

      // Step 2: refresh Redux auth state with the new user
      const token = getToken();
      if (resp.user && token) {
        dispatch(setCredentials({ user: resp.user, token }));
      }

      // Step 3: re-run handoff so the shared file picks up the new flag
      try {
        await apiClient.post(ENDPOINTS.auth.handoff, { source: "web" });
      } catch {
        /* best-effort */
      }

      onFinish();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to finish setup");
    } finally {
      setBusy(false);
    }
  }

  return (
    <WizardCard
      title="Review and finish"
      subtitle="Here's what we'll set up for you. You can change any of this later from Settings."
    >
      <dl className="divide-y divide-slate-800 rounded-xl border border-slate-800 bg-slate-950/40">
        {summary.map((row) => (
          <div key={row.label} className="flex items-center justify-between px-4 py-3">
            <dt className="text-sm text-slate-400">{row.label}</dt>
            <dd
              className={`flex items-center gap-2 text-sm font-medium ${
                row.warn ? "text-amber-300" : "text-slate-100"
              }`}
            >
              {row.warn ? (
                <ExclamationTriangleIcon className="h-4 w-4" />
              ) : (
                <CheckCircleIcon className="h-4 w-4 text-emerald-400" />
              )}
              {row.value}
            </dd>
          </div>
        ))}
      </dl>

      {wizard.providers.length === 0 && (
        <p className="mt-3 text-xs text-amber-400/80">
          You haven't added any LLM providers yet. The chat won't work until you add one — we'll
          remind you on the dashboard.
        </p>
      )}

      <WizardError message={error} />

      <WizardNav onBack={onBack} onNext={handleFinish} nextLabel="Finish setup" busy={busy} />
    </WizardCard>
  );
}
