/**
 * Central endpoint constants for permission-related API calls.
 *
 * Rule: NEVER hardcode an endpoint path at a call site. Import from
 * here. Adding a new permission-related endpoint means adding a
 * constant here AND a method in `permissionsApi.ts`.
 */

export const PERMISSIONS_ENDPOINTS = {
  /** Flat list of the current user's effective permission atoms. */
  MY_PERMISSIONS: "/api/me/permissions",
} as const;
