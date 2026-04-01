import { createSlice, PayloadAction } from "@reduxjs/toolkit";

export interface AgentSession {
  id: string;
  task: string;
  model: string;
  status: "running" | "completed" | "failed" | "cancelled";
  progress: number;
  startedAt: number;
  lastActivityAt: number;
}

export interface PendingApproval {
  requestId: number;
  actionType: string;
  resource: string;
  context: Record<string, unknown>;
  timeoutMs: number;
  createdAt: number;
}

interface AgentState {
  activeAgents: AgentSession[];
  pendingApprovals: PendingApproval[];
  approvalHistory: PendingApproval[];
}

const initialState: AgentState = {
  activeAgents: [],
  pendingApprovals: [],
  approvalHistory: [],
};

export const agentSlice = createSlice({
  name: "agent",
  initialState,
  reducers: {
    addAgent: (state, action: PayloadAction<AgentSession>) => {
      state.activeAgents = [...state.activeAgents, action.payload];
    },
    updateAgent: (
      state,
      action: PayloadAction<{ id: string } & Partial<AgentSession>>,
    ) => {
      state.activeAgents = state.activeAgents.map((agent) =>
        agent.id === action.payload.id
          ? { ...agent, ...action.payload }
          : agent,
      );
    },
    removeAgent: (state, action: PayloadAction<string>) => {
      state.activeAgents = state.activeAgents.filter(
        (a) => a.id !== action.payload,
      );
    },
    addPendingApproval: (state, action: PayloadAction<PendingApproval>) => {
      state.pendingApprovals = [...state.pendingApprovals, action.payload];
    },
    removePendingApproval: (state, action: PayloadAction<number>) => {
      const removed = state.pendingApprovals.find(
        (a) => a.requestId === action.payload,
      );
      state.pendingApprovals = state.pendingApprovals.filter(
        (a) => a.requestId !== action.payload,
      );
      if (removed) {
        state.approvalHistory = [...state.approvalHistory, removed];
      }
    },
    setPendingApprovals: (state, action: PayloadAction<PendingApproval[]>) => {
      state.pendingApprovals = action.payload;
    },
    clearApprovalHistory: (state) => {
      state.approvalHistory = [];
    },
  },
});

export const {
  addAgent,
  updateAgent,
  removeAgent,
  addPendingApproval,
  removePendingApproval,
  setPendingApprovals,
  clearApprovalHistory,
} = agentSlice.actions;

export default agentSlice.reducer;
