import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import { onboardingActions } from "../../store/slices/onboardingSlice";
import AnimatedBackdrop from "../../components/brand/AnimatedBackdrop";
import BrandShield from "../../components/brand/BrandShield";
import { LoadingSpinner } from "../../components/ui/LoadingSpinner";
import { apiClient } from "../../api/client";
import { ROUTES } from "../../utils/routes";
import { Step1WorkspaceType } from "./Step1WorkspaceType";
import { Step2Profile } from "./Step2Profile";
import { Step3Teams } from "./Step3Teams";
import { Step4Policy } from "./Step4Policy";
import { Step5Providers } from "./Step5Providers";
import { Step6Notifications } from "./Step6Notifications";
import { Step7Review } from "./Step7Review";
import { tinyId } from "./_shared";

interface OrgSnapshot {
  id: number;
  name: string;
  slug: string;
}
interface TeamSnapshot {
  id: number;
  name: string;
  slug: string;
  orgId: number;
}
interface ProviderSnapshot {
  id: number;
  name: string;
  slug: string;
  baseUrl: string;
}
interface WizardPolicySnapshot {
  scanners: {
    secrets: { enabled: boolean; block: number; redact: number };
    pii: { enabled: boolean; block: number; redact: number };
    promptInjection: { enabled: boolean; block: number; redact: number };
    entropy: { enabled: boolean; block: number; redact: number };
    unicode: { enabled: boolean; block: number; redact: number };
  };
  responseScanning: boolean;
  mcpGateway: boolean;
  mcpAudit: boolean;
  costRouting: { enabled: boolean; perRequestUsdCap?: number };
}

/**
 * OnboardingRoot — the only mount point for the post-signup wizard.
 *
 * Routing model:
 *   - The wizard is a single-page state machine, NOT one route per step.
 *     The current step lives in Redux (`onboarding.step`), so back/forward
 *     buttons inside the wizard work via plain dispatch instead of fighting
 *     with the router.
 *   - Step 3 (Teams) and Step 6 (Notifications) auto-skip for individual
 *     workspaces — see goNext/goBack helpers.
 *
 * Gate behaviour:
 *   - If the user is already onboarded (`user.onboardingComplete === true`)
 *     and lands on /onboarding by accident, redirect to /dashboard.
 *   - If the user is unauthenticated, redirect to /login.
 */
