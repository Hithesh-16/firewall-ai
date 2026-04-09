import { FastifyReply, FastifyRequest } from "fastify";
import { validateApiToken, tokenHasScope } from "./authService";
import { checkPermission } from "./rbacService";
import { AuthContext, Role, TokenScope } from "../types";

declare module "fastify" {
  interface FastifyRequest {
    authContext?: AuthContext;
  }
}

export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const header = request.headers.authorization;
  if (!header || !header.startsWith("Bearer afw_")) {
    return reply.status(401).send({ error: "Missing or invalid API token" });
  }

  const raw = header.replace("Bearer ", "");
  const result = validateApiToken(raw);

  if (!result) {
    return reply.status(401).send({ error: "Invalid or expired API token" });
  }

  // Preserve the raw bearer string on the context so downstream endpoints
  // (e.g. /api/auth/handoff) can hand it off to the local shared auth file.
  request.authContext = { ...result, rawToken: raw };
}

/**
 * Optional auth — tries to authenticate but does NOT reject on failure.
 * Sets request.authContext if valid token is present, otherwise leaves it undefined.
 * Use for endpoints that should work without auth (local IDE webview) but
 * apply role-based filtering when auth IS available.
 */
export async function optionalAuth(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  const header = request.headers.authorization;
  if (!header || !header.startsWith("Bearer afw_")) return;

  const raw = header.replace("Bearer ", "");
  const result = validateApiToken(raw);
  if (result) {
    request.authContext = { ...result, rawToken: raw };
  }
}

/**
 * Legacy role-based check. Still works — resolves to capability check
 * via user_org_roles table. Kept for backward compatibility with existing routes.
 */
export function requireRole(...allowedRoles: Role[]) {
  return async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> => {
    await requireAuth(request, reply);
    if (reply.sent) return;

    const ctx = request.authContext;
    if (!ctx || !allowedRoles.includes(ctx.user.role)) {
      return reply.status(403).send({
        error: "Insufficient permissions",
        required: allowedRoles,
        current: ctx?.user.role,
      });
    }
  };
}

/**
 * Capability-based permission check. Preferred for new routes.
 * Checks user_org_roles → role_capabilities → user_capability_overrides.
 *
 * Usage: { preHandler: [requireAuth, requireCapability("policy:write")] }
 */
export function requireCapability(capabilityName: string) {
  return async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> => {
    const ctx = request.authContext;
    if (!ctx) {
      return reply.status(401).send({ error: "Not authenticated" });
    }

    const orgId = ctx.user.orgId;
    if (!orgId) {
      return reply.status(403).send({
        error: "User has no organization. Complete onboarding first.",
        code: "NO_ORG",
      });
    }

    const result = checkPermission(ctx.user.id, orgId, capabilityName);
    if (!result.allowed) {
      return reply.status(403).send({
        error: "Permission denied",
        code: "CAPABILITY_DENIED",
        capability: capabilityName,
        reason: result.reason,
        source: result.source,
      });
    }
  };
}

/**
 * Token scope check. Validates the API token has the required scope.
 * Tokens with null scopes (legacy) or "*" pass all checks.
 *
 * Usage: { preHandler: [requireAuth, requireScope("chat:write")] }
 */
export function requireScope(scope: TokenScope) {
  return async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> => {
    const ctx = request.authContext;
    if (!ctx) {
      return reply.status(401).send({ error: "Not authenticated" });
    }

    if (!tokenHasScope(ctx.token, scope)) {
      return reply.status(403).send({
        error: "Token scope insufficient",
        code: "SCOPE_DENIED",
        required: scope,
        granted: ctx.token.scopes ?? ["*"],
      });
    }
  };
}
