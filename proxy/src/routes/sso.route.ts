import crypto from "node:crypto";
import { FastifyInstance } from "fastify";
import db from "../db/database";
import {
  exchangeCodeForProfile,
  findOrCreateSSOUser,
  getAuthorizationUrl,
  getSSOConfig,
} from "../auth/ssoService";

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

      // Return HTML that stores the token and closes the window
      // (For browser-based SSO flow)
      // Also notify the CLI local callback server if running (port 19836)
      return reply.type("text/html").send(`
        <!DOCTYPE html>
        <html>
        <head><title>AI Firewall - Login Successful</title></head>
        <body style="font-family: system-ui; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #0f172a; color: #e2e8f0;">
          <div style="text-align: center;">
            <div style="width: 64px; height: 64px; background: #059669; border-radius: 16px; display: inline-flex; align-items: center; justify-content: center; margin-bottom: 16px;">
              <span style="color: white; font-size: 24px; font-weight: bold;">AF</span>
            </div>
            <h2>Welcome, ${user.name}!</h2>
            <p>You are now logged in as <strong>${user.email}</strong> (${user.role})</p>
            <p style="font-size: 12px; color: #94a3b8;">Your API token has been generated. You can close this window.</p>
            <script>
              // Store token for the GUI/extension to pick up
              if (window.opener) {
                window.opener.postMessage({ type: 'afw-sso-token', token: '${token}' }, '*');
                setTimeout(() => window.close(), 2000);
              }
              // Notify the CLI local callback server if running
              fetch('http://127.0.0.1:19836/?token=${token}').catch(() => {});
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
