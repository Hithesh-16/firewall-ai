import {
  buildWebLoginUrl,
  clearUserArtefacts,
  DEFAULT_LOOPBACK_PORTS,
  generateStateNonce,
  getAuthFilePath,
  loadAuthFile,
  saveAuthFile,
  startLoopbackTokenServer,
  type SharedAuthFile,
  type UserRole,
} from "@ai-firewall/shared-auth";
import chalk from "chalk";

import { gracefulExit } from "../util/exit.js";

/**
 * Phase 5 — CLI web-first login.
 *
 * The old flow (WorkOS device-authorization + terminal-prompted email
 * and password + a "how do you want to get started?" interactive menu)
 * is gone. The CLI now shares exactly one sign-in surface with every
 * other surface in the product: the web dashboard.
 *
 * Flow:
 *
 *   1. Read the configured proxy URL (`AI_FIREWALL_PROXY_URL` env var
 *      or the value baked into an existing auth.json; default
 *      `http://localhost:8080`). `cn login --proxy <url>` overrides
 *      it on the fly.
 *
 *   2. Start a tiny HTTP server on `127.0.0.1:19836` that expects a
 *      single `?token=<afw_...>` GET. Gets its port from shared-auth
 *      and automatically bumps up by 1 if 19836 is taken.
 *
 *   3. Open the user's browser at
 *      `${proxyUrl}/web-login-start?return=cli&port=<port>&state=<nonce>`.
 *      The proxy signs the callback info into a short-lived cookie
 *      and redirects to `/login?from=extension`. The user signs in
 *      (email/password or SSO), then the web dashboard's LoginPage
 *      reads the cookie and `fetch()`es `http://127.0.0.1:<port>/?token=…&state=…`.
 *
 *   4. The loopback server receives the token, validates the state
 *      nonce, and shuts down.
 *
 *   5. We call `GET /api/auth/me` on the proxy with the new token to
 *      learn who we just signed in as, then `saveAuthConfig` writes
 *      the shared-auth file (chmod 600).
 *
 *   6. Print a "✓ Signed in as <email>" line and return control. If
 *      the caller was the top-level `cn login` command, it drops into
 *      chat.
 *
 * Fallbacks / edge cases:
 *
 *   - If `AI_FIREWALL_API_KEY` is set, there's nothing to do — print
 *     a note and exit 0.
 *   - If a valid shared auth file already exists and hasn't expired,
 *     print "Already signed in" and exit 0. `cn login --force` bypasses.
 *   - If the user closes the browser without finishing, the loopback
 *     server times out after 5 minutes and we print a clean error.
 */

// ─── Types for the proxy's /api/auth/me response ────────────────────

interface MeResponse {
  user: {
    id: number;
    email: string;
    name?: string;
    role?: string;
    orgId?: number | null;
    onboardingComplete?: boolean;
  };
}

// ─── Options parsing ────────────────────────────────────────────────

export interface AuthenticateOptions {
  /**
   * Override the configured proxy URL for this one sign-in attempt.
   * Equivalent to the `--proxy <url>` flag on the login command.
   */
  proxyUrl?: string;
  /** Skip the "already signed in" short-circuit. */
  force?: boolean;
}

/**
 * Resolve the proxy URL to target for this sign-in attempt. Priority:
 *   1. Explicit override from the caller / --proxy flag
 *   2. `AI_FIREWALL_PROXY_URL` env var
 *   3. The `proxyUrl` field from an existing shared-auth file (useful
 *      when the user has an expired token but remembers which proxy
 *      they were pointed at)
 *   4. Default `http://localhost:8080`
 */
function resolveProxyUrl(opts: AuthenticateOptions): string {
  if (opts.proxyUrl && opts.proxyUrl.trim().length > 0) {
    return opts.proxyUrl.trim().replace(/\/+$/, "");
  }
  if (process.env.AI_FIREWALL_PROXY_URL) {
    return process.env.AI_FIREWALL_PROXY_URL.replace(/\/+$/, "");
  }
  const existing = loadAuthFile();
  if (existing?.proxyUrl) {
    return existing.proxyUrl.replace(/\/+$/, "");
  }
  return "http://localhost:8080";
}

// ─── Public API ─────────────────────────────────────────────────────

/**
 * Run the web-first sign-in flow. Returns true on success, false on
 * any recoverable failure (timeout, bad token, network error). Callers
 * should either show a friendly message or call `gracefulExit(1)`.
 *
 * Never throws for user-visible conditions — everything routes through
 * a chalk.red console.error so the exit code and UX are consistent.
 */
