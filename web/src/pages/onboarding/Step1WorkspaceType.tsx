import { useState } from "react";
import {
  UserIcon,
  UsersIcon,
  BuildingOfficeIcon,
  CheckCircleIcon,
} from "@heroicons/react/24/outline";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import {
  onboardingActions,
  type WorkspaceType,
} from "../../store/slices/onboardingSlice";
import { apiClient } from "../../api/client";
import { setCredentials } from "../../store/slices/authSlice";
import { getToken } from "../../utils/storage";
import { cn } from "../../utils/cn";
import { WizardCard, WizardError, WizardNav, slugify } from "./_shared";

interface OrgResponse {
  id: number;
  name: string;
  slug: string;
}

const OPTIONS: {
  id: WorkspaceType;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle: string;
  features: string[];
  popular?: boolean;
}[] = [
  {
    id: "individual",
    icon: UserIcon,
    title: "Individual",
    subtitle: "Just me, working solo",
    features: [
      "Auto-admin of a personal workspace",
      "All scanners + policy controls",
      "Skip team setup",
    ],
  },
  {
    id: "team",
    icon: UsersIcon,
    title: "Team",
    subtitle: "A small team sharing one workspace",
    features: [
      "Invite teammates by email",
      "Shared policies + providers",
      "Per-member usage analytics",
    ],
    popular: true,
  },
  {
    id: "organization",
    icon: BuildingOfficeIcon,
    title: "Organization",
    subtitle: "Multiple teams with separate policies",
    features: [
      "Multiple teams + leads",
      "Per-team file restrictions",
      "Role-based access control",
    ],
  },
];

export function Step1WorkspaceType({ onNext }: { onNext: () => void }) {
  const dispatch = useAppDispatch();
  const wizard = useAppSelector((s) => s.onboarding);
  const user = useAppSelector((s) => s.auth.user);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const choice = wizard.workspaceType;

  async function handleContinue() {
    if (!choice) return;
    setError(null);
    setBusy(true);

    try {
      // Names default to a sensible value the user can edit in Step 2.
      const fallbackName =
        choice === "individual"
          ? `${user?.name || "My"} Workspace`
          : choice === "team"
            ? "My Team"
            : "My Organization";

      const orgName = wizard.org.name || fallbackName;
      const orgSlug = wizard.org.slug || slugify(orgName) || `org-${Date.now()}`;

      let orgId = wizard.org.id;
      if (!orgId) {
        // Create the org server-side now so the rest of the wizard
        // can attach things (teams, providers, policies) to it.
        const created = await apiClient.post<OrgResponse>("/api/orgs", {
          name: orgName,
          slug: orgSlug,
        });
        orgId = created.id;

        // Bind the current user to the new org so subsequent calls
        // pass org-membership checks.
        await apiClient
          .post(`/api/orgs/${orgId}/members`, { userId: Number(user?.id) })
          .catch(() => {
            /* user might already be assigned — ignore */
          });

        // Refresh /me so the orgId lands in Redux for the rest of the
        // wizard, and the auth gate stops considering us "no org".
        const me = await apiClient.get<{ user: typeof user }>("/api/auth/me");
        const token = getToken();
        if (me.user && token) {
          dispatch(setCredentials({ user: me.user, token }));
        }
      }

      dispatch(
        onboardingActions.setOrg({
          id: orgId,
          name: orgName,
          slug: orgSlug,
        }),
      );
      onNext();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create workspace",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <WizardCard
      title="How will you use AI Firewall?"
      subtitle="Pick the option that best matches your team. You can grow into a different one later."
    >
      <div className="grid gap-3 sm:grid-cols-3">
        {OPTIONS.map(({ id, icon: Icon, title, subtitle, features, popular }) => {
          const selected = choice === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() =>
                dispatch(onboardingActions.setWorkspaceType(id))
              }
              className={cn(
                "relative flex flex-col items-start gap-3 rounded-xl border bg-slate-950/40 p-4 text-left transition-all",
                "hover:-translate-y-0.5 hover:bg-slate-900/60",
                selected
                  ? "border-emerald-500/60 shadow-[0_0_25px_rgba(16,185,129,0.25)]"
                  : "border-slate-800 hover:border-emerald-500/30",
              )}
            >
              {popular && (
                <span className="absolute right-3 top-3 rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-300">
                  Popular
                </span>
              )}
              <div
                className={cn(
                  "flex h-10 w-10 items-center justify-center rounded-lg",
                  selected
                    ? "bg-gradient-to-br from-emerald-500/30 to-cyan-500/30 text-emerald-300"
                    : "bg-slate-800/80 text-slate-400",
                )}
              >
                <Icon className="h-5 w-5" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-white">{title}</h3>
                <p className="mt-0.5 text-xs text-slate-400">{subtitle}</p>
              </div>
              <ul className="space-y-1 text-xs text-slate-400">
                {features.map((f) => (
                  <li key={f} className="flex items-start gap-1.5">
                    <CheckCircleIcon
                      className={cn(
                        "mt-0.5 h-3.5 w-3.5 shrink-0",
                        selected ? "text-emerald-400" : "text-slate-600",
                      )}
                    />
                    {f}
                  </li>
                ))}
              </ul>
            </button>
          );
        })}
      </div>

      <WizardError message={error} />

      <WizardNav
        onNext={handleContinue}
        nextDisabled={!choice}
        busy={busy}
        hideBack
      />
    </WizardCard>
  );
}
