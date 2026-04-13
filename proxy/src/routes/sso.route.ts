import crypto from "node:crypto";
import { FastifyInstance, FastifyRequest } from "fastify";
import db from "../db/database";
import {
  exchangeCodeForProfile,
  findOrCreateSSOUser,
  getAuthorizationUrl,
  getSSOConfig,
} from "../auth/ssoService";
import { decodeCookie } from "./webLoginBridge.route";

// Name of the HMAC-signed cookie set by /web-login-start so each
// extension knows where to deliver the token once sign-in completes.
// Must stay in sync with webLoginBridge.route.ts.
const EXT_RETURN_COOKIE = "afw_ext_return";

interface ExtReturn {
  return: "cli" | "vscode" | "jetbrains";
  callback?: string;
  port?: number;
  state?: string | null;
  createdAt?: number;
}

/**
 * Read the HMAC-signed `afw_ext_return` cookie — set by
 * /web-login-start when an extension kicks off the sign-in. Returns
 * null when absent, tampered with, or not destined for one of the
 * known extension channels.
 *
 * This is the bridge that lets Google / GitHub / Microsoft SSO
 * complete directly into VS Code / CLI / JetBrains. Without it,
 * the SSO popup's only delivery channel is
 * `window.opener.postMessage`, which is unreliable: modern
 * browsers strip `window.opener` across cross-origin navigations
 * when COOP is enabled, and the dev build of the web dashboard
 * runs on :5174 while the proxy runs on :8080, so the popup has
 * to cross origins anyway to get a message back to the opener.
 */
function readExtReturn(request: FastifyRequest): ExtReturn | null {
  const rawCookie = request.headers.cookie || "";
  const match = rawCookie
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${EXT_RETURN_COOKIE}=`));
  if (!match) return null;
  const raw = match.substring(EXT_RETURN_COOKIE.length + 1);
  const decoded = decodeCookie<ExtReturn>(raw);
  if (!decoded) return null;
  if (
    decoded.return !== "vscode" &&
    decoded.return !== "cli" &&
    decoded.return !== "jetbrains"
  ) {
    return null;
  }
  return decoded;
}

/**
 * Compose the concrete callback URL the SSO popup should navigate
 * to after the server has minted a bearer token. Returns `null`
 * when the SSO flow wasn't initiated from an extension (i.e. the
 * user opened the web dashboard directly and clicked Google).
 */
function buildExtensionCallback(
  ext: ExtReturn | null,
  token: string,
): string | null {
  if (!ext) return null;
  const stateSuffix = ext.state
    ? `&state=${encodeURIComponent(ext.state)}`
    : "";

  if (ext.return === "vscode") {
    if (!ext.callback) return null;
    return `${ext.callback}?token=${encodeURIComponent(token)}${stateSuffix}`;
  }

  // CLI + JetBrains both use a loopback HTTP server on 127.0.0.1
  // that the extension spun up before opening the browser.
  if (ext.port && Number.isInteger(ext.port)) {
    return `http://127.0.0.1:${ext.port}/?token=${encodeURIComponent(token)}${stateSuffix}`;
  }
  return null;
}

/**
 * Escape a string so it's safe to embed inside a single-quoted
 * JavaScript literal in the SSO callback HTML. Prevents a
 * reflected-XSS hole if we ever inject user-controlled data
 * (emails, tokens) into the inline <script>. The token is
 * generated server-side so it's already narrow, but we apply
 * the same treatment to everything we interpolate.
 */
function escapeJsString(input: string): string {
  return input
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e");
}

// ── SSO State Store (DB-backed, survives proxy restart) ───────────────

function createSSOState(provider?: string): string {
  const state = crypto.randomBytes(16).toString("hex");
  const now = Date.now();
  const expiresAt = now + 600_000; // 10 min TTL

  db.prepare(
    "INSERT OR REPLACE INTO sso_pending_states (state, provider, created_at, expires_at) VALUES (?, ?, ?, ?)",
  ).run(state, provider ?? null, now, expiresAt);

  // Cleanup expired states
  db.prepare("DELETE FROM sso_pending_states WHERE expires_at < ?").run(now);

  return state;
}

function validateAndConsumeSSOState(state: string): boolean {
  const row = db
    .prepare(
      "SELECT state FROM sso_pending_states WHERE state = ? AND expires_at > ?",
    )
    .get(state, Date.now()) as { state: string } | undefined;

  if (!row) return false;

  db.prepare("DELETE FROM sso_pending_states WHERE state = ?").run(state);
  return true;
}

