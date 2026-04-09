import * as vscode from "vscode";

import {
  buildWebLoginUrl,
  deleteAuthFile,
  generateStateNonce,
  loadAuthFile,
  saveAuthFile,
  type SharedAuthFile,
  type UserRole,
} from "@ai-firewall/shared-auth";

/**
 * AI Firewall auth service for VS Code.
 *
 * Responsibilities (Phase 6):
 *   1. Store the bearer token in VS Code `SecretStorage` (encrypted,
 *      survives restarts, scoped to the extension).
 *   2. Fall back to the shared `~/.ai-firewall/auth.json` file written
 *      by `cn login` / `jetbrains` so a user who signs in on the CLI
 *      doesn't need to re-sign in VS Code.
 *   3. Kick off a web-first sign-in using the proxy's `/web-login-start`
 *      bridge and a `vscode://ai-firewall.ai-firewall/authCallback`
 *      URI. The proxy signs the return info into the `?ext=<payload>`
 *      query param, the web LoginPage decodes it, and after a
 *      successful sign-in the web posts to this URI. VS Code's
 *      built-in `UriHandler` delivers the URI to this service, which
 *      validates the state nonce and stores the token.
 *   4. Support sign-out: clears SecretStorage, deletes the shared
 *      auth file (best-effort), fires a `onDidChangeAuth` event so
 *      downstream consumers can tear down authenticated state.
 *
 * This class does NOT talk to `WorkOsAuthProvider` — that's the
 * legacy device-auth provider we're replacing. It only ever hits the
 * proxy and the shared-auth file, both of which are under our
 * control.
 */

const SECRET_KEY = "aiFirewall.authToken.v1";

// How long to wait for the web callback before giving up.
const SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000;

export interface AiFirewallAuthState {
  signedIn: boolean;
  user?: {
    id: number;
    email: string;
    name?: string;
    role?: UserRole;
    orgId?: number | null;
  };
  token?: string;
  proxyUrl?: string;
}

interface PendingSignIn {
  state: string;
  resolve: (token: string) => void;
  reject: (err: Error) => void;
  timeoutHandle: NodeJS.Timeout;
}

export class AiFirewallAuthService {
  private readonly _onDidChangeAuth =
    new vscode.EventEmitter<AiFirewallAuthState>();
  public readonly onDidChangeAuth = this._onDidChangeAuth.event;

  private state: AiFirewallAuthState = { signedIn: false };
  private pending: PendingSignIn | null = null;

  constructor(private readonly context: vscode.ExtensionContext) {}

  /**
   * Bootstrap the auth service: try SecretStorage first, then fall
   * back to the shared-auth file on disk (so users who signed in via
   * `cn login` are automatically signed in here too). Fires
   * `onDidChangeAuth` exactly once at the end.
   */
  async initialize(): Promise<AiFirewallAuthState> {
    try {
      const storedJson = await this.context.secrets.get(SECRET_KEY);
      if (storedJson) {
        const stored = JSON.parse(storedJson) as SharedAuthFile;
        this.state = this.fromSharedFile(stored);
        this._onDidChangeAuth.fire(this.state);
        return this.state;
      }

      const shared = loadAuthFile();
      if (shared && shared.accessToken) {
        // Copy the shared file into SecretStorage so future reads are
        // local. We keep the shared file around — it's still the
        // source of truth for the CLI and JetBrains.
        await this.context.secrets.store(SECRET_KEY, JSON.stringify(shared));
        this.state = this.fromSharedFile(shared);
      }
    } catch (err) {
      // Non-fatal: auth is best-effort on boot. The user can always
      // run `AI Firewall: Sign In` to recover.
      console.warn(
        "[AiFirewallAuthService] initialize failed:",
        err instanceof Error ? err.message : err,
      );
    }

    this._onDidChangeAuth.fire(this.state);
    return this.state;
  }

  getState(): AiFirewallAuthState {
    return this.state;
  }

  isSignedIn(): boolean {
    return this.state.signedIn;
  }

  getToken(): string | undefined {
    return this.state.token;
  }

