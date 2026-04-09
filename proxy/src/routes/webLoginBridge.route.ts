import { FastifyInstance } from "fastify";
import crypto from "node:crypto";
import { env } from "../config";

/**
 * Web-login bridge — the single entrypoint every extension uses to launch
 * a web-based sign-in.
 *
 * Flow:
 *   1. Extension opens ${proxyUrl}/web-login-start?return=cli&port=19836
 *      (or &callback=vscode://publisher.ext/authCallback for VS Code)
 *   2. This route signs the callback params into a short-lived HMAC'd
 *      cookie (`afw_ext_return`, 10-minute TTL) and 302-redirects the
 *      browser to the web dashboard's /login page with ?from=extension.
 *   3. The web dashboard renders LoginPage. After successful sign-in it
 *      reads the cookie via `/api/auth/ext-callback` (see auth.route.ts
 *      in Phase 2) and delivers the token via:
 *        - CLI / JetBrains  → fetch('http://127.0.0.1:<port>/?token=...')
 *        - VS Code          → window.location.replace('vscode://.../?token=...')
 *
 * Centralising this in the proxy keeps the redirect logic server-side
 * and lets us add new return channels (mobile, other IDEs) without
 * touching every extension client.
 *
 * The cookie is HMAC'd with the proxy's MASTER_KEY so a malicious web
 * dashboard (or CSRF attacker) can't spoof the callback target.
 */

interface BridgeQuery {
  return?: "cli" | "vscode" | "jetbrains";
  callback?: string;
  port?: string;
  state?: string;
}

const COOKIE_NAME = "afw_ext_return";
const COOKIE_MAX_AGE_SECONDS = 10 * 60; // 10 minutes

/**
 * Allowlist of URI schemes we're willing to redirect to after login.
 * Prevents an open-redirect attack via `?callback=https://evil.com`.
 */
const ALLOWED_CALLBACK_SCHEMES = ["vscode:", "vscode-insiders:", "code:"];

function hmacSecret(): string {
  return env.MASTER_KEY || "dev-only-weak-secret-for-bridge";
}

function signPayload(payload: string): string {
  const h = crypto.createHmac("sha256", hmacSecret());
  h.update(payload);
  return h.digest("hex").slice(0, 32);
}

function encodeCookie(obj: Record<string, unknown>): string {
  const payload = Buffer.from(JSON.stringify(obj), "utf8").toString("base64url");
  const sig = signPayload(payload);
  return `${payload}.${sig}`;
}

export function decodeCookie<T = Record<string, unknown>>(
  raw: string | undefined,
): T | null {
  if (!raw) return null;
  const [payload, sig] = raw.split(".");
  if (!payload || !sig) return null;
  if (signPayload(payload) !== sig) return null;
  try {
    return JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as T;
  } catch {
    return null;
  }
}

function validateCallback(callback: string): boolean {
  try {
    const url = new URL(callback);
    return ALLOWED_CALLBACK_SCHEMES.includes(url.protocol);
  } catch {
    return false;
  }
}

function validatePort(port: string): number | null {
  const n = Number(port);
  if (!Number.isInteger(n) || n < 1024 || n > 65535) return null;
  return n;
}

function resolveDashboardUrl(): string {
  // Prod: dashboard is served from the proxy on the same host/port via
  // fastify-static. Dev: dashboard runs its own Vite server on 5174.
  //
  //   1. Explicit env override wins.
  //   2. Otherwise, in dev (NODE_ENV !== 'production') default to the
  //      standalone web dashboard on http://localhost:5174 — without
  //      this, the CLI's `/web-login-start` redirect 302s to
  //      `/login?from=extension` which the browser resolves against
  //      the proxy origin (:8080) where nothing serves the login page.
  //   3. In prod, fall through to same-origin "" so fastify-static
  //      handles it.
  if (process.env.AI_FIREWALL_DASHBOARD_URL) {
    return process.env.AI_FIREWALL_DASHBOARD_URL.replace(/\/+$/, "");
  }
  if (process.env.NODE_ENV !== "production") {
    return "http://localhost:5174";
  }
  return "";
}

