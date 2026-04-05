/**
 * Business Logic DSL Routes
 *
 * Parse, validate, and evaluate custom business logic rules
 * defined in YAML format for policy enforcement.
 *
 * Endpoints:
 *   POST /api/policy/rules/parse    — Parse business logic rules from YAML
 *   POST /api/policy/rules/evaluate — Evaluate rules against context
 *   POST /api/policy/rules/validate — Validate a single rule
 */

import { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth/authMiddleware";
import {
  parseRules,
  evaluateRules,
  validateRule,
} from "../policy/businessLogicDsl";

// ── Schemas ────────────────────────────────────────────────────────────────

const parseRulesSchema = z.object({
  yaml: z.string().min(1).max(65536),
});

const ruleConditionSchema = z.object({
  field: z.string().min(1),
  operator: z.string().min(1),
  value: z.union([z.string(), z.array(z.string()), z.number()]),
  negate: z.boolean().default(false),
});

const businessRuleSchema = z.object({
  name: z.string().min(1),
  conditions: z.array(ruleConditionSchema).min(1),
  logicalOperator: z.enum(["AND", "OR", "NOT"]),
  action: z.enum(["BLOCK", "REDACT", "WARN", "LOG", "ESCALATE"]),
  message: z.string(),
  severity: z.enum(["critical", "high", "medium", "low"]),
  priority: z.number().int().min(0).default(0),
  enabled: z.boolean().default(true),
});

const ruleContextSchema = z.object({
  content: z.string().default(""),
  role: z.string().optional(),
  model: z.string().optional(),
  userId: z.string().optional(),
  categories: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const evaluateRulesSchema = z.object({
  rules: z.array(businessRuleSchema).min(1).max(200),
  context: ruleContextSchema,
});

const validateRuleSchema = businessRuleSchema;

// ── Route Registration ─────────────────────────────────────────────────────

export async function registerBusinessLogicRoutes(
  app: FastifyInstance,
): Promise<void> {
  /**
   * POST /api/policy/rules/parse — Parse business logic rules from YAML
   *
   * Parses YAML-formatted rules into structured BusinessRule objects.
   */
  app.post(
    "/api/policy/rules/parse",
    { preHandler: requireAuth },
    async (request, reply) => {
      const parsed = parseRulesSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "Invalid payload", details: parsed.error.flatten() });
      }

      const { yaml } = parsed.data;
      return parseRules(yaml);
    },
  );

  /**
   * POST /api/policy/rules/evaluate — Evaluate rules against context
   *
   * Evaluates an ordered set of rules against the provided context
   * and returns the resulting action with matched rules.
   */
  app.post(
    "/api/policy/rules/evaluate",
    { preHandler: requireAuth },
    async (request, reply) => {
      const parsed = evaluateRulesSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "Invalid payload", details: parsed.error.flatten() });
      }

      const { rules, context } = parsed.data;
      return evaluateRules(rules, context);
    },
  );

  /**
   * POST /api/policy/rules/validate — Validate a single rule
   *
   * Checks that a rule's condition syntax is valid and the rule
   * is well-formed without executing it.
   */
  app.post(
    "/api/policy/rules/validate",
    { preHandler: requireAuth },
    async (request, reply) => {
      const parsed = validateRuleSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply
          .status(400)
          .send({ error: "Invalid payload", details: parsed.error.flatten() });
      }

      return validateRule(parsed.data);
    },
  );
}
