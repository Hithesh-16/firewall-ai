import { FastifyInstance } from "fastify";
import { env } from "../config";

/**
 * GET /api/public/config
 *
 * Tiny PUBLIC endpoint extensions hit on first contact to learn:
 *   - the URL of the web dashboard (where to send users to sign in)
 *   - whether SSO is enabled and which providers
 *   - the proxy version
 *
 * No authentication required — extensions call this BEFORE they have a
 * token. The response intentionally contains nothing sensitive.
 */
export async function registerPublicConfigRoute(
  app: FastifyInstance,
): Promise<void> {
  app.get("/api/public/config", async (_request) => {
    // Dashboard URL resolution:
    //   - Explicit env override wins (prod deployments).
    //   - Otherwise, dev convention: dashboard runs on its own Vite server
    //     at port 5174 on the same host as the proxy.
    //   - In single-binary mode (proxy serves the dashboard via
    //     fastify-static), the URL is the same as the proxy URL — but
    //     we still report :5174 so dev mode works out of the box. Set
    //     AI_FIREWALL_DASHBOARD_URL in prod to override.
    const dashboardUrl =
      process.env.AI_FIREWALL_DASHBOARD_URL ||
      `http://localhost:5174`;

    const proxyUrl =
      process.env.AI_FIREWALL_PUBLIC_URL ||
      `http://localhost:${env.PORT || 8080}`;

    // SSO providers — mirror what /api/auth/sso/config exposes, so
    // extensions don't need to call two endpoints during sign-in.
    const ssoProviders: string[] = [];
    for (const p of ["google", "github", "microsoft", "oidc"]) {
      const id = process.env[`SSO_${p.toUpperCase()}_CLIENT_ID`];
      const secret = process.env[`SSO_${p.toUpperCase()}_CLIENT_SECRET`];
      if (id && secret) ssoProviders.push(p);
    }
    // Default catch-all (SSO_CLIENT_ID / SSO_CLIENT_SECRET)
    if (
      ssoProviders.length === 0 &&
      process.env.SSO_CLIENT_ID &&
      process.env.SSO_CLIENT_SECRET &&
      process.env.SSO_PROVIDER
    ) {
      ssoProviders.push(process.env.SSO_PROVIDER);
    }

    return {
      proxyUrl,
      dashboardUrl,
      version: process.env.AI_FIREWALL_VERSION || "0.0.0-dev",
      sso: {
        enabled: ssoProviders.length > 0,
        providers: ssoProviders,
      },
      // Static feature flags clients use to render the right UI.
      features: {
        localHandoff: true, // always advertised; the endpoint itself enforces loopback
        webOnlyAuth: true,
      },
    };
  });
}
