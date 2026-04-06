import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { ScanResult } from "../../api/types";

interface SessionStats {
  totalScanned: number;
  blocked: number;
  redacted: number;
  allowed: number;
  totalTokens: number;
  totalCost: number;
}

interface SecurityState {
  proxyHealthy: boolean;
  sessionStats: SessionStats;
  recentScans: ScanResult[];
}

const initialState: SecurityState = {
  proxyHealthy: false,
  sessionStats: {
    totalScanned: 0,
    blocked: 0,
    redacted: 0,
    allowed: 0,
    totalTokens: 0,
    totalCost: 0,
  },
  recentScans: [],
};

export const securitySlice = createSlice({
  name: "security",
  initialState,
  reducers: {
    addScanResult(state, action: PayloadAction<ScanResult>) {
      const result = action.payload;
      const stats = { ...state.sessionStats };
      stats.totalScanned += 1;
      if (result.action === "BLOCK") stats.blocked += 1;
      else if (result.action === "REDACT") stats.redacted += 1;
      else stats.allowed += 1;

      return {
        ...state,
        sessionStats: stats,
        recentScans: [result, ...state.recentScans].slice(0, 100),
      };
    },
    setProxyHealthy(state, action: PayloadAction<boolean>) {
      return { ...state, proxyHealthy: action.payload };
    },
    resetSessionStats() {
      return { ...initialState };
    },
  },
});

export const { addScanResult, setProxyHealthy, resetSessionStats } =
  securitySlice.actions;
export default securitySlice.reducer;
