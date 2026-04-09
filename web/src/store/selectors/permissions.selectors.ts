import { createSelector } from "@reduxjs/toolkit";
import type { RootState } from "..";

/**
 * Memoised selectors for the permissions slice.
 *
 * The key one is `selectPermissionSet` — it converts the flat string
 * array into a `Set<string>` exactly once per permission-list change
 * and is shared by every `usePermission` hook call. Without
 * memoisation, each hook call would build a new Set, shallow
 * comparisons in useSelector would fail, and components would
 * re-render on every dispatch.
 */

export const selectPermissions = (state: RootState): string[] =>
  state.permissions.permissions;

export const selectPermissionsLoading = (state: RootState): boolean =>
  state.permissions.isLoading;

export const selectPermissionsFetched = (state: RootState): boolean =>
  state.permissions.isFetched;

export const selectPermissionsError = (state: RootState): string | null =>
  state.permissions.error;

/**
 * Memoised `Set<string>` over the flat permission list. Recomputed
 * ONLY when the underlying array reference changes. Callers get
 * O(1) `has()` lookups.
 */
export const selectPermissionSet = createSelector(
  [selectPermissions],
  (permissions): Set<string> => new Set(permissions),
);
