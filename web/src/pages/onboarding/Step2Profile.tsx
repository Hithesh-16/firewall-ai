import { useState } from "react";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import { onboardingActions } from "../../store/slices/onboardingSlice";
import { apiClient } from "../../api/client";
import { setCredentials } from "../../store/slices/authSlice";
import { getToken } from "../../utils/storage";
import type { User } from "../../api/types";
import { WizardCard, WizardError, WizardNav, slugify } from "./_shared";

const COMMON_TIMEZONES = [
  "America/Los_Angeles",
  "America/New_York",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Kolkata",
  "Asia/Tokyo",
  "Australia/Sydney",
];

function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "";
  }
}

export function Step2Profile({
  onNext,
  onBack,
}: {
  onNext: () => void;
  onBack: () => void;
}) {
  const dispatch = useAppDispatch();
  const wizard = useAppSelector((s) => s.onboarding);
  const user = useAppSelector((s) => s.auth.user);

  const [name, setName] = useState(wizard.profile.name || user?.name || "");
  const [orgName, setOrgName] = useState(wizard.org.name);
  const [orgSlug, setOrgSlug] = useState(wizard.org.slug);
  const [industry, setIndustry] = useState(wizard.profile.industry || "");
  const [timezone, setTimezone] = useState(
    wizard.profile.timezone || detectTimezone(),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isIndividual = wizard.workspaceType === "individual";

  async function handleContinue() {
    if (!name.trim()) {
      setError("Please enter your name.");
      return;
    }
    if (!orgName.trim()) {
      setError("Please enter a workspace name.");
      return;
    }
    setError(null);
    setBusy(true);

    try {
      // 1. Update user display name + timezone in one PUT.
      //    Both fields are optional on the backend — we always send
      //    whatever the form holds so the user never has to save twice.
      const updated = await apiClient.put<{ user: User }>("/api/users/me", {
        name: name.trim(),
        timezone: timezone.trim() || null,
      });
      const token = getToken();
      if (updated.user && token) {
        dispatch(setCredentials({ user: updated.user, token }));
      }

      // 2. Rename the org (if user changed anything) + attach the
      //    industry. Every PUT includes whatever the form holds so
      //    typing "Fintech" in the Industry field actually lands in
      //    the DB on the same click.
      if (wizard.org.id) {
        const nextSlug = orgSlug.trim() || slugify(orgName);
        const nameChanged = orgName.trim() !== wizard.org.name;
        const slugChanged = nextSlug !== wizard.org.slug;
        const industryChanged = industry.trim() !== "";
        if (nameChanged || slugChanged || industryChanged) {
          await apiClient.put(`/api/orgs/${wizard.org.id}`, {
            name: orgName.trim(),
            slug: nextSlug,
            industry: industry.trim() || null,
          });
        }
      }

      dispatch(
        onboardingActions.setProfile({
          name: name.trim(),
          industry: industry.trim() || undefined,
          timezone: timezone.trim() || undefined,
        }),
      );
      dispatch(
        onboardingActions.setOrg({
          name: orgName.trim(),
          slug: orgSlug.trim() || slugify(orgName),
        }),
      );

      onNext();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save profile");
    } finally {
      setBusy(false);
    }
  }

  return (
    <WizardCard
      title="Tell us about yourself"
      subtitle="A bit of context to personalise your workspace."
    >
      <div className="space-y-4">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-slate-200">
            Your name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Jane Doe"
            className="w-full rounded-lg border border-slate-700 bg-slate-950/60 px-4 py-3 text-slate-100 placeholder:text-slate-500 focus:border-emerald-500/60 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-200">
              {isIndividual
                ? "Workspace name"
                : wizard.workspaceType === "team"
                  ? "Team name"
                  : "Organization name"}
            </label>
            <input
              type="text"
              value={orgName}
              onChange={(e) => {
                setOrgName(e.target.value);
                if (
                  !orgSlug ||
                  orgSlug === slugify(wizard.org.name) ||
                  orgSlug === wizard.org.slug
                ) {
                  setOrgSlug(slugify(e.target.value));
                }
              }}
              placeholder="Acme Engineering"
              className="w-full rounded-lg border border-slate-700 bg-slate-950/60 px-4 py-3 text-slate-100 placeholder:text-slate-500 focus:border-emerald-500/60 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-200">
              URL slug
            </label>
            <div className="flex items-center overflow-hidden rounded-lg border border-slate-700 bg-slate-950/60 focus-within:border-emerald-500/60 focus-within:ring-2 focus-within:ring-emerald-500/20">
              <span className="border-r border-slate-700 bg-slate-900/60 px-3 py-3 text-xs text-slate-500">
                firewall/
              </span>
              <input
                type="text"
                value={orgSlug}
                onChange={(e) =>
                  setOrgSlug(
                    e.target.value
                      .toLowerCase()
                      .replace(/[^a-z0-9-]/g, ""),
                  )
                }
                placeholder="my-workspace"
                className="flex-1 bg-transparent px-3 py-3 text-slate-100 placeholder:text-slate-500 focus:outline-none"
              />
            </div>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-200">
              Industry <span className="text-slate-500">(optional)</span>
            </label>
            <input
              type="text"
              value={industry}
              onChange={(e) => setIndustry(e.target.value)}
              placeholder="Fintech, Health, ..."
              className="w-full rounded-lg border border-slate-700 bg-slate-950/60 px-4 py-3 text-slate-100 placeholder:text-slate-500 focus:border-emerald-500/60 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-200">
              Timezone
            </label>
            <select
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950/60 px-4 py-3 text-slate-100 focus:border-emerald-500/60 focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
            >
              {!COMMON_TIMEZONES.includes(timezone) && timezone && (
                <option value={timezone}>{timezone}</option>
              )}
              {COMMON_TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <WizardError message={error} />
      <WizardNav onBack={onBack} onNext={handleContinue} busy={busy} />
    </WizardCard>
  );
}
