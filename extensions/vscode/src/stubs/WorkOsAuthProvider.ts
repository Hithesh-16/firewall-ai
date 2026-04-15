import crypto from "crypto";
import { EventEmitter as NodeEventEmitter } from "node:events";

import {
  AuthType,
  ControlPlaneSessionInfo,
  HubEnv,
  isHubEnv,
} from "core/control-plane/AuthTypes";
import { getControlPlaneEnvSync } from "core/control-plane/env";
import { Logger } from "core/util/Logger";
import fetch from "node-fetch";
import { v4 as uuidv4 } from "uuid";
import {
  authentication,
  AuthenticationProvider,
  AuthenticationProviderAuthenticationSessionsChangeEvent,
  AuthenticationSession,
  commands,
  Disposable,
  env,
  EventEmitter,
  ExtensionContext,
  ProgressLocation,
  Uri,
  window,
} from "vscode";

import { AiFirewallAuthService } from "../auth/aiFirewallAuthService";

import { PromiseAdapter, promiseFromEvent } from "./promiseUtils";
import { SecretStorage } from "./SecretStorage";
import { UriEventHandler } from "./uriHandler";

const AUTH_NAME = "AI Firewall";

// AI Firewall does not use the legacy Continue Hub / WorkOS auth.
// Passing "none" makes isHubEnv() return false, so
// getControlPlaneSessionInfo() returns { AUTH_TYPE: "on-prem" }
// instead of trying to refresh WorkOS tokens against
// /auth/refresh (which doesn't exist on the proxy). Without this
// fix, the stale WorkOS profile data (userId, teamId, userName
// from a prior Continue Hub login) leaks into the config handler
// and gets rendered as raw JSON in the chat panel.
const controlPlaneEnv = getControlPlaneEnvSync("none");

const SESSIONS_SECRET_KEY = `${controlPlaneEnv.AUTH_TYPE}.sessions`;

// Function to generate a random string of specified length
function generateRandomString(length: number): string {
  const possibleCharacters =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  let randomString = "";
  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * possibleCharacters.length);
    randomString += possibleCharacters[randomIndex];
  }
  return randomString;
}

// Function to generate a code challenge from the code verifier

async function generateCodeChallenge(verifier: string) {
  // Create a SHA-256 hash of the verifier
  const hash = crypto.createHash("sha256").update(verifier).digest();

  // Convert the hash to a base64 URL-encoded string
  const base64String = hash
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  return base64String;
}

interface ContinueAuthenticationSession extends AuthenticationSession {
  refreshToken: string;
  expiresInMs: number;
  loginNeeded: boolean;
}

export class WorkOsAuthProvider implements AuthenticationProvider, Disposable {
  private _sessionChangeEmitter =
    new EventEmitter<AuthenticationProviderAuthenticationSessionsChangeEvent>();
  private _disposable: Disposable;
  private _pendingStates: string[] = [];
  private _codeExchangePromises = new Map<
    string,
    { promise: Promise<string>; cancel: EventEmitter<void> }
  >();
  private _refreshInterval: NodeJS.Timeout | null = null;
  private _isRefreshing = false;

  private static EXPIRATION_TIME_MS = 1000 * 60 * 15; // 15 minutes
  private static REFRESH_INTERVAL_MS = 1000 * 60 * 10; // 10 minutes

  private secretStorage: SecretStorage;

  constructor(
    private readonly context: ExtensionContext,
    private readonly _uriHandler: UriEventHandler,
    private readonly aiFirewallAuth: AiFirewallAuthService,
  ) {
    this._disposable = Disposable.from(
      authentication.registerAuthenticationProvider(
        controlPlaneEnv.AUTH_TYPE,
        AUTH_NAME,
        this,
        { supportsMultipleAccounts: false },
      ),
      window.registerUriHandler(this._uriHandler),
    );

    this.secretStorage = new SecretStorage(context);

    this.attemptEmitter = new NodeEventEmitter();
    WorkOsAuthProvider.hasAttemptedRefresh = new Promise((resolve) => {
      this.attemptEmitter.on("attempted", resolve);
    });

    // AI Firewall always runs in on-prem mode (see env.ts NONE_ENV).
    // The legacy Continue Hub refresh path POSTs to /auth/refresh on
    // the proxy, which doesn't exist — every retry produces an error
    // event that fans out to webview/config listeners and ends up
    // rendered in the chat panel after system sleep/wake (when the
    // suspended interval catches up and fires a burst of failures).
    //
    // Skip the refresh entirely when on-prem and aggressively wipe
    // any stale sessions from a previous Continue Hub install so the
    // next refresh attempt finds nothing to refresh.
    if (controlPlaneEnv.AUTH_TYPE === AuthType.OnPrem) {
      void this._purgeStaleSessions();
      this.attemptEmitter.emit("attempted");
    } else {
      void this.refreshSessions();
      this._refreshInterval = setInterval(() => {
        void this.refreshSessions();
      }, WorkOsAuthProvider.REFRESH_INTERVAL_MS);
    }
  }

