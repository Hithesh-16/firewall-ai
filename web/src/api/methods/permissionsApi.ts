import { apiClient } from "../client";
import { PERMISSIONS_ENDPOINTS } from "../endpoints/permissionsEndpoints";

/**
 * All permissions-related HTTP methods. The slice's thunk imports
 * from here — never from `apiClient` directly, so if the transport
 * changes we only touch this one file.
 */
export const permissionsApi = {
  /**
   * Fetch the current user's effective permission atoms as a flat
   * string array (e.g. ['users:view', 'chat:create']). Resolved on
   * the backend from their role + org overrides + user overrides.
   */
  async getMyPermissions(): Promise<string[]> {
    const resp = await apiClient.get<{ permissions: string[] }>(
      PERMISSIONS_ENDPOINTS.MY_PERMISSIONS,
    );
    return Array.isArray(resp?.permissions) ? resp.permissions : [];
  },
};
