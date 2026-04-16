/**
 * Legacy re-export kept for backward compatibility with call sites that
 * import `PERMISSIONS_ENDPOINTS` directly.
 *
 * New call sites should import `ENDPOINTS` from `../endpoints` instead.
 */
import { ENDPOINTS } from "../endpoints";

export const PERMISSIONS_ENDPOINTS = {
  MY_PERMISSIONS: ENDPOINTS.me.permissions,
} as const;
