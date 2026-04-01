/**
 * Feature Guard Middleware
 *
 * Fastify preHandler that checks if the current license includes a required feature.
 * Used to gate enterprise features (RBAC, SSO, compliance) behind license tiers.
 *
 * SOLID:
 * - SRP: Only checks feature access. No license verification logic.
 * - OCP: New features gated by adding requireFeature() to routes — no middleware changes.
 * - DIP: Depends on hasFeature() interface from licenseVerifier, not implementation.
 */

import type { FastifyRequest, FastifyReply } from "fastify";
import { hasFeature, getLicenseState } from "./licenseVerifier";

/**
 * Create a Fastify preHandler that gates a route behind a license feature.
 *
 * Usage:
 *   app.get("/api/sso/config", { preHandler: [requireFeature("sso:saml")] }, handler);
 *
 * Returns 403 with plan upgrade message if feature not available.
 */
export function requireFeature(feature: string) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (hasFeature(feature)) return;

    const state = getLicenseState();
    reply.status(403).send({
      error: "Feature not available in current plan",
      code: "LICENSE_FEATURE_REQUIRED",
      feature,
      currentPlan: state.plan,
      expired: state.expired,
      upgradeMessage: state.expired
        ? "Your license has expired. Security scanning continues but enterprise features require renewal."
        : `Feature "${feature}" requires a ${getRequiredPlan(feature)} plan or higher.`,
    });
  };
}

/**
 * Suggest the minimum plan for a feature.
 */
function getRequiredPlan(feature: string): string {
  // SSO, compliance, hierarchical policies = enterprise
  if (feature.startsWith("sso:") || feature.startsWith("compliance:") || feature === "policy:inheritance") {
    return "enterprise";
  }
  // RBAC, webhooks = team
  return "team";
}