  /**
   * Resolve the proxy URL to target for sign-in. Priority:
   *   1. Current in-memory state (user already targeted a proxy)
   *   2. `aiFirewall.proxyUrl` workspace/global setting
   *   3. Default `http://localhost:8080`
   */
  private resolveProxyUrl(): string {
    if (this.state.proxyUrl) return this.state.proxyUrl;
    const cfg = vscode.workspace.getConfiguration("aiFirewall");
    const fromSetting = cfg.get<string>("proxyUrl");
    if (fromSetting && fromSetting.trim().length > 0) {
      return fromSetting.replace(/\/+$/, "");
    }
    return "http://localhost:8080";
  }

  /**
   * Build the VS Code callback URI that the web dashboard should post
   * the token to. We use `vscode.env.asExternalUri` so Remote/Codespaces
   * get a tunneled https:// URL instead of an un-resolvable
   * vscode:// URI.
   */
  private async buildCallbackUri(): Promise<vscode.Uri> {
    const raw = vscode.Uri.parse(
      "vscode://ai-firewall.ai-firewall/authCallback",
    );
    try {
      return await vscode.env.asExternalUri(raw);
    } catch {
      return raw;
    }
  }

  /**
   * Kick off the web-first sign-in flow. Opens the browser, waits for
   * the URI handler to deliver a `?token=...&state=...` callback, then
   * fetches `/api/auth/me` to build the user record.
   */
  async signIn(): Promise<AiFirewallAuthState> {
    if (this.pending) {
      throw new Error("Sign-in already in progress");
    }

    // Short-circuit: if the user is already signed in (via CLI,
    // web, or a previous VS Code session), validate the token
    // and return immediately without opening the browser.
    if (this.state.signedIn && this.state.token) {
      const proxyUrl = this.resolveProxyUrl();
      try {
        const res = await fetch(`${proxyUrl}/api/auth/me`, {
          headers: { Authorization: `Bearer ${this.state.token}` },
        });
        if (res.ok) {
          return this.state; // already valid
        }
      } catch {
        // Proxy unreachable or token invalid — fall through to
        // the browser flow so the user can re-authenticate.
      }
    }

    // Also check the shared auth file — the user may have signed
    // in via `cn login` or the web dashboard without VS Code knowing.
    const sharedAuthOnDisk = loadAuthFile();
    if (sharedAuthOnDisk?.accessToken) {
      const proxyUrl2 = this.resolveProxyUrl();
      try {
        const res2 = await fetch(`${proxyUrl2}/api/auth/me`, {
          headers: { Authorization: `Bearer ${sharedAuthOnDisk.accessToken}` },
        });
        if (res2.ok) {
          const user2 = await this.fetchMe(
            proxyUrl2,
            sharedAuthOnDisk.accessToken,
          );
          const file2: SharedAuthFile = {
            version: sharedAuthOnDisk.version ?? 1,
            proxyUrl: sharedAuthOnDisk.proxyUrl ?? proxyUrl2,
            accessToken: sharedAuthOnDisk.accessToken,
            user: user2,
            savedAt: sharedAuthOnDisk.savedAt ?? Date.now(),
            savedBy: sharedAuthOnDisk.savedBy ?? "cli",
          };
          await this.context.secrets.store(SECRET_KEY, JSON.stringify(file2));
          this.state = this.fromSharedFile(file2);
          this._onDidChangeAuth.fire(this.state);
          return this.state;
        }
      } catch {
        // fall through to browser
      }
    }

    const proxyUrl = this.resolveProxyUrl();
    const state = generateStateNonce();
    const callbackUri = await this.buildCallbackUri();

    const signInUrl = buildWebLoginUrl({
      proxyUrl,
      return: "vscode",
      callback: callbackUri.toString(true),
      state,
    });

    // Register the pending sign-in BEFORE opening the browser so a
    // very fast callback doesn't race us.
    const tokenPromise = new Promise<string>((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        if (this.pending?.state === state) {
          this.pending = null;
          reject(new Error("Sign-in timed out"));
        }
      }, SIGN_IN_TIMEOUT_MS);
      this.pending = { state, resolve, reject, timeoutHandle };
    });

    void vscode.env.openExternal(vscode.Uri.parse(signInUrl));

    let token: string;
    try {
      token = await tokenPromise;
    } finally {
      // Cast through unknown so strict null narrowing doesn't collapse
      // `this.pending` to `never` inside the finally block after the
      // try awaits a Promise that may or may not have touched it.
      const pending = this.pending as PendingSignIn | null;
      if (pending && pending.state === state) {
        clearTimeout(pending.timeoutHandle);
        this.pending = null;
      }
    }

    // Fetch /api/auth/me to populate the user record. If this fails
    // we still reject the sign-in so the user isn't left with a
    // half-populated state.
    const user = await this.fetchMe(proxyUrl, token);

    const newAuthFile: SharedAuthFile = {
      version: 1,
      proxyUrl,
      accessToken: token,
      user,
      savedAt: Date.now(),
      savedBy: "vscode",
      onboardingComplete: undefined,
    };

    // Persist to BOTH SecretStorage (for this VS Code install) and
    // the shared file (for CLI + JetBrains). Best-effort on the
    // shared file — remote proxies / read-only homedir setups
    // shouldn't break VS Code sign-in.
    await this.context.secrets.store(SECRET_KEY, JSON.stringify(newAuthFile));
    try {
      saveAuthFile(newAuthFile);
    } catch (err) {
      console.warn(
        "[AiFirewallAuthService] saveAuthFile failed (non-fatal):",
        err instanceof Error ? err.message : err,
      );
    }

    this.state = this.fromSharedFile(newAuthFile);
    this._onDidChangeAuth.fire(this.state);
    return this.state;
  }

  /**
   * Sign out: revoke the token on the proxy (best-effort), clear
   * SecretStorage, delete the shared auth file. Always fires the
   * state-change event even if the proxy call fails — the user's
   * intent is "sign me out".
   */
  async signOut(): Promise<void> {
    const token = this.state.token;
    const proxyUrl = this.state.proxyUrl || this.resolveProxyUrl();

    if (token) {
      try {
        await fetch(`${proxyUrl}/api/auth/logout`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {
        /* proxy offline — local cleanup still runs */
      }
    }

    try {
      await this.context.secrets.delete(SECRET_KEY);
    } catch {
      /* ignore */
    }
    try {
      deleteAuthFile();
    } catch {
      /* ignore */
    }

    this.state = { signedIn: false };
    this._onDidChangeAuth.fire(this.state);
  }

  /**
   * Called by the URI handler when a callback arrives. Validates the
   * state nonce and resolves the pending sign-in promise. Returns
   * true if the URI was consumed, false otherwise.
   */
  handleCallbackUri(uri: vscode.Uri): boolean {
    if (uri.path !== "/authCallback") return false;
    if (!this.pending) return false;

    const params = new URLSearchParams(uri.query);
    const token = params.get("token");
    const state = params.get("state");

    if (!token) {
      this.pending.reject(new Error("Auth callback missing ?token="));
      this.pending = null;
      return true;
    }
    if (state !== this.pending.state) {
      this.pending.reject(new Error("Auth callback state mismatch"));
      this.pending = null;
      return true;
    }

    this.pending.resolve(token);
    return true;
  }

  dispose(): void {
    if (this.pending) {
      clearTimeout(this.pending.timeoutHandle);
      this.pending.reject(new Error("Extension shutting down"));
      this.pending = null;
    }
    this._onDidChangeAuth.dispose();
  }

  // ─── helpers ──────────────────────────────────────────────────────

  private fromSharedFile(file: SharedAuthFile): AiFirewallAuthState {
    return {
      signedIn: !!file.accessToken,
      token: file.accessToken,
      proxyUrl: file.proxyUrl,
      user: file.user
        ? {
            id: file.user.id,
            email: file.user.email,
            name: file.user.name,
            role: file.user.role,
            orgId: file.user.orgId ?? null,
          }
        : undefined,
    };
  }

  private async fetchMe(
    proxyUrl: string,
    token: string,
  ): Promise<SharedAuthFile["user"]> {
    const res = await fetch(`${proxyUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new Error(
        `GET /api/auth/me failed: ${res.status} ${res.statusText}`,
      );
    }
    const body = (await res.json()) as {
      user: {
        id: number;
        email: string;
        name?: string;
        role?: string;
        orgId?: number | null;
      };
    };
    return {
      id: body.user.id,
      email: body.user.email,
      name: body.user.name,
      role: (body.user.role as UserRole) ?? "developer",
      orgId: body.user.orgId ?? null,
    };
  }
}
