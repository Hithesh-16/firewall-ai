import { createAsyncThunk, createSlice, PayloadAction } from "@reduxjs/toolkit";
import { permissionsApi } from "../../api/methods/permissionsApi";

/**
 * Permissions slice — single source of truth for "what can the current
 * user do?" throughout the frontend.
 *
 * Invariants (from the spec):
 *   - `permissions` is a FLAT string array (`['users:view', ...]`).
 *     Never a nested object, never mutated item-by-item — only
 *     wholesale-replaced via fetch or setPermissions.
 *   - Components NEVER fetch permissions themselves. Only the
 *     AppInitializer + auth flow dispatch the thunk.
 *   - `isFetched` tracks whether the backend call has completed at
 *     least once. ProtectedRoute waits on this so it doesn't render
 *     authorised content before the permission list is known.
 *   - On logout, `clearPermissions()` wipes everything. Never leave
 *     stale perms in Redux.
 */

export interface PermissionsState {
  permissions: string[];
  isLoading: boolean;
  isFetched: boolean;
  error: string | null;
}

const initialState: PermissionsState = {
  permissions: [],
  isLoading: false,
  isFetched: false,
  error: null,
};

export const fetchUserPermissions = createAsyncThunk<
  string[],
  void,
  { rejectValue: string }
>("permissions/fetchUserPermissions", async (_arg, { rejectWithValue }) => {
  try {
    return await permissionsApi.getMyPermissions();
  } catch (err) {
    return rejectWithValue(
      err instanceof Error ? err.message : "Failed to fetch permissions",
    );
  }
});

const permissionsSlice = createSlice({
  name: "permissions",
  initialState,
  reducers: {
    /**
     * Replace the permission list wholesale. Useful for tests and for
     * the rare case where the backend already returned permissions in
     * the login response and we want to avoid a second round-trip.
     */
    setPermissions(state, action: PayloadAction<string[]>) {
      state.permissions = action.payload;
      state.isFetched = true;
      state.isLoading = false;
      state.error = null;
    },
    /** Called on logout — wipes all permission state. */
    clearPermissions(state) {
      state.permissions = [];
      state.isFetched = false;
      state.isLoading = false;
      state.error = null;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchUserPermissions.pending, (state) => {
        state.isLoading = true;
        state.error = null;
      })
      .addCase(fetchUserPermissions.fulfilled, (state, action) => {
        state.permissions = action.payload;
        state.isLoading = false;
        state.isFetched = true;
        state.error = null;
      })
      .addCase(fetchUserPermissions.rejected, (state, action) => {
        state.isLoading = false;
        state.isFetched = true;
        state.error = action.payload ?? "Failed to fetch permissions";
      });
  },
});

export const { setPermissions, clearPermissions } = permissionsSlice.actions;
export const permissionsReducer = permissionsSlice.reducer;
