import { createSlice, PayloadAction } from "@reduxjs/toolkit";

export interface ScanResult {
  action: "ALLOW" | "REDACT" | "BLOCK" | "REQUIRE_APPROVAL";
  riskScore: number;
  secretsCount: number;
  piiCount: number;
  entropyCount: number;
  redactedTypes: string[];
  tokensUsed?: number;
  cost?: number;
  timestamp: number;
}

export interface PreflightResult {
  action: "ALLOW" | "REDACT" | "BLOCK" | "REQUIRE_APPROVAL";
  secretsFound: number;
  piiFound: number;
  riskScore: number;
  reasons?: string[];
}

// ── Firewall Activity Lifecycle ─────────────────────────────────────────

export type FirewallActivityStep =
  | "scanning_secrets"
  | "scanning_pii"
  | "scanning_injection"
  | "checking_policy"
  | "counting_tokens"
  | "checking_context_window"
  | "estimating_cost"
  | "reducing_context"
  | "redacting"
  | "routing"
  | "forwarding"
  | "scanning_response"
  | "reading_file"
  | "searching_web"
  | "extracting_image"
  | "reading_pdf"
  | "grepping"
  | "analysing"
  | "processing"
  | "complete";

export interface FirewallActivity {
  step: FirewallActivityStep;
  message: string;
  detail?: string;
  startedAt: number;
}

export const ACTIVITY_LABELS: Record<
  FirewallActivityStep,
  { icon: string; text: string }
> = {
  scanning_secrets: { icon: "\uD83D\uDD10", text: "Scanning for secrets..." },
  scanning_pii: { icon: "\uD83D\uDC64", text: "Scanning for PII..." },
  scanning_injection: { icon: "\uD83D\uDEE1\uFE0F", text: "Checking for prompt injection..." },
  checking_policy: { icon: "\uD83D\uDCCB", text: "Evaluating security policy..." },
  counting_tokens: { icon: "\uD83D\uDD22", text: "Counting tokens..." },
  checking_context_window: { icon: "\uD83D\uDCCF", text: "Checking context window..." },
  estimating_cost: { icon: "\uD83D\uDCB0", text: "Estimating cost..." },
  reducing_context: { icon: "\u2702\uFE0F", text: "Optimizing context..." },
  redacting: { icon: "\uD83D\uDD12", text: "Redacting sensitive data..." },
  routing: { icon: "\uD83D\uDD00", text: "Routing to provider..." },
  forwarding: { icon: "\uD83D\uDCE1", text: "Forwarding to LLM..." },
  scanning_response: { icon: "\uD83D\uDD0D", text: "Scanning response..." },
  reading_file: { icon: "\uD83D\uDCC4", text: "Reading file..." },
  searching_web: { icon: "\uD83C\uDF10", text: "Searching the web..." },
  extracting_image: { icon: "\uD83D\uDDBC\uFE0F", text: "Extracting image..." },
  reading_pdf: { icon: "\uD83D\uDCD1", text: "Reading PDF..." },
  grepping: { icon: "\uD83D\uDD0E", text: "Searching codebase..." },
  analysing: { icon: "\uD83E\uDDE0", text: "Analysing..." },
  processing: { icon: "\u2699\uFE0F", text: "Processing..." },
  complete: { icon: "\u2705", text: "Complete" },
};

// ── State ──────────────────────────────────────────────────────────────

export interface SecurityState {
  proxyHealthy: boolean;
  lastScanResult: ScanResult | null;
  sessionStats: {
    totalScanned: number;
    blocked: number;
    redacted: number;
    allowed: number;
    totalTokens: number;
    totalCost: number;
  };
  recentScans: ScanResult[];
  showBanner: boolean;
  preflightResult: PreflightResult | null;
  preflightPending: boolean;
  /** Current firewall pipeline activity shown in chat */
  firewallActivity: FirewallActivity | null;
  /** History of activity steps for the current request */
  activityLog: FirewallActivity[];
}

const initialState: SecurityState = {
  proxyHealthy: false,
  lastScanResult: null,
  sessionStats: {
    totalScanned: 0,
    blocked: 0,
    redacted: 0,
    allowed: 0,
    totalTokens: 0,
    totalCost: 0,
  },
  recentScans: [],
  showBanner: true,
  preflightResult: null,
  preflightPending: false,
  firewallActivity: null,
  activityLog: [],
};

const securitySlice = createSlice({
  name: "security",
  initialState,
  reducers: {
    setProxyHealthy(state, action: PayloadAction<boolean>) {
      state.proxyHealthy = action.payload;
    },

    addScanResult(state, action: PayloadAction<ScanResult>) {
      const result = action.payload;
      state.lastScanResult = result;

      state.sessionStats.totalScanned += 1;
      if (result.action === "BLOCK") state.sessionStats.blocked += 1;
      else if (result.action === "REDACT") state.sessionStats.redacted += 1;
      else state.sessionStats.allowed += 1;

      if (result.tokensUsed) {
        state.sessionStats.totalTokens += result.tokensUsed;
      }
      if (result.cost) {
        state.sessionStats.totalCost += result.cost;
      }

      state.recentScans.unshift(result);
      if (state.recentScans.length > 100) {
        state.recentScans.pop();
      }
    },

    dismissBanner(state) {
      state.showBanner = false;
    },

    showBannerAgain(state) {
      state.showBanner = true;
    },

    resetSessionStats(state) {
      state.sessionStats = initialState.sessionStats;
      state.recentScans = [];
      state.lastScanResult = null;
    },

    setPreflightResult(state, action: PayloadAction<PreflightResult | null>) {
      state.preflightResult = action.payload;
      state.preflightPending = action.payload !== null;
    },

    clearPreflight(state) {
      state.preflightResult = null;
      state.preflightPending = false;
    },

    /** Set current firewall activity step (shown in chat) */
    setFirewallActivity(state, action: PayloadAction<FirewallActivity>) {
      state.firewallActivity = action.payload;
      state.activityLog.push(action.payload);
    },

    /** Clear activity when request completes */
    clearFirewallActivity(state) {
      state.firewallActivity = null;
      state.activityLog = [];
    },
  },
});

export const {
  setProxyHealthy,
  addScanResult,
  dismissBanner,
  showBannerAgain,
  resetSessionStats,
  setPreflightResult,
  clearPreflight,
  setFirewallActivity,
  clearFirewallActivity,
} = securitySlice.actions;

export default securitySlice.reducer;