export async function registerSSORoutes(app: FastifyInstance): Promise<void> {
  /**
   * GET /api/auth/sso/login
   * Redirects the user to the SSO provider's authorization page.
   */
  app.get("/api/auth/sso/login", async (request, reply) => {
    const { provider } = request.query as { provider?: string };
    const config = getSSOConfig(provider);
    if (!config) {
      return reply.status(501).send({
        error: `SSO not configured for ${provider || "default"}. Set SSO_${(provider || "").toUpperCase()}_CLIENT_ID and SSO_${(provider || "").toUpperCase()}_CLIENT_SECRET env vars (or SSO_CLIENT_ID / SSO_CLIENT_SECRET).`,
      });
    }

    const state = createSSOState(provider);
    const url = getAuthorizationUrl(config, state);
    return reply.redirect(url);
  });

  /**
   * GET /api/auth/sso/callback
   * Handles the OAuth callback, exchanges code for token, creates/finds user.
   */
  app.get("/api/auth/sso/callback", async (request, reply) => {
    const config = getSSOConfig();
    if (!config) {
      return reply.status(501).send({ error: "SSO not configured" });
    }

    const { code, state } = request.query as {
      code?: string;
      state?: string;
    };

    if (!code || !state) {
      return reply
        .status(400)
        .send({ error: "Missing code or state parameter" });
    }

    // Validate state for CSRF protection (DB-backed, survives restart)
    if (!validateAndConsumeSSOState(state)) {
      return reply
        .status(403)
        .send({ error: "Invalid or expired state parameter" });
    }

    try {
      const profile = await exchangeCodeForProfile(config, code);
      const { user, token } = findOrCreateSSOUser(profile);

      // ── Extension handoff (primary channel) ────────────────────────
      //
      // If /web-login-start set the afw_ext_return cookie before
      // this SSO round-trip began, deliver the token straight to
      // the extension using the same channel as email/password
      // sign-in: a vscode://…/authCallback URI for VS Code, or a
      // 127.0.0.1:<port> fetch for CLI/JetBrains. We do this in the
      // rendered HTML (not a server-side 302) so that:
      //   1. The vscode:// scheme reliably launches the protocol
      //      handler — some browsers block 302 redirects to custom
      //      schemes but will happily navigate to one via JS.
      //   2. The user sees a confirmation page before the redirect,
      //      so SSO failures are obvious instead of silent.
      //   3. The `window.opener.postMessage` fallback still runs
      //      for flows that weren't initiated via /web-login-start
      //      (e.g. a user who opened the web dashboard directly and
      //      clicked Google).
      const extReturn = readExtReturn(request);
      const extCallback = buildExtensionCallback(extReturn, token);

      // Clear the cookie so a stale cookie from a previous sign-in
      // can't hijack the next unrelated SSO attempt.
      if (extReturn) {
        reply.header(
          "Set-Cookie",
          `${EXT_RETURN_COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`,
        );
      }

      const safeName = escapeJsString(user.name ?? "");
      const safeEmail = escapeJsString(user.email ?? "");
      const safeRole = escapeJsString(user.role ?? "");
      const safeToken = escapeJsString(token);
      const safeCallback = extCallback ? escapeJsString(extCallback) : null;

      return reply.type("text/html").send(`
        <!DOCTYPE html>
        <html>
        <head><title>AI Firewall - Login Successful</title></head>
        <body style="font-family: system-ui; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #0f172a; color: #e2e8f0;">
          <div style="text-align: center;">
            <div style="width: 64px; height: 64px; background: #059669; border-radius: 16px; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 16px;">
              <span style="color: white; font-size: 24px; font-weight: bold;">AF</span>
            </div>
            <h2>Welcome, ${safeName}!</h2>
            <p>You are now logged in as <strong>${safeEmail}</strong> (${safeRole})</p>
            <p style="font-size: 12px; color: #94a3b8;" id="status">Redirecting back to your IDE…</p>
            <script>
              (function () {
                var token = '${safeToken}';
                var extCallback = ${safeCallback ? `'${safeCallback}'` : "null"};

                // Primary: cookie-signed extension callback.
                if (extCallback) {
                  try {
                    window.location.replace(extCallback);
                    return;
                  } catch (e) { /* fall through */ }
                }

                // Secondary: best-effort opener postMessage for flows
                // that didn't start from /web-login-start.
                try {
                  if (window.opener) {
                    window.opener.postMessage(
                      { type: 'afw-sso-token', token: token },
                      '*'
                    );
                  }
                } catch (e) { /* ignore */ }

                // Tertiary: CLI loopback on the legacy hardcoded port
                // (kept for older CLI builds that don't set a cookie).
                try {
                  fetch('http://127.0.0.1:19836/?token=' + encodeURIComponent(token)).catch(function () {});
                } catch (e) { /* ignore */ }

                var s = document.getElementById('status');
                if (s) s.textContent = 'You can close this window.';
                setTimeout(function () { window.close(); }, 2000);
              })();
            </script>
          </div>
        </body>
        </html>
      `);
    } catch (err: any) {
      return reply.status(500).send({
        error: "SSO authentication failed",
        details: err.message,
      });
    }
  });

  /**
   * GET /api/auth/sso/config
   * Returns whether SSO is enabled and which provider.
   */
  app.get("/api/auth/sso/config", async () => {
    const providers: string[] = [];
    for (const p of ["google", "github", "microsoft", "oidc"] as const) {
      if (getSSOConfig(p)) providers.push(p);
    }
    // Also check default config
    const defaultConfig = getSSOConfig();
    if (defaultConfig && !providers.includes(defaultConfig.provider)) {
      providers.push(defaultConfig.provider);
    }
    return {
      enabled: providers.length > 0,
      provider: defaultConfig?.provider ?? null,
      providers,
    };
  });
}
