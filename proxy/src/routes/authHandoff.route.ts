import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  saveAuthFile,
  loadAuthFile,
  deleteAuthFile,
  getAuthFilePath,
  type SharedAuthFile,
  type AuthSource,
} from "@ai-firewall/shared-auth";
import { requireAuth } from "../auth/authMiddleware";
import { env } from "../config";

/**
 * Auth Handoff routes — the "bonus" channel that makes a single web sign-in
 * automatically work across every local tool on the user's machine.
 *
 * When the proxy is running on loopback (localhost), the web dashboard can
 * POST /api/auth/handoff right after a successful sign-in. This writes
 * ~/.ai-firewall/auth.json (chmod 600) with the current bearer token plus
 * user info, so every Node extension (CLI, VS Code host) that starts later
 * can adopt the token without an extra sign-in prompt.
 *
 * These endpoints are DISABLED when the proxy binds to a public address —
 * writing a file on a remote server doesn't help the user's laptop, and
 * exposing a filesystem-write endpoint on a public interface is a bad idea.
 *
 * The primary channel (per-extension loopback/URI-handler) still works fine
 * in remote-proxy mode; only the file shortcut is local-only.
 */

type HandoffBody = {
  source?: AuthSource;
};

function isLoopbackRequest(request: FastifyRequest): boolean {
  const ip = request.ip || "";
  return (
    ip === "127.0.0.1" ||
    ip === "::1" ||
    ip === "::ffff:127.0.0.1" ||
    ip.startsWith("127.")
  );
}

/**
 * Handoff is allowed when the incoming request came from loopback
 * (i.e. the browser running on the same machine as the proxy).
 *
 * Overridable via AI_FIREWALL_LOCAL_HANDOFF env var:
 *   "1" → force enable (dev/test only, dangerous for remote deployments)
 *   "0" → force disable
 *   unset → auto-detect based on the request's source IP
 *
 * Remote proxy deployments will naturally refuse handoff because the
 * browser request lands with a non-loopback X-Forwarded-For / request.ip.
 */
function handoffEnabled(request: FastifyRequest): boolean {
  const explicit = process.env.AI_FIREWALL_LOCAL_HANDOFF;
  if (explicit === "1") return true;
  if (explicit === "0") return false;
  return isLoopbackRequest(request);
}

function refuseRemote(reply: FastifyReply): void {
  reply.status(403).send({
    error: "handoff_disabled",
    message:
      "Auth handoff is only available when the proxy is running locally. " +
      "Remote proxy deployments must use the per-extension sign-in flow.",
  });
}

export async function registerAuthHandoffRoutes(
  app: FastifyInstance,
): Promise<void> {
  /**
   * POST /api/auth/handoff
   *
   * Writes ~/.ai-firewall/auth.json with the current bearer token + user
   * context, so every locally-installed extension can pick it up on next
   * launch without another round-trip to the browser.
   *
   * Body: { source?: "web" | "cli" | "vscode" | "jetbrains" }  (default "web")
   */
  app.post(
    "/api/auth/handoff",
    { preHandler: requireAuth },
    async (request, reply) => {
      if (!handoffEnabled(request)) {
        return refuseRemote(reply);
      }

      const ctx = request.authContext!;
      const body = (request.body || {}) as HandoffBody;

      const proxyUrl =
        process.env.AI_FIREWALL_PUBLIC_URL ||
        `http://localhost:${env.PORT || 8080}`;

      // We don't have a cheap way to read users.onboarding_complete from
      // the authContext today — the auth middleware only resolves a minimal
      // user snapshot. Best-effort: leave it undefined and let the web UI
      // refresh it on next /api/auth/me. Phase 2 extends this.
      const file: SharedAuthFile = {
        version: 1,
        proxyUrl,
        accessToken: ctx.rawToken,
        user: {
          id: ctx.user.id,
          email: ctx.user.email,
          name: ctx.user.name ?? undefined,
          role: ctx.user.role,
          orgId: ctx.user.orgId ?? null,
        },
        expiresAt: ctx.token.expiresAt ?? undefined,
        savedAt: Date.now(),
        savedBy: body.source || "web",
      };

      try {
        saveAuthFile(file);
      } catch (err) {
        return reply.status(500).send({
          error: "handoff_write_failed",
          message:
            err instanceof Error
              ? err.message
              : "Failed to write shared auth file.",
        });
      }

      return {
        ok: true,
        path: getAuthFilePath(),
        savedBy: file.savedBy,
        savedAt: file.savedAt,
      };
    },
  );

  /**
   * GET /api/auth/handoff/status
   *
   * Extensions poll this to know whether a valid shared-file token exists.
   * Public (no auth) because the extension asking is typically not yet
   * authenticated — that's the whole point of the poll.
   *
   * Loopback-only, same as POST.
   */
  app.get("/api/auth/handoff/status", async (request, reply) => {
    if (!handoffEnabled(request)) {
      return refuseRemote(reply);
    }

    const file = loadAuthFile();
    if (!file) {
      return {
        present: false,
        email: null,
        savedAt: null,
        savedBy: null,
        proxyUrl: null,
      };
    }
    return {
      present: true,
      email: file.user.email,
      savedAt: file.savedAt,
      savedBy: file.savedBy,
      proxyUrl: file.proxyUrl,
    };
  });

  /**
   * DELETE /api/auth/handoff
   *
   * Called by every Sign Out flow (web, CLI, VS Code, JetBrains) to clear
   * the shared file after the token has been revoked on the server.
   */
  app.delete(
    "/api/auth/handoff",
    { preHandler: requireAuth },
    async (request, reply) => {
      if (!handoffEnabled(request)) {
        return refuseRemote(reply);
      }

      try {
        deleteAuthFile();
      } catch (err) {
        return reply.status(500).send({
          error: "handoff_delete_failed",
          message:
            err instanceof Error ? err.message : "Failed to delete file.",
        });
      }

      return { ok: true };
    },
  );
}
