import { AuthenticatedConfig } from "src/auth/workos-types.js";

import {
  ensureOrganization,
  isAuthenticated,
  listUserOrganizations,
  loadAuthConfig,
  saveAuthConfig,
} from "../auth/workos.js";
// Phase 5+ — both sign-in and sign-out now go through the shared
// web-first flow in commands/login.ts and commands/logout.ts. The
// legacy WorkOS device-auth `doLogin` / `doLogout` pair is gone: it
// talked to a service we no longer operate and crashed the TUI with
// "Token refresh error: fetch failed" on every start.
import { authenticate as webAuthenticate } from "../commands/login.js";
import { logout as webLogout } from "../commands/logout.js";
import { logger } from "../util/logger.js";

import { BaseService } from "./BaseService.js";
import { AuthServiceState } from "./types.js";

/**
 * Service for managing authentication state and operations
 * Encapsulates all auth logic and provides reactive updates
 */
export class AuthService extends BaseService<AuthServiceState> {
  constructor() {
    super("AuthService", {
      authConfig: null,
      isAuthenticated: false,
    });
  }

  /**
   * Initialize the auth service by loading current config
   */
  async doInitialize(): Promise<AuthServiceState> {
    const authConfig = loadAuthConfig();
    const authenticated = await isAuthenticated();

    const state: AuthServiceState = {
      authConfig,
      isAuthenticated: authenticated,
      organizationId: authConfig?.organizationId || undefined,
    };

    logger.debug("AuthService initialized", {
      authenticated,
      hasConfig: !!authConfig,
      orgId: state.organizationId,
    });

    return state;
  }

  /**
   * Perform login flow via the web-first loopback handshake. The actual
   * work lives in `commands/login.ts` — this wrapper just re-reads the
   * auth file after `authenticate()` returns and updates service state.
   */
  async login(): Promise<AuthServiceState> {
    logger.debug("Starting web-first login flow");

    try {
      const ok = await webAuthenticate({ force: true });
      if (!ok) {
        throw new Error("Sign-in did not complete");
      }

      // The web flow writes ~/.ai-firewall/auth.json atomically; re-load
      // it and re-check authenticated status from disk so the service
      // state is accurate for every downstream consumer.
      const newAuthConfig = loadAuthConfig();
      const authenticated = await isAuthenticated();

      this.setState({
        authConfig: newAuthConfig,
        isAuthenticated: authenticated,
        organizationId: newAuthConfig?.organizationId || undefined,
      });

      logger.debug("Login successful", {
        orgId: this.currentState.organizationId,
      });

      return this.getState();
    } catch (error: any) {
      logger.error("Login failed:", error);
      this.emit("error", error);
      throw error;
    }
  }

  /**
   * Perform logout via the shared web-first flow. Always clears local
   * state even if the server revoke call fails — the user's intent is
   * "get me signed out", and the worst case is a stale token the proxy
   * will reject on next use.
   */
  async logout(): Promise<AuthServiceState> {
    logger.debug("Logging out (web-first flow)");

    try {
      await webLogout();
    } catch (error) {
      // commands/logout.ts already swallows everything it can, but
      // we still wrap defensively so a bug there can't wedge the TUI.
      logger.error("webLogout threw — clearing local state anyway", error);
    }

    this.setState({
      authConfig: null,
      isAuthenticated: false,
      organizationId: undefined,
    });

    logger.debug("Logout complete");
    return this.getState();
  }

  /**
   * Ensure organization is selected, prompting if necessary
   */
  async ensureOrganization(
    isHeadless: boolean = false,
    cliOrganizationSlug?: string,
  ): Promise<AuthServiceState> {
    if (!this.currentState.authConfig) {
      throw new Error("Not authenticated - cannot ensure organization");
    }

    logger.debug("Ensuring organization is selected", {
      currentOrgId: this.currentState.organizationId,
      isHeadless,
      cliOrganizationSlug,
    });

    const updatedConfig = await ensureOrganization(
      this.currentState.authConfig,
      isHeadless,
      cliOrganizationSlug,
    );

    this.setState({
      authConfig: updatedConfig,
      isAuthenticated: true,
      organizationId: updatedConfig?.organizationId || undefined,
    });

    logger.debug("Organization ensured", {
      orgId: this.currentState.organizationId,
    });

    return this.getState();
  }

  /**
   * Switch to a different organization
   */
  async switchOrganization(
    organizationId: string | null,
  ): Promise<AuthServiceState> {
    if (
      !this.currentState.authConfig ||
      !("userId" in this.currentState.authConfig)
    ) {
      throw new Error(
        "Not authenticated with file-based auth - cannot switch organizations",
      );
    }

    logger.debug("Switching organization", {
      from: this.currentState.organizationId,
      to: organizationId,
    });

    const authenticatedConfig = this.currentState
      .authConfig as AuthenticatedConfig;

    const updatedConfig: AuthenticatedConfig = {
      ...authenticatedConfig,
      organizationId,
    };

    saveAuthConfig(updatedConfig);

    this.setState({
      authConfig: updatedConfig,
      isAuthenticated: true,
      organizationId: organizationId || undefined,
    });

    logger.debug("Organization switched", {
      newOrgId: this.currentState.organizationId,
    });

    return this.getState();
  }

  /**
   * Get available organizations for the current user
   */
  async getAvailableOrganizations(): Promise<
    { id: string; name: string }[] | null
  > {
    if (!this.currentState.isAuthenticated) {
      return null;
    }

    try {
      return await listUserOrganizations();
    } catch (error: any) {
      logger.error("Failed to list organizations:", error);
      this.emit("error", error);
      return null;
    }
  }

  /**
   * Check if the current user has multiple organizations available
   */
  async hasMultipleOrganizations(): Promise<boolean> {
    const orgs = await this.getAvailableOrganizations();
    return orgs !== null && orgs.length > 0;
  }

  /**
   * Refresh auth state from disk (useful after external changes)
   */
  async refresh(): Promise<AuthServiceState> {
    logger.debug("Refreshing auth state from disk");
    return this.reload();
  }
}
