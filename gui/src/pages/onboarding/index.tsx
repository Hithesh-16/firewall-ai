import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ROUTES } from "../../util/navigation";
import { useProxyApi } from "../../hooks/useProxyApi";

type SetupChoice = "individual" | "team" | "organization" | null;

interface OrgResponse {
  id: number;
  name: string;
  slug: string;
}

function ShieldLogo() {
  return (
    <svg
      width="40"
      height="40"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      className="text-primary"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 00-3-3.87" />
      <path d="M16 3.13a4 4 0 010 7.75" />
    </svg>
  );
}

function BuildingIcon() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="2" width="16" height="20" rx="2" ry="2" />
      <path d="M9 22v-4h6v4" />
      <path d="M8 6h.01" />
      <path d="M16 6h.01" />
      <path d="M12 6h.01" />
      <path d="M12 10h.01" />
      <path d="M12 14h.01" />
      <path d="M16 10h.01" />
      <path d="M16 14h.01" />
      <path d="M8 10h.01" />
      <path d="M8 14h.01" />
    </svg>
  );
}

const SETUP_OPTIONS = [
  {
    id: "individual" as const,
    icon: UserIcon,
    title: "Individual",
    subtitle: "Just me, working solo",
    features: [
      "Full security scanning",
      "All LLM providers",
      "Personal file restrictions",
      "Usage tracking",
    ],
  },
  {
    id: "team" as const,
    icon: UsersIcon,
    title: "Team",
    subtitle: "A small team sharing one workspace",
    features: [
      "Everything in Individual",
      "Invite team members",
      "Shared security policies",
      "Per-member usage analytics",
    ],
    popular: true,
  },
  {
    id: "organization" as const,
    icon: BuildingIcon,
    title: "Organization",
    subtitle: "Multiple teams with separate policies",
    features: [
      "Everything in Team",
      "Multiple teams with leads",
      "Per-team file restrictions",
      "Role-based access control",
    ],
  },
];

