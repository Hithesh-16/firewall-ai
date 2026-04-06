import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { User } from "../../api/types";
import { setToken, clearToken } from "../../utils/storage";

interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  loading: boolean;
}

const initialState: AuthState = {
  user: null,
  token: null,
  isAuthenticated: false,
  loading: false,
};

export const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {
    setCredentials(
      state,
      action: PayloadAction<{ user: User; token: string }>,
    ) {
      const { user, token } = action.payload;
      setToken(token);
      return {
        ...state,
        user,
        token,
        isAuthenticated: true,
        loading: false,
      };
    },
    logout() {
      clearToken();
      return { ...initialState };
    },
    setLoading(state, action: PayloadAction<boolean>) {
      return { ...state, loading: action.payload };
    },
  },
});

export const { setCredentials, logout, setLoading } = authSlice.actions;
export default authSlice.reducer;