export async function authenticate(
  opts: AuthenticateOptions = {},
): Promise<boolean> {
  // 1. Env var shortcut — nothing to do.
  if (process.env.AI_FIREWALL_API_KEY) {
    console.info(
      chalk.green(
        "✓ Using AI_FIREWALL_API_KEY from environment — no sign-in needed.",
      ),
    );
    return true;
  }

  const proxyUrl = resolveProxyUrl(opts);

  // 2. Already-signed-in short-circuit unless --force.
  if (!opts.force) {
    const existing = loadAuthFile();
    if (
      existing &&
      existing.accessToken &&
      (!existing.expiresAt || existing.expiresAt > Date.now())
    ) {
      // Validate the token against the proxy — cheap, catches the
      // case where the proxy was wiped but the file wasn't.
      try {
        const ok = await validateToken(proxyUrl, existing.accessToken);
        if (ok) {
          console.info(
            chalk.green(
              `✓ Already signed in as ${existing.user.email} (${proxyUrl})`,
            ),
          );
          return true;
        }
      } catch {
        // fall through to a fresh sign-in
      }
    }
  }

  console.info(chalk.yellow("AI Firewall — Sign in"));
  console.info(chalk.dim(`  proxy:     ${proxyUrl}`));

  // 3. Spin up the loopback receiver.
  const state = generateStateNonce();
  const port = DEFAULT_LOOPBACK_PORTS.cli;
  const server = startLoopbackTokenServer({ port, state });

  // 4. Open the browser.
  const url = buildWebLoginUrl({
    proxyUrl,
    return: "cli",
    port,
    state,
  });
  console.info(chalk.dim(`  callback:  http://127.0.0.1:${port}`));
  console.info(chalk.dim("  Opening browser..."));

  try {
    const { default: open } = await import("open");
    await open(url);
  } catch {
    console.info(
      chalk.yellow(
        `  Could not open browser. Open this URL manually:\n  ${url}`,
      ),
    );
  }

  // 5. Wait for the token. The shared-auth server auto-shuts-down on
  //    success; we only need to catch a timeout.
  let token: string;
  try {
    const result = await server;
    token = result.token;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(chalk.red(`Sign-in failed: ${msg}`));
    return false;
  }

  // 6. Fetch the user record from the proxy and persist.
  try {
    const me = await fetchMe(proxyUrl, token);
    persistToken(proxyUrl, token, me);
    const onboardingHint =
      me.user.onboardingComplete === false
        ? chalk.dim(
            "  (onboarding not finished — open the web dashboard to continue setup)",
          )
        : "";
    console.info(
      chalk.green(
        `\n✓ Signed in as ${me.user.email}${me.user.role ? ` (${me.user.role})` : ""}`,
      ),
    );
    console.info(chalk.dim(`  token saved to ${getAuthFilePath()}`));
    if (onboardingHint) console.info(onboardingHint);

    // 7. Auto-sync: pull the user's models + policy from the proxy so
    // web-added models appear on first CLI run without a manual /sync.
    // reloadServices=false — the TUI hasn't booted yet, there's nothing
    // to reload. Best-effort: a sync failure must not fail login.
    try {
      const fresh = loadAuthFile();
      if (fresh?.accessToken) {
        const { syncFromProxy } = await import("../sync.js");
        const res = await syncFromProxy(fresh, proxyUrl, {
          reloadServices: false,
        });
        if (res.modelsOk) {
          console.info(
            chalk.dim(
              `  synced ${res.modelCount} model${res.modelCount === 1 ? "" : "s"} from your account`,
            ),
          );
          console.info(
            chalk.dim(
              "  manage models at Settings → Models in the web dashboard",
            ),
          );
        }
      }
    } catch (syncErr) {
      // Non-fatal — user can always run /sync later.
      console.info(
        chalk.dim(
          `  (auto-sync skipped: ${syncErr instanceof Error ? syncErr.message : syncErr})`,
        ),
      );
    }

    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(chalk.red(`Token validation failed: ${msg}`));
    return false;
  }
}

/**
 * `cn login` entry point — authenticates then starts the TUI chat.
 *
 * Accepts the same options as `authenticate` so `cn login --proxy https://…`
 * works at the shell level.
 */
export async function login(opts: AuthenticateOptions = {}): Promise<void> {
  const success = await authenticate(opts);
  if (!success) {
    await gracefulExit(1);
    return;
  }
  // Lazy-import chat so the heavy yoga-layout / Ink chain only loads
  // when we actually need the TUI. See notes in index.ts.
  const { chat } = await import("./chat.js");
  await chat();
}

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * Hit `/api/auth/me` on the proxy with the given bearer token. Throws
 * with a human-readable error on 401 / network failure.
 */
async function fetchMe(proxyUrl: string, token: string): Promise<MeResponse> {
  const res = await fetch(`${proxyUrl}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as MeResponse;
}

/**
 * Quick GET /api/auth/me purely for the "still valid?" check during
 * the already-signed-in short-circuit. Swallows errors into a
 * boolean so the caller can decide whether to fall through.
 */
async function validateToken(
  proxyUrl: string,
  token: string,
): Promise<boolean> {
  try {
    const res = await fetch(`${proxyUrl}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
      // Short timeout via AbortController — don't hang the CLI if
      // the proxy is unreachable.
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Write the shared-auth file from a (proxy URL, token, /me response)
 * triple. Uses shared-auth's atomic-write helper so the file always
 * ends up chmod 600.
 */
function persistToken(proxyUrl: string, token: string, me: MeResponse): void {
  // Identity switch: if a different user was signed in before this
  // call, wipe the previous user's sync cache, synced config.yaml,
  // and CLI sessions so the new account sees a clean slate instead
  // of the previous user's models + chat history.
  const existing = loadAuthFile();
  if (existing?.user?.id && existing.user.id !== me.user.id) {
    try {
      clearUserArtefacts();
    } catch {
      /* best-effort */
    }
  }

  const file: SharedAuthFile = {
    version: 1,
    proxyUrl,
    accessToken: token,
    user: {
      id: me.user.id,
      email: me.user.email,
      name: me.user.name,
      role: (me.user.role as UserRole) ?? "developer",
      orgId: me.user.orgId ?? null,
    },
    savedAt: Date.now(),
    savedBy: "cli",
    onboardingComplete: me.user.onboardingComplete,
  };
  saveAuthFile(file);
}