  /**
   * One-shot cleanup: delete the encrypted sessions file written by
   * older builds that ran against Continue Hub. Best-effort — if the
   * file is locked or missing we just move on. Called once from the
   * constructor when on-prem.
   */
  private async _purgeStaleSessions(): Promise<void> {
    try {
      await this.secretStorage.delete(SESSIONS_SECRET_KEY);
    } catch {
      // ignore — stale file will be re-purged on the next activation
    }
    // Also delete the OLD key from before the env switch (when
    // AUTH_TYPE was "ai-firewall" not "on-prem"), so users upgrading
    // from a Continue-Hub build don't keep replaying the old profile.
    try {
      await this.secretStorage.delete("ai-firewall.sessions");
    } catch {
      // ignore
    }
    try {
      await this.secretStorage.delete("ai-firewall-staging.sessions");
    } catch {
      // ignore
    }
  }

  private decodeJwt(jwt: string): Record<string, any> | null {
    try {
      const decodedToken = JSON.parse(
        Buffer.from(jwt.split(".")[1], "base64").toString(),
      );
      return decodedToken;
    } catch (e: any) {
      // Capture JWT decoding failures to Sentry (could indicate token corruption)
      Logger.error(e, {
        context: "workOS_auth_jwt_decode",
        jwtLength: jwt.length,
        jwtPrefix: jwt.substring(0, 20) + "...", // Safe prefix for debugging
      });

      console.warn(`Error decoding JWT: ${e}`);
      return null;
    }
  }

  private jwtIsExpiredOrInvalid(jwt: string): boolean {
    const decodedToken = this.decodeJwt(jwt);
    if (!decodedToken) {
      return true;
    }
    return decodedToken.exp * 1000 < Date.now();
  }

  private getExpirationTimeMs(jwt: string): number {
    const decodedToken = this.decodeJwt(jwt);
    if (!decodedToken) {
      return WorkOsAuthProvider.EXPIRATION_TIME_MS;
    }
    return decodedToken.exp && decodedToken.iat
      ? (decodedToken.exp - decodedToken.iat) * 1000
      : WorkOsAuthProvider.EXPIRATION_TIME_MS;
  }

  private async storeSessions(value: ContinueAuthenticationSession[]) {
    const data = JSON.stringify(value, null, 2);
    await this.secretStorage.store(SESSIONS_SECRET_KEY, data);
  }

  public async getSessions(
    scopes?: string[],
  ): Promise<ContinueAuthenticationSession[]> {
    // On-prem builds never have a real WorkOS session — anything in
    // SecretStorage under SESSIONS_SECRET_KEY is left over from a
    // previous Continue Hub install. Returning [] here makes the
    // refresh loop a no-op even if a caller forces it to run, which
    // is what was previously fanning out errors into the webview
    // after system sleep/wake.
    if (controlPlaneEnv.AUTH_TYPE === AuthType.OnPrem) {
      return [];
    }
    // await this.hasAttemptedRefresh;
    try {
      const data = await this.secretStorage.get(SESSIONS_SECRET_KEY);
      if (!data) {
        return [];
      }

      const value = JSON.parse(data) as ContinueAuthenticationSession[];
      return value;
    } catch (e: any) {
      // Capture session decrypt and parsing errors to Sentry
      Logger.error(e, {
        context: "workOS_sessions_retrieval",
        errorMessage: e.message,
      });

      console.warn(`Error retrieving or parsing sessions: ${e.message}`);

      // Delete the corrupted cache file to allow fresh start on next attempt
      // This handles cases where decryption succeeded but JSON parsing failed
      try {
        await this.secretStorage.delete(SESSIONS_SECRET_KEY);
      } catch (deleteError: any) {
        console.error(
          `Failed to delete corrupted sessions cache:`,
          deleteError.message,
        );
      }

      return [];
    }
  }

