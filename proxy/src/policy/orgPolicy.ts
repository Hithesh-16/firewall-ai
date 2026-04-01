import { db } from "../db/index";
import { orgModelRules, rateLimits, logs } from "../db/schema";
import { eq, and, or, isNull, isNotNull, gt, sql } from "drizzle-orm";

export function isModelAllowedForOrg(
  orgId: number,
  modelName: string,
): { allowed: boolean; reason?: string } {
  const rules = db.select().from(orgModelRules).where(eq(orgModelRules.orgId, orgId)).all();

  if (rules.length === 0) {
    return { allowed: true };
  }

  const denyRules = rules.filter((r) => r.ruleType === "deny");
  const allowRules = rules.filter((r) => r.ruleType === "allow");

  for (const rule of denyRules) {
    if (matchesPattern(modelName, rule.modelPattern)) {
      return {
        allowed: false,
        reason: `Model "${modelName}" is denied by org policy (pattern: ${rule.modelPattern})`,
      };
    }
  }

  if (allowRules.length > 0) {
    const matches = allowRules.some((rule) =>
      matchesPattern(modelName, rule.modelPattern),
    );
    if (!matches) {
      return {
        allowed: false,
        reason: `Model "${modelName}" is not in the org allowlist`,
      };
    }
  }

  return { allowed: true };
}

function matchesPattern(modelName: string, pattern: string): boolean {
  const regex = new RegExp(
    "^" + pattern.replace(/\*/g, ".*").replace(/\?/g, ".") + "$",
    "i",
  );
  return regex.test(modelName);
}

export function addOrgModelRule(
  orgId: number,
  modelPattern: string,
  ruleType: "allow" | "deny",
): void {
  db.insert(orgModelRules).values({
    orgId,
    modelPattern,
    ruleType,
    createdAt: Date.now()
  }).run();
}

export function listOrgModelRules(orgId: number) {
  return db.select().from(orgModelRules).where(eq(orgModelRules.orgId, orgId)).all();
}

export function deleteOrgModelRule(ruleId: number): void {
  db.delete(orgModelRules).where(eq(orgModelRules.id, ruleId)).run();
}

export function checkRateLimit(
  userId: number,
): { allowed: boolean; remaining: number; limit: number; resetInSeconds: number } {
  const rule = db.select().from(rateLimits).where(
    or(
      eq(rateLimits.userId, userId),
      and(isNull(rateLimits.userId), isNotNull(rateLimits.orgId))
    )
  ).get();

  if (!rule) {
    return { allowed: true, remaining: 999, limit: 999, resetInSeconds: 0 };
  }

  const oneMinuteAgo = Date.now() - 60_000;
  
  const recentCount = db.select({ cnt: sql<number>`COUNT(*)` })
    .from(logs)
    .where(and(eq(logs.userId, userId), gt(logs.timestamp, oneMinuteAgo)))
    .get();

  const count = recentCount?.cnt ?? 0;
  const maxReq = rule.maxRequestsPerMinute ?? 30;
  
  const remaining = Math.max(0, maxReq - count);
  const allowed = remaining > 0;

  return {
    allowed,
    remaining,
    limit: maxReq,
    resetInSeconds: 60,
  };
}

export function setRateLimit(
  userId: number | null,
  orgId: number | null,
  maxRequestsPerMinute: number,
  maxTokensPerMinute: number,
): void {
  const existingCondition = (userId !== null && orgId !== null) 
    ? and(eq(rateLimits.userId, userId), eq(rateLimits.orgId, orgId))
    : userId !== null
      ? and(eq(rateLimits.userId, userId), isNull(rateLimits.orgId))
      : and(isNull(rateLimits.userId), eq(rateLimits.orgId, orgId!));

  const existing = db.select({ id: rateLimits.id }).from(rateLimits).where(existingCondition).get();

  if (existing) {
    db.update(rateLimits).set({
      maxRequestsPerMinute,
      maxTokensPerMinute
    }).where(eq(rateLimits.id, existing.id)).run();
  } else {
    db.insert(rateLimits).values({
      userId,
      orgId,
      maxRequestsPerMinute,
      maxTokensPerMinute,
      createdAt: Date.now()
    }).run();
  }
}
