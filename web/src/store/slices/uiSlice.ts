import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

export interface Toast {
  id: string;
  type: "success" | "error" | "warning" | "info";
  message: string;
}

interface UiState {
  sidebarOpen: boolean;
  sidebarCollapsed: boolean;
  activeDialog: string | null;
  toasts: Toast[];
}

const initialState: UiState = {
  sidebarOpen: true,
  sidebarCollapsed: false,
  activeDialog: null,
  toasts: [],
};

export const uiSlice = createSlice({
  name: "ui",
  initialState,
  reducers: {
    toggleSidebar(state) {
      return { ...state, sidebarOpen: !state.sidebarOpen };
    },
    setSidebarOpen(state, action: PayloadAction<boolean>) {
      return { ...state, sidebarOpen: action.payload };
    },
    setSidebarCollapsed(state, action: PayloadAction<boolean>) {
      return { ...state, sidebarCollapsed: action.payload };
    },
    showToast(state, action: PayloadAction<Toast>) {
      return { ...state, toasts: [...state.toasts, action.payload] };
    },
    dismissToast(state, action: PayloadAction<string>) {
      return {
        ...state,
        toasts: state.toasts.filter((t) => t.id !== action.payload),
      };
    },
    showDialog(state, action: PayloadAction<string>) {
      return { ...state, activeDialog: action.payload };
    },
    hideDialog(state) {
      return { ...state, activeDialog: null };
    },
  },
});

export const {
  toggleSidebar,
  setSidebarOpen,
  setSidebarCollapsed,
  showToast,
  dismissToast,
  showDialog,
  hideDialog,
} = uiSlice.actions;
export default uiSlice.reducer;