export function OnboardingRoot() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const user = useAppSelector((s) => s.auth.user);
  const isAuthenticated = useAppSelector((s) => s.auth.isAuthenticated);
  const wizard = useAppSelector((s) => s.onboarding);
  const [hydrating, setHydrating] = useState(true);

  // Pre-fill profile from current user on first mount.
  useEffect(() => {
    if (user?.name && !wizard.profile.name) {
      dispatch(onboardingActions.setProfile({ name: user.name }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.name]);

  /**
   * Hydrate the wizard from server state on first mount.
   *
   * Run only once per page load. If the user has an org already, pull
   * teams + providers + policy so a hard refresh doesn't reset them
   * back to Step 1's defaults. State already in Redux takes priority
   * over the server fetch so an in-progress step isn't clobbered.
   */
  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      if (!isAuthenticated || !user) {
        setHydrating(false);
        return;
      }

      // If the wizard has already progressed past Step 1 this session,
      // trust Redux and skip the refetch.
      if (wizard.org.id || wizard.step > 1) {
        setHydrating(false);
        return;
      }

      try {
        // 1. Resolve the user's current org (if any) from /api/auth/me.
        //    We already have `user.orgId` in Redux, but /me is the
        //    canonical source — this also refreshes it after an
        //    invite-accept flow where the orgId may have just changed.
        const me = await apiClient.get<{
          user: { id: number; orgId: number | null; name: string };
        }>("/api/auth/me");
        const orgId = me.user.orgId;
        if (cancelled || !orgId) {
          setHydrating(false);
          return;
        }

        // 2. Fetch org info. GET /api/orgs returns { organizations: [...] }.
        const orgsResp = await apiClient
          .get<{ organizations: OrgSnapshot[] }>("/api/orgs")
          .catch(() => ({ organizations: [] as OrgSnapshot[] }));
        const mine = (orgsResp.organizations || []).find((o) => o.id === orgId);
        if (cancelled) return;
        if (mine) {
          dispatch(
            onboardingActions.setOrg({
              id: mine.id,
              name: mine.name,
              slug: mine.slug,
            }),
          );
          // Default workspace type when unknown — user can still
          // go back to Step 1 and change it.
          if (!wizard.workspaceType) {
            dispatch(
              onboardingActions.setWorkspaceType(
                mine.slug.startsWith("personal-") ? "individual" : "team",
              ),
            );
          }
        }

        // 3. Teams — GET /api/teams returns { teams: [...] } scoped
        //    to the caller's own org automatically.
        const teamsResp = await apiClient
          .get<{ teams: TeamSnapshot[] }>("/api/teams")
          .catch(() => ({ teams: [] as TeamSnapshot[] }));
        const teams = teamsResp.teams ?? [];
        if (cancelled) return;
        for (const t of teams) {
          if (!wizard.teams.some((x) => x.serverId === t.id)) {
            dispatch(
              onboardingActions.addTeam({
                localId: tinyId(),
                serverId: t.id,
                name: t.name,
                slug: t.slug,
              }),
            );
          }
        }

        // 4. Providers
        const providers = await apiClient
          .get<ProviderSnapshot[]>("/api/providers")
          .catch(() => [] as ProviderSnapshot[]);
        if (cancelled) return;
        for (const p of providers) {
          if (!wizard.providers.some((x) => x.serverId === p.id)) {
            const kind = inferKindFromBaseUrl(p.baseUrl);
            dispatch(
              onboardingActions.addProvider({
                localId: tinyId(),
                serverId: p.id,
                kind,
                name: p.name,
              }),
            );
          }
        }

        // 5. Policy (wizard-shaped)
        const policy = await apiClient
          .get<WizardPolicySnapshot>("/api/policy/wizard")
          .catch(() => null);
        if (cancelled) return;
        if (policy) {
          dispatch(onboardingActions.setPolicy(policy));
        }
      } catch (err) {
        console.warn("[OnboardingRoot] hydration failed:", err);
      } finally {
        if (!cancelled) setHydrating(false);
      }
    }

    hydrate();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!isAuthenticated) {
    return <Navigate to={ROUTES.LOGIN} replace />;
  }
  if (user?.onboardingComplete === true) {
    return <Navigate to={ROUTES.CHAT} replace />;
  }
  if (hydrating) {
    return (
      <div className="relative flex min-h-screen items-center justify-center">
        <AnimatedBackdrop />
        <LoadingSpinner />
      </div>
    );
  }

  const isIndividual = wizard.workspaceType === "individual";

  /** Map "logical" step number → real step number for individuals (skip 3 and 6). */
  function nextStepFrom(step: number): number {
    let next = step + 1;
    if (isIndividual && next === 3) next = 4;
    if (isIndividual && next === 6) next = 7;
    return Math.min(7, next);
  }
  function prevStepFrom(step: number): number {
    let prev = step - 1;
    if (isIndividual && prev === 6) prev = 5;
    if (isIndividual && prev === 3) prev = 2;
    return Math.max(1, prev);
  }

  function goNext() {
    dispatch(onboardingActions.setStep(nextStepFrom(wizard.step)));
  }
  function goBack() {
    dispatch(onboardingActions.setStep(prevStepFrom(wizard.step)));
  }
  function goFinish() {
    dispatch(onboardingActions.markCompleted());
    navigate(ROUTES.CHAT);
  }

  // Steps 3 and 6 are visible only to team / org workspaces.
  const totalLogicalSteps = isIndividual ? 5 : 7;
  const logicalIndex = (() => {
    if (!isIndividual) return wizard.step;
    // Individual maps 1→1, 2→2, 4→3, 5→4, 7→5
    if (wizard.step <= 2) return wizard.step;
    if (wizard.step === 4) return 3;
    if (wizard.step === 5) return 4;
    return 5;
  })();

  const stepNode = (() => {
    switch (wizard.step) {
      case 1:
        return <Step1WorkspaceType onNext={goNext} />;
      case 2:
        return <Step2Profile onNext={goNext} onBack={goBack} />;
      case 3:
        return <Step3Teams onNext={goNext} onBack={goBack} />;
      case 4:
        return <Step4Policy onNext={goNext} onBack={goBack} />;
      case 5:
        return <Step5Providers onNext={goNext} onBack={goBack} />;
      case 6:
        return <Step6Notifications onNext={goNext} onBack={goBack} />;
      case 7:
        return <Step7Review onFinish={goFinish} onBack={goBack} />;
      default:
        return null;
    }
  })();

  return (
    <div className="relative min-h-screen text-slate-100">
      <AnimatedBackdrop />

      <div className="relative z-10 mx-auto max-w-3xl px-6 py-10">
        {/* Header */}
        <div className="afw-animate-fade-up mb-8 flex flex-col items-center text-center">
          <BrandShield size={64} pulse />
          <h1 className="mt-5 text-2xl font-bold tracking-tight text-white">
            Set up your AI Firewall
          </h1>
          <p className="mt-2 max-w-md text-sm text-slate-400">
            A few quick steps and you'll be scanning every prompt.
          </p>
        </div>

        {/* Progress bar */}
        <div className="afw-animate-fade-up-delay-1 mb-8">
          <div className="mb-2 flex items-center justify-between text-xs text-slate-400">
            <span>
              Step {logicalIndex} of {totalLogicalSteps}
            </span>
            <span>{Math.round((logicalIndex / totalLogicalSteps) * 100)}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800/60">
            <div
              className="h-full bg-gradient-to-r from-emerald-500 to-cyan-500 transition-all duration-500"
              style={{ width: `${(logicalIndex / totalLogicalSteps) * 100}%` }}
            />
          </div>
        </div>

        {/* Step content */}
        <div className="afw-animate-fade-up-delay-2">{stepNode}</div>
      </div>
    </div>
  );
}

/**
 * Guess the provider "kind" from a base URL. Used only during hydration
 * so the review screen can display the right label — the actual kind
 * for NEWLY added providers comes from the user's picker in Step 5.
 */
function inferKindFromBaseUrl(
  baseUrl: string,
): "openai" | "anthropic" | "gemini" | "mistral" | "azure" | "ollama" | "custom" {
  const u = (baseUrl || "").toLowerCase();
  if (u.includes("openai.com")) return "openai";
  if (u.includes("anthropic.com")) return "anthropic";
  if (u.includes("googleapis.com") || u.includes("generativelanguage"))
    return "gemini";
  if (u.includes("mistral")) return "mistral";
  if (u.includes("azure") || u.includes("cognitiveservices")) return "azure";
  if (u.includes("11434") || u.includes("ollama")) return "ollama";
  return "custom";
}

export default OnboardingRoot;
