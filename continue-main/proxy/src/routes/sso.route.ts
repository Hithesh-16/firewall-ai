import crypto from "node:crypto";
import { FastifyInstance } from "fastify";
import {
  exchangeCodeForProfile,
  findOrCreateSSOUser,
  getAuthorizationUrl,
  getSSOConfig,
} from "../auth/ssoService";

// In-memory state store for CSRF protection (replace with Redis in production)
const pendingStates = new Map<string, { createdAt: number }>();

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

    const state = crypto.randomBytes(16).toString("hex");
    pendingStates.set(state, { createdAt: Date.now() });

    // Clean old states (>10 min)
    for (const [key, val] of pendingStates) {
      if (Date.now() - val.createdAt > 600_000) {
        pendingStates.delete(key);
      }
    }

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
      return reply.status(400).send({ error: "Missing code or state parameter" });
    }

    // Validate state for CSRF protection
    if (!pendingStates.has(state)) {
      return reply.status(403).send({ error: "Invalid or expired state parameter" });
    }
    pendingStates.delete(state);

    try {
      const profile = await exchangeCodeForProfile(config, code);
      const { user, token } = findOrCreateSSOUser(profile);

      // Return HTML that stores the token and closes the window
      // (For browser-based SSO flow)
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
            <pre style="background: #1e293b; padding: 12px; border-radius: 8px; font-size: 11px; word-break: break-all;">${token}</pre>
            <script>
              // Store token for the extension to pick up
              if (window.opener) {
                window.opener.postMessage({ type: 'afw-sso-token', token: '${token}' }, '*');
                setTimeout(() => window.close(), 2000);
              }
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