  get onDidChangeSessions() {
    return this._sessionChangeEmitter.event;
  }

  get ideRedirectUri() {
    // We redirect to a page that says "you can close this page", and that page finishes the redirect
    const url = new URL(controlPlaneEnv.APP_URL);
    url.pathname = `/auth/${env.uriScheme}-redirect`;
    return url.toString();
  }

  public static useOnboardingUri: boolean = false;
  get redirectUri() {
    return this.ideRedirectUri;
  }

  public static hasAttemptedRefresh: Promise<void>;
  private attemptEmitter: NodeEventEmitter;
  async refreshSessions() {
    // Prevent concurrent refresh operations
    if (this._isRefreshing) {
      return;
    }

    try {
      this._isRefreshing = true;
      await this._refreshSessions();
    } catch (e) {
      // Capture session refresh failures to Sentry
      Logger.error(e, {
        context: "workOS_auth_session_refresh",
        authType: controlPlaneEnv.AUTH_TYPE,
      });

      console.error(`Error refreshing sessions: ${e}`);
    } finally {
      this._isRefreshing = false;
    }
  }

  // It is important that every path in this function emits the attempted event
  // As config loading in core will be locked until refresh is attempted
  private async _refreshSessions(): Promise<void> {
    const sessions = await this.getSessions();
    if (!sessions.length) {
      this.attemptEmitter.emit("attempted");
      return;
    }

    const finalSessions = [];
    for (const session of sessions) {
      try {
        const newSession = await this._refreshSessionWithRetry(
          session.refreshToken,
        );
        finalSessions.push({
          ...session,
          accessToken: newSession.accessToken,
          refreshToken: newSession.refreshToken,
          expiresInMs: newSession.expiresInMs,
        });
      } catch (e: any) {
        // Capture individual session refresh failures to Sentry
        Logger.error(e, {
          context: "workOS_individual_session_refresh",
          sessionId: session.id,
        });

        // If refresh fails (after retries for valid tokens), drop the session
        console.debug(`Error refreshing session token: ${e.message}`);
        this._sessionChangeEmitter.fire({
          added: [],
          removed: [session],
          changed: [],
        });
      }
    }

    await this.storeSessions(finalSessions);
    this._sessionChangeEmitter.fire({
      added: [],
      removed: [],
      changed: finalSessions,
    });
  }

