import { createSlice, PayloadAction } from "@reduxjs/toolkit";

/**
 * Onboarding wizard state.
 *
 * Lives in Redux so that:
 *   - Step components can read/write without prop-drilling.
 *   - The final "Finish" step has the full picture for the review screen.
 *   - A page refresh restores from server state hydrated by OnboardingRoot.
 *
 * Each step also persists to the server immediately on Continue, so this
 * slice is more of a UI buffer than a source of truth — the proxy DB is.
 */

export type WorkspaceType = "individual" | "team" | "organization";

export interface OnboardingProfile {
  name: string;
  industry?: string;
  timezone?: string;
}

export interface OnboardingOrgDraft {
  /** ID of the org once created (Step 1 creates it server-side). */
  id: number | null;
  name: string;
  slug: string;
}

export interface OnboardingTeamDraft {
  /** Local-only ID for list rendering. Server ID assigned on POST. */
  localId: string;
  serverId?: number;
  name: string;
  slug: string;
}

export interface OnboardingMemberInvite {
  email: string;
  role: "admin" | "security_lead" | "developer" | "auditor";
  /** Filled in after POST /api/orgs/:id/invites — copy/share manually. */
  inviteUrl?: string;
}

export interface OnboardingPolicyDraft {
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

export interface OnboardingProviderDraft {
  /** Local-only ID for list rendering. */
  localId: string;
  serverId?: number;
  kind:
    | "openai"
    | "anthropic"
    | "gemini"
    | "mistral"
    | "azure"
    | "ollama"
    | "custom";
  name: string;
  apiKey?: string;
  baseUrl?: string;
  /** Azure-specific. */
  deploymentName?: string;
}

export interface OnboardingNotificationDraft {
  webhookUrl?: string;
  slackWebhookUrl?: string;
  email?: string;
  webPushEnabled: boolean;
}

export interface OnboardingState {
  /** Current step index (1..7). */
  step: number;
  /** Set once Step 1 creates the org server-side. */
  workspaceType: WorkspaceType | null;
  profile: OnboardingProfile;
  org: OnboardingOrgDraft;
  teams: OnboardingTeamDraft[];
  invites: OnboardingMemberInvite[];
  policy: OnboardingPolicyDraft;
  providers: OnboardingProviderDraft[];
  notifications: OnboardingNotificationDraft;
  /** Filled by the API call after step 7's Finish button. */
  completed: boolean;
}

const defaultPolicy: OnboardingPolicyDraft = {
  scanners: {
    secrets: { enabled: true, block: 70, redact: 40 },
    pii: { enabled: true, block: 60, redact: 30 },
    promptInjection: { enabled: true, block: 80, redact: 50 },
    entropy: { enabled: true, block: 75, redact: 45 },
    unicode: { enabled: true, block: 70, redact: 40 },
  },
  responseScanning: false,
  mcpGateway: true,
  mcpAudit: true,
  costRouting: { enabled: false },
};

const initialState: OnboardingState = {
  step: 1,
  workspaceType: null,
  profile: { name: "", industry: "", timezone: "" },
  org: { id: null, name: "", slug: "" },
  teams: [],
  invites: [],
  policy: defaultPolicy,
  providers: [],
  notifications: { webPushEnabled: false },
  completed: false,
};

const onboardingSlice = createSlice({
  name: "onboarding",
  initialState,
  reducers: {
    setStep(state, action: PayloadAction<number>) {
      state.step = Math.max(1, Math.min(7, action.payload));
    },
    setWorkspaceType(state, action: PayloadAction<WorkspaceType>) {
      state.workspaceType = action.payload;
    },
    setOrg(
      state,
      action: PayloadAction<Partial<OnboardingOrgDraft>>,
    ) {
      state.org = { ...state.org, ...action.payload };
    },
    setProfile(state, action: PayloadAction<Partial<OnboardingProfile>>) {
      state.profile = { ...state.profile, ...action.payload };
    },
    addTeam(state, action: PayloadAction<OnboardingTeamDraft>) {
      state.teams.push(action.payload);
    },
    updateTeam(
      state,
      action: PayloadAction<{ localId: string; patch: Partial<OnboardingTeamDraft> }>,
    ) {
      const t = state.teams.find((x) => x.localId === action.payload.localId);
      if (t) Object.assign(t, action.payload.patch);
    },
    removeTeam(state, action: PayloadAction<string>) {
      state.teams = state.teams.filter((t) => t.localId !== action.payload);
    },
    addInvite(state, action: PayloadAction<OnboardingMemberInvite>) {
      state.invites.push(action.payload);
    },
    updateInvite(
      state,
      action: PayloadAction<{ index: number; patch: Partial<OnboardingMemberInvite> }>,
    ) {
      const inv = state.invites[action.payload.index];
      if (inv) Object.assign(inv, action.payload.patch);
    },
    removeInvite(state, action: PayloadAction<number>) {
      state.invites.splice(action.payload, 1);
    },
    setPolicy(state, action: PayloadAction<OnboardingPolicyDraft>) {
      state.policy = action.payload;
    },
    addProvider(state, action: PayloadAction<OnboardingProviderDraft>) {
      state.providers.push(action.payload);
    },
    updateProvider(
      state,
      action: PayloadAction<{
        localId: string;
        patch: Partial<OnboardingProviderDraft>;
      }>,
    ) {
      const p = state.providers.find(
        (x) => x.localId === action.payload.localId,
      );
      if (p) Object.assign(p, action.payload.patch);
    },
    removeProvider(state, action: PayloadAction<string>) {
      state.providers = state.providers.filter(
        (p) => p.localId !== action.payload,
      );
    },
    setNotifications(
      state,
      action: PayloadAction<Partial<OnboardingNotificationDraft>>,
    ) {
      state.notifications = { ...state.notifications, ...action.payload };
    },
    markCompleted(state) {
      state.completed = true;
    },
    reset() {
      return initialState;
    },
  },
});

export const onboardingActions = onboardingSlice.actions;
export const onboardingReducer = onboardingSlice.reducer;