function OnboardingPage() {
  const navigate = useNavigate();
  const api = useProxyApi();
  const [choice, setChoice] = useState<SetupChoice>(null);
  const [step, setStep] = useState<"choose" | "setup">("choose");
  const [orgName, setOrgName] = useState("");
  const [orgSlug, setOrgSlug] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSlugGeneration = useCallback((name: string) => {
    setOrgName(name);
    setOrgSlug(
      name
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, "")
        .replace(/\s+/g, "-")
        .slice(0, 50)
    );
  }, []);

  const handleContinue = useCallback(() => {
    if (!choice) return;
    if (choice === "individual") {
      // For individual, auto-generate org name from user context
      setOrgName("My Workspace");
      setOrgSlug("personal");
    }
    setStep("setup");
  }, [choice]);

  const handleFinish = useCallback(async () => {
    if (!orgName.trim() || !orgSlug.trim()) return;
    setSaving(true);
    setError(null);

    try {
      const org = await api.post<OrgResponse>("/api/orgs", {
        name: orgName.trim(),
        slug: orgSlug.trim(),
      });

      // Assign current user to the org
      const meRes = await api.get<{ id: number }>("/api/auth/me");
      await api.post(`/api/orgs/${org.id}/members`, { userId: meRes.id });

      navigate(ROUTES.SECURITY);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Failed to create workspace";
      setError(message);
    } finally {
      setSaving(false);
    }
  }, [orgName, orgSlug, api, navigate]);

  if (step === "setup") {
    return (
      <div className="flex flex-col items-center justify-center h-full p-6">
        <div className="w-full max-w-md space-y-6">
          {/* Back button */}
          <button
            onClick={() => setStep("choose")}
            className="flex items-center gap-1.5 text-xs text-description hover:text-foreground transition-colors focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:outline-none"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 12H5" /><path d="m12 19-7-7 7-7" />
            </svg>
            Back
          </button>

          {/* Header */}
          <div className="text-center space-y-2">
            <div className="mx-auto w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center">
              <ShieldLogo />
            </div>
            <h1 className="text-xl font-bold text-foreground">
              {choice === "individual" ? "Set up your workspace" : choice === "team" ? "Name your team workspace" : "Name your organization"}
            </h1>
            <p className="text-sm text-description">
              {choice === "individual"
                ? "We'll create a personal workspace for you."
                : "You can invite members and create teams after setup."}
            </p>
          </div>

          {/* Form */}
          <div className="space-y-4">
            {choice !== "individual" && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-description uppercase tracking-wider">
                  {choice === "team" ? "Team name" : "Organization name"}
                </label>
                <input
                  type="text"
                  value={orgName}
                  onChange={(e) => handleSlugGeneration(e.target.value)}
                  placeholder={choice === "team" ? "e.g. Frontend Team" : "e.g. Acme Corp"}
                  className="w-full px-3 py-2.5 rounded-lg bg-input text-input-foreground border border-border placeholder:text-input-placeholder focus:border-border-focus focus:ring-2 focus:ring-border-focus/20 focus:outline-none text-sm transition-all"
                  autoFocus
                />
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-description uppercase tracking-wider">
                URL slug
              </label>
              <div className="flex items-center gap-0 rounded-lg border border-border overflow-hidden bg-input">
                <span className="px-3 py-2.5 text-xs text-description bg-secondary border-r border-border">
                  firewall/
                </span>
                <input
                  type="text"
                  value={orgSlug}
                  onChange={(e) => setOrgSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                  placeholder="my-workspace"
                  className="flex-1 px-3 py-2.5 bg-transparent text-input-foreground placeholder:text-input-placeholder focus:outline-none text-sm"
                />
              </div>
            </div>
          </div>

          {error && (
            <div className="bg-error/5 border border-error/30 rounded-lg px-3 py-2">
              <p className="text-xs text-error">{error}</p>
            </div>
          )}

          {/* Actions */}
          <div className="space-y-3 pt-2">
            <button
              onClick={handleFinish}
              disabled={saving || !orgSlug.trim()}
              className="w-full py-3 rounded-xl bg-primary hover:bg-primary-hover text-primary-foreground text-sm font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:outline-none"
            >
              {saving ? (
                <span className="flex items-center justify-center gap-2">
                  <span className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                  Creating...
                </span>
              ) : (
                "Create & Continue"
              )}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center h-full p-6 overflow-y-auto">
      <div className="w-full max-w-2xl space-y-8">
        {/* Header */}
        <div className="text-center space-y-3">
          <div className="mx-auto w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
            <ShieldLogo />
          </div>
          <h1 className="text-2xl font-bold text-foreground">
            Welcome to AI Firewall
          </h1>
          <p className="text-sm text-description max-w-md mx-auto leading-relaxed">
            Every AI request scanned. Every secret caught. Every prompt secured.
            Choose how you want to get started.
          </p>
        </div>

        {/* Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {SETUP_OPTIONS.map((option) => {
            const isSelected = choice === option.id;
            const Icon = option.icon;

            return (
              <button
                key={option.id}
                onClick={() => setChoice(option.id)}
                className={`relative flex flex-col items-start text-left p-5 rounded-xl border-2 transition-all focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:outline-none ${
                  isSelected
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-primary/30 hover:bg-secondary"
                }`}
              >
                {option.popular && (
                  <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 text-[10px] font-semibold uppercase tracking-wider bg-primary text-primary-foreground px-2.5 py-0.5 rounded-full">
                    Popular
                  </span>
                )}

                <div className={`w-11 h-11 rounded-xl flex items-center justify-center mb-3 transition-colors ${
                  isSelected ? "bg-primary/15 text-primary" : "bg-secondary text-description"
                }`}>
                  <Icon />
                </div>

                <h3 className="text-sm font-semibold text-foreground mb-0.5">
                  {option.title}
                </h3>
                <p className="text-xs text-description mb-3">
                  {option.subtitle}
                </p>

                <ul className="space-y-1.5 w-full">
                  {option.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2 text-xs text-description">
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className={`mt-0.5 flex-shrink-0 ${isSelected ? "text-success" : "text-description"}`}
                      >
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      {feature}
                    </li>
                  ))}
                </ul>

                {/* Selection indicator */}
                <div className={`absolute top-4 right-4 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${
                  isSelected ? "border-primary bg-primary" : "border-border"
                }`}>
                  {isSelected && (
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" className="text-primary-foreground">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* Continue button */}
        <div className="flex justify-center">
          <button
            onClick={handleContinue}
            disabled={!choice}
            className="px-8 py-3 rounded-xl bg-primary hover:bg-primary-hover text-primary-foreground text-sm font-semibold transition-all disabled:opacity-30 disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:outline-none"
          >
            Continue
          </button>
        </div>

        {/* Footer note */}
        <p className="text-center text-xs text-description">
          You can always upgrade later. Add teams, invite members, or set org-wide policies at any time.
        </p>
      </div>
    </div>
  );
}

export default OnboardingPage;