  private async _refreshSessionWithRetry(
    refreshToken: string,
    attempt = 1,
    baseDelay = 1000,
  ): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresInMs: number;
  }> {
    try {
      return await this._refreshSession(refreshToken);
    } catch (error: any) {
      // Capture token refresh retry errors to Sentry
      Logger.error(error, {
        attempt,
        errorMessage: error.message,
        isAuthError:
          error.message?.includes("401") ||
          error.message?.includes("Invalid refresh token") ||
          error.message?.includes("Unauthorized"),
      });

      this.attemptEmitter.emit("attempted");
      // Don't retry for auth errors
      if (
        error.message?.includes("401") ||
        error.message?.includes("Invalid refresh token") ||
        error.message?.includes("Unauthorized")
      ) {
        throw error;
      }

      // For network errors or transient server issues, retry with backoff
      // Calculate exponential backoff delay with jitter
      const delay = Math.min(
        baseDelay * Math.pow(2, attempt - 1) * (0.5 + Math.random() * 0.5),
        2 * 60 * 1000, // 2 minutes
      );

      return new Promise((resolve, reject) => {
        setTimeout(() => {
          this._refreshSessionWithRetry(refreshToken, attempt + 1, baseDelay)
            .then(resolve)
            .catch(reject);
        }, delay);
      });
    } finally {
      this.attemptEmitter.emit("attempted");
    }
  }

  private async _refreshSession(refreshToken: string): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresInMs: number;
  }> {
    const response = await fetch(
      new URL("/auth/refresh", controlPlaneEnv.CONTROL_PLANE_URL),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          refreshToken,
        }),
      },
    );
    if (!response.ok) {
      const text = await response.text();
      throw new Error("Error refreshing token: " + text);
    }
    const data = (await response.json()) as any;
    return {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      expiresInMs: this.getExpirationTimeMs(data.accessToken),
    };
  }

  private _formatProfileLabel(
    firstName: string | null,
    lastName: string | null,
  ) {
    return ((firstName ?? "") + " " + (lastName ?? "")).trim();
  }

  /**
   * Create a new auth session
   * @param scopes
   * @returns
   */
  public async createSession(
    _scopes: string[],
  ): Promise<ContinueAuthenticationSession> {
    // ── AI Firewall override ──────────────────────────────────
    // The legacy WorkOS device-auth flow has been replaced by the
    // web-first loopback handshake via the proxy's /web-login-start
    // bridge. Instead of redirecting to api.workos.com, we trigger
    // the `aiFirewall.login` command which opens the user's browser
    // to the AI Firewall web dashboard.
    //
    // After the user signs in on the web, the loopback callback
    // delivers the token to AiFirewallAuthService which stores it
    // in SecretStorage + the shared auth file. We then read the
    // shared auth file here to build a synthetic session that
    // Continue core can consume for profile/config sync.
    try {
      // Trigger the web-first sign-in flow
      await commands.executeCommand("aiFirewall.login");

      // Read the token from the shared auth file (written by
      // AiFirewallAuthService.signIn during the browser flow)
      const fs = await import("fs");
      const os = await import("os");
      const path = await import("path");
      const authPath = path.join(os.homedir(), ".ai-firewall", "auth.json");
      let email = "user@aifirewall.local";
      let accessToken = "";
      if (fs.existsSync(authPath)) {
        const parsed = JSON.parse(fs.readFileSync(authPath, "utf8")) as {
          accessToken?: string;
          user?: { email?: string; name?: string };
        };
        accessToken = parsed.accessToken || "";
        email = parsed.user?.email || email;
      }

      if (!accessToken) {
        throw new Error("Sign-in did not complete");
      }

      const session: ContinueAuthenticationSession = {
        id: uuidv4(),
        accessToken,
        refreshToken: accessToken, // sentinel — shared-auth tokens don't refresh
        expiresInMs: WorkOsAuthProvider.EXPIRATION_TIME_MS,
        loginNeeded: false,
        account: {
          label: email,
          id: email,
        },
        scopes: [],
      };

      await this.storeSessions([session]);

      this._sessionChangeEmitter.fire({
        added: [session],
        removed: [],
        changed: [],
      });

      return session;
    } catch (e) {
      // Capture authentication failures to Sentry
      Logger.error(e, {
        context: "workOS_auth_session_creation",
        scopes: _scopes.join(","),
        authType: controlPlaneEnv.AUTH_TYPE,
      });

      void window.showErrorMessage(`Sign in failed: ${e}`);
      throw e;
    }
  }

  /**
   * Remove an existing session.
   *
   * This is what VS Code invokes when the user clicks "Sign Out" from
   * the Accounts (profile) menu. Historically it only spliced the
   * session from our legacy stub's in-memory list, which meant the
   * shared auth file at ~/.ai-firewall/auth.json and the proxy-side
   * token row were left behind — and the next profile-icon click
   * silently rehydrated the old identity from the stale file via
   * AiFirewallAuthService.signIn()'s short-circuit.
   *
   * We now also invoke AiFirewallAuthService.signOut(), which:
   *   - POSTs /api/auth/logout to revoke the token on the proxy
   *   - deletes ~/.ai-firewall/auth.json (so CLI + JetBrains are
   *     logged out too)
   *   - clears the aiFirewall.authToken.v1 SecretStorage entry
   *   - fires onDidChangeAuth so file-scope / assistant sync / UI
   *     state reset immediately
   *
   * signOut() is idempotent, so calling it once per session (when the
   * user had multiple) is safe — subsequent calls are no-ops.
   */
  public async removeSession(sessionId: string): Promise<void> {
    const sessions = await this.getSessions();
    const sessionIdx = sessions.findIndex((s) => s.id === sessionId);
    const session = sessions[sessionIdx];
    sessions.splice(sessionIdx, 1);

    await this.storeSessions(sessions);

    try {
      await this.aiFirewallAuth.signOut();
    } catch (err) {
      // Never block VS Code's sign-out UX on a proxy/network failure;
      // local cleanup inside signOut() runs regardless.
      console.warn(
        "[WorkOsAuthProvider] aiFirewallAuth.signOut failed:",
        err instanceof Error ? err.message : err,
      );
    }

    if (session) {
      this._sessionChangeEmitter.fire({
        added: [],
        removed: [session],
        changed: [],
      });
    }
  }

  /**
   * Dispose the registered services
   */
  public async dispose() {
    if (this._refreshInterval) {
      clearInterval(this._refreshInterval);
      this._refreshInterval = null;
    }
    this._disposable.dispose();
  }

  /**
   * Log in to Continue
   */
  private async login(
    codeChallenge: string,
    hubEnv: HubEnv,
    scopes: string[] = [],
  ) {
    return await window.withProgress<string>(
      {
        location: ProgressLocation.Notification,
        title: "Signing in to AI Firewall...",
        cancellable: true,
      },
      async (_, token) => {
        const stateId = uuidv4();

        this._pendingStates.push(stateId);

        const scopeString = scopes.join(" ");

        const url = new URL("https://api.workos.com/user_management/authorize");
        const params = {
          response_type: "code",
          client_id: hubEnv.WORKOS_CLIENT_ID,
          redirect_uri: this.redirectUri,
          state: stateId,
          code_challenge: codeChallenge,
          code_challenge_method: "S256",
          provider: "authkit",
          screen_hint: WorkOsAuthProvider.useOnboardingUri
            ? "sign-up"
            : "sign-in",
        };

        Object.keys(params).forEach((key) =>
          url.searchParams.append(key, params[key as keyof typeof params]),
        );

        const oauthUrl = url;
        if (oauthUrl) {
          await env.openExternal(Uri.parse(oauthUrl.toString()));
        } else {
          return;
        }

        let codeExchangePromise = this._codeExchangePromises.get(scopeString);
        if (!codeExchangePromise) {
          codeExchangePromise = promiseFromEvent(
            this._uriHandler.event,
            this.handleUri(scopes),
          );
          this._codeExchangePromises.set(scopeString, codeExchangePromise);
        }

        try {
          return await Promise.race([
            codeExchangePromise.promise,
            new Promise<string>(
              (_, reject) =>
                setTimeout(() => reject("Cancelled"), 60 * 60 * 1_000), // 60min timeout
            ),
            promiseFromEvent<any, any>(
              token.onCancellationRequested,
              (_, __, reject) => {
                reject("User Cancelled");
              },
            ).promise,
          ]);
        } finally {
          this._pendingStates = this._pendingStates.filter(
            (n) => n !== stateId,
          );
          codeExchangePromise?.cancel.fire();
          this._codeExchangePromises.delete(scopeString);
        }
      },
    );
  }

  /**
   * Handle the redirect to VS Code (after sign in from Continue)
   * @param scopes
   * @returns
   */
  private handleUri: (
    scopes: readonly string[],
  ) => PromiseAdapter<Uri, string> =
    (scopes) => async (uri, resolve, reject) => {
      const query = new URLSearchParams(uri.query);
      const access_token = query.get("code");
      const state = query.get("state");

      if (!access_token) {
        reject(new Error("No token"));
        return;
      }
      if (!state) {
        reject(new Error("No state"));
        return;
      }

      // Check if it is a valid auth request started by the extension
      if (!this._pendingStates.some((n) => n === state)) {
        reject(new Error("State not found"));
        return;
      }

      resolve(access_token);
    };

  /**
   * Get the user info from WorkOS
   * @param token
   * @returns
   */
  private async getUserInfo(
    token: string,
    codeVerifier: string,
    hubEnv: HubEnv,
  ) {
    const resp = await fetch(
      "https://api.workos.com/user_management/authenticate",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          client_id: hubEnv.WORKOS_CLIENT_ID,
          code_verifier: codeVerifier,
          grant_type: "authorization_code",
          code: token,
        }),
      },
    );
    const text = await resp.text();
    const data = JSON.parse(text);
    return data;
  }
}

export async function getControlPlaneSessionInfo(
  silent: boolean,
  useOnboarding: boolean,
): Promise<ControlPlaneSessionInfo | undefined> {
  if (!isHubEnv(controlPlaneEnv)) {
    return {
      AUTH_TYPE: AuthType.OnPrem,
    };
  }

  try {
    if (useOnboarding) {
      WorkOsAuthProvider.useOnboardingUri = true;
    }
    await WorkOsAuthProvider.hasAttemptedRefresh;
    const session = await authentication.getSession(
      controlPlaneEnv.AUTH_TYPE,
      [],
      silent ? { silent: true } : { createIfNone: true },
    );
    if (!session) {
      return undefined;
    }
    return {
      AUTH_TYPE: controlPlaneEnv.AUTH_TYPE,
      accessToken: session.accessToken,
      account: {
        id: session.account.id,
        label: session.account.label,
      },
    };
  } finally {
    WorkOsAuthProvider.useOnboardingUri = false;
  }
}
