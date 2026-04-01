/**
 * Rate Limit Middleware
 *
 * Fastify preHandler hook that enforces per-user rate limits.
 * Reuses the existing checkRateLimit() from orgPolicy.ts which
 * queries the rate_limits table and counts recent requests.
 *
 * Returns 429 with standard rate limit headers when exceeded.
 */

import type { FastifyRequest, FastifyReply } from "fastify";
import { checkRateLimit } from "../policy/orgPolicy";

export function createRateLimitHook() {
  return async function rateLimitHook(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    const ctx = request.authContext;
    if (!ctx) return; // requireAuth already rejected if missing

    const result = checkRateLimit(ctx.user.id);

    reply.header("X-RateLimit-Limit", String(result.limit));
    reply.header("X-RateLimit-Remaining", String(result.remaining));
    reply.header("X-RateLimit-Reset", String(result.resetInSeconds));

    if (!result.allowed) {
      return reply.status(429).send({
        error: "Rate limit exceeded",
        code: "RATE_LIMITED",
        limit: result.limit,
        remaining: 0,
        retryAfterSeconds: result.resetInSeconds,
      });
    }
  };
}