export async function registerWebLoginBridgeRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.get("/web-login-start", async (request, reply) => {
    const q = request.query as BridgeQuery;

    const ret = q.return;
    if (ret !== "cli" && ret !== "vscode" && ret !== "jetbrains") {
      return reply.status(400).send({
        error: "invalid_return",
        message:
          "Query param `return` must be one of: cli, vscode, jetbrains.",
      });
    }

    // VS Code uses a URI handler; CLI + JetBrains use a loopback server.
    let callback: string | undefined;
    let port: number | undefined;

    if (ret === "vscode") {
      if (!q.callback || !validateCallback(q.callback)) {
        return reply.status(400).send({
          error: "invalid_callback",
          message:
            "VS Code return requires a `callback` param with a vscode:// URI.",
        });
      }
      callback = q.callback;
    } else {
      if (!q.port) {
        return reply.status(400).send({
          error: "missing_port",
          message:
            "CLI/JetBrains return requires a loopback `port` query param.",
        });
      }
      const parsed = validatePort(q.port);
      if (parsed === null) {
        return reply.status(400).send({
          error: "invalid_port",
          message: "Port must be an integer between 1024 and 65535.",
        });
      }
      port = parsed;
    }

    // We also still stash a signed cookie as a defence-in-depth fallback
    // for same-origin deployments (prod), but the primary handoff is now
    // via query params on the redirect URL. Cross-origin XHR with
    // SameSite=Lax cookies is dropped by browsers, which broke the dev
    // flow (web on :5174, proxy on :8080) entirely — the peek call
    // always saw `present: false` and the CLI sat at "Opening browser..."
    // forever. Passing the handoff info through the URL sidesteps the
    // cookie problem completely while keeping the HMAC integrity of the
    // signed payload (so a malicious dashboard can't fake a callback).
    const signedPayload = encodeCookie({
      return: ret,
      callback,
      port,
      state: q.state || null,
      createdAt: Date.now(),
    });

    reply.header(
      "Set-Cookie",
      `${COOKIE_NAME}=${signedPayload}; Path=/; Max-Age=${COOKIE_MAX_AGE_SECONDS}; HttpOnly; SameSite=Lax`,
    );

    const dashboard = resolveDashboardUrl();
    const qs = new URLSearchParams();
    qs.set("from", "extension");
    qs.set("ext", signedPayload);
    const target = `${dashboard}/login?${qs.toString()}`;
    return reply.redirect(target);
  });

  /**
   * GET /api/auth/ext-callback/peek
   *
   * Returns the current callback info stashed in the cookie (if any).
   * The web dashboard calls this after successful sign-in so it knows
   * where to deliver the token.
   */
  app.get("/api/auth/ext-callback/peek", async (request) => {
    const cookies = request.headers.cookie || "";
    const match = cookies
      .split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${COOKIE_NAME}=`));
    if (!match) return { present: false };

    const raw = match.substring(COOKIE_NAME.length + 1);
    const decoded = decodeCookie<{
      return: "cli" | "vscode" | "jetbrains";
      callback?: string;
      port?: number;
      state: string | null;
      createdAt: number;
    }>(raw);

    if (!decoded) return { present: false };

    // Reject stale cookies
    if (Date.now() - decoded.createdAt > COOKIE_MAX_AGE_SECONDS * 1000) {
      return { present: false };
    }

    return {
      present: true,
      return: decoded.return,
      callback: decoded.callback ?? null,
      port: decoded.port ?? null,
      state: decoded.state,
    };
  });

  /**
   * DELETE /api/auth/ext-callback
   *
   * Clears the callback cookie after the token has been delivered.
   * Prevents replay if the user opens another tab.
   */
  app.delete("/api/auth/ext-callback", async (_request, reply) => {
    reply.header(
      "Set-Cookie",
      `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`,
    );
    return { ok: true };
  });
}
