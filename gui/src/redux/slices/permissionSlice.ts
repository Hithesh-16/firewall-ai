import { createSlice, PayloadAction } from "@reduxjs/toolkit";

export interface PermissionRequest {
  id: string;
  toolName: string;
  args: Record<string, unknown>;
  riskLevel: "low" | "medium" | "high" | "critical";
  timestamp: number;
}

export interface PermissionRule {
  id: string;
  pattern: string;
  decision: "allow" | "deny";
  scope: "once" | "always";
  createdAt: number;
}

interface PermissionState {
  queue: PermissionRequest[];
  rules: PermissionRule[];
  loading: boolean;
}

const initialState: PermissionState = {
  queue: [],
  rules: [],
  loading: false,
};

export const permissionSlice = createSlice({
  name: "permission",
  initialState,
  reducers: {
    pushRequest: (state, action: PayloadAction<PermissionRequest>) => {
      state.queue = [...state.queue, action.payload];
    },
    resolveRequest: (state, action: PayloadAction<string>) => {
      state.queue = state.queue.filter((r) => r.id !== action.payload);
    },
    addRule: (state, action: PayloadAction<PermissionRule>) => {
      state.rules = [...state.rules, action.payload];
    },
    removeRule: (state, action: PayloadAction<string>) => {
      state.rules = state.rules.filter((r) => r.id !== action.payload);
    },
    setRules: (state, action: PayloadAction<PermissionRule[]>) => {
      state.rules = action.payload;
    },
    clearQueue: (state) => {
      state.queue = [];
    },
  },
});

export const {
  pushRequest,
  resolveRequest,
  addRule,
  removeRule,
  setRules,
  clearQueue,
} = permissionSlice.actions;

export default permissionSlice.reducer;
