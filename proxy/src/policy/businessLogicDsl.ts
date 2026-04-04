/**
 * Business Logic Policy DSL
 *
 * Parses and evaluates organization-specific policy rules defined in a
 * YAML-like DSL. Rules map conditions (content matches, role/model checks)
 * to actions (BLOCK, REDACT, WARN, LOG, ESCALATE).
 *
 * Design:
 * - Single Responsibility: Rule parsing and evaluation only
 * - Open/Closed: New condition operators added to CONDITION_EVALUATORS map
 * - Pure functions — no side effects, immutable returns
 * - Rules evaluated in priority order (highest first), first triggered action wins
 */

// ── Types ─────────────────────────────────────────────────────────────────────

export type RuleAction = "BLOCK" | "REDACT" | "WARN" | "LOG" | "ESCALATE";
export type RuleSeverity = "critical" | "high" | "medium" | "low";
export type LogicalOperator = "AND" | "OR" | "NOT";

export interface RuleCondition {
  readonly field: string;
  readonly operator: string;
  readonly value: string | string[] | number;
  readonly negate: boolean;
}

export interface BusinessRule {
  readonly name: string;
  readonly conditions: readonly RuleCondition[];
  readonly logicalOperator: LogicalOperator;
  readonly action: RuleAction;
  readonly message: string;
  readonly severity: RuleSeverity;
  readonly priority: number;
  readonly enabled: boolean;
}

export interface RuleContext {
  readonly content: string;
  readonly role?: string;
  readonly model?: string;
  readonly userId?: string;
  readonly categories?: readonly string[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface RuleEvalResult {
  readonly triggered: readonly BusinessRule[];
  readonly action: RuleAction | "ALLOW";
  readonly messages: readonly string[];
  readonly allPassed: boolean;
}

export interface ValidationError {
  readonly field: string;
  readonly message: string;
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly errors: readonly ValidationError[];
}

export interface ParseResult {
  readonly rules: readonly BusinessRule[];
  readonly errors: readonly { line: number; message: string }[];
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_RULES = 100;

const VALID_ACTIONS = new Set<RuleAction>([
  "BLOCK",
  "REDACT",
  "WARN",
  "LOG",
  "ESCALATE",
]);
const VALID_SEVERITIES = new Set<RuleSeverity>([
  "critical",
  "high",
  "medium",
  "low",
]);
const VALID_OPERATORS = new Set([
  "contains",
  "matches",
  "startsWith",
  "endsWith",
  "length_gt",
  "length_lt",
  "category_is",
  "role_is",
  "model_is",
]);

const ACTION_PRIORITY: Record<RuleAction, number> = {
  BLOCK: 5,
  ESCALATE: 4,
  REDACT: 3,
  WARN: 2,
  LOG: 1,
};

// ── Condition Evaluators ──────────────────────────────────────────────────────

type ConditionEvaluator = (
  context: RuleContext,
  condition: RuleCondition,
) => boolean;

const CONDITION_EVALUATORS: Record<string, ConditionEvaluator> = {
  contains(context, condition) {
    const content = context.content.toLowerCase();
    if (Array.isArray(condition.value)) {
      return condition.value.some((v) =>
        content.includes(String(v).toLowerCase()),
      );
    }
    return content.includes(String(condition.value).toLowerCase());
  },

  matches(context, condition) {
    try {
      const regex = new RegExp(String(condition.value), "i");
      return regex.test(context.content);
    } catch {
      return false;
    }
  },

  startsWith(context, condition) {
    return context.content
      .toLowerCase()
      .startsWith(String(condition.value).toLowerCase());
  },

  endsWith(context, condition) {
    return context.content
      .toLowerCase()
      .endsWith(String(condition.value).toLowerCase());
  },

  length_gt(context, condition) {
    return context.content.length > Number(condition.value);
  },

  length_lt(context, condition) {
    return context.content.length < Number(condition.value);
  },

  category_is(context, condition) {
    if (!context.categories) return false;
    if (Array.isArray(condition.value)) {
      return condition.value.some((v) =>
        context.categories!.includes(String(v)),
      );
    }
    return context.categories.includes(String(condition.value));
  },

  role_is(context, condition) {
    if (!context.role) return false;
    return context.role.toLowerCase() === String(condition.value).toLowerCase();
  },

  model_is(context, condition) {
    if (!context.model) return false;
    return (
      context.model.toLowerCase() === String(condition.value).toLowerCase()
    );
  },
};

// ── Parser Helpers ────────────────────────────────────────────────────────────

/**
 * Parse a bracket-enclosed list: ["item1", "item2"] → string[]
 */
function parseList(raw: string): string[] | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return null;
  const inner = trimmed.slice(1, -1);
  return inner
    .split(",")
    .map((s) => s.trim().replace(/^["']|["']$/g, ""))
    .filter((s) => s.length > 0);
}

/**
 * Parse a single condition clause like: content contains "price"
 * or: content contains ["competitor1", "competitor2"]
 */
function parseConditionClause(clause: string): RuleCondition | null {
  const trimmed = clause.trim();

  // Check for NOT prefix
  let negate = false;
  let working = trimmed;
  if (working.toUpperCase().startsWith("NOT ")) {
    negate = true;
    working = working.slice(4).trim();
  }

  // Try pattern: <field> <operator> <value>
  const match = working.match(/^(\w+)\s+(\w+)\s+(.+)$/);
  if (!match) return null;

  const field = match[1];
  const operator = match[2];
  const rawValue = match[3].trim();

  if (!VALID_OPERATORS.has(operator)) return null;

  // Parse value: list or quoted string or bare string/number
  const listValue = parseList(rawValue);
  let value: string | string[] | number;

  if (listValue) {
    value = listValue;
  } else {
    const unquoted = rawValue.replace(/^["']|["']$/g, "");
    const numVal = Number(unquoted);
    value =
      !isNaN(numVal) && (operator === "length_gt" || operator === "length_lt")
        ? numVal
        : unquoted;
  }

  return Object.freeze({ field, operator, value, negate });
}

/**
 * Parse the `when:` line into conditions and a logical operator.
 * Supports AND, OR between clauses. NOT is per-clause prefix.
 */
function parseWhenClause(when: string): {
  conditions: RuleCondition[];
  logicalOperator: LogicalOperator;
} {
  const trimmed = when.trim();

  // Detect top-level operator
  const hasAnd = / AND /i.test(trimmed);
  const hasOr = / OR /i.test(trimmed);
  const logicalOperator: LogicalOperator = hasOr ? "OR" : "AND";

  const separator = hasOr ? / OR /i : / AND /i;
  const parts = trimmed
    .split(separator)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  const conditions: RuleCondition[] = [];
  for (const part of parts) {
    const cond = parseConditionClause(part);
    if (cond) {
      conditions.push(cond);
    }
  }

  return { conditions, logicalOperator };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Parse YAML-like rule definitions into structured BusinessRule objects.
 *
 * Rule format:
 * ```
 * rule: rule-name
 * when: content contains "value" AND role_is "admin"
 * then: BLOCK
 * message: "Human-readable explanation"
 * severity: high
 * priority: 10
 * ```
 *
 * @param yaml - Multi-line rule definition string
 * @returns Parsed rules and any validation errors
 */
export function parseRules(yaml: string): ParseResult {
  const lines = yaml.split("\n");
  const rules: BusinessRule[] = [];
  const errors: { line: number; message: string }[] = [];

  let current: Record<string, string> = {};
  let ruleStartLine = 0;

  function flushRule(lineNum: number): void {
    if (!current["rule"]) return;

    if (!current["when"]) {
      errors.push({
        line: ruleStartLine,
        message: `Rule "${current["rule"]}" missing "when" clause`,
      });
      return;
    }
    if (!current["then"]) {
      errors.push({
        line: ruleStartLine,
        message: `Rule "${current["rule"]}" missing "then" clause`,
      });
      return;
    }

    const action = current["then"].toUpperCase() as RuleAction;
    if (!VALID_ACTIONS.has(action)) {
      errors.push({
        line: lineNum,
        message: `Invalid action "${current["then"]}" — must be one of: ${[...VALID_ACTIONS].join(", ")}`,
      });
      return;
    }

    const severity = (
      current["severity"] ?? "medium"
    ).toLowerCase() as RuleSeverity;
    if (!VALID_SEVERITIES.has(severity)) {
      errors.push({
        line: lineNum,
        message: `Invalid severity "${current["severity"]}"`,
      });
      return;
    }

    const { conditions, logicalOperator } = parseWhenClause(current["when"]);
    if (conditions.length === 0) {
      errors.push({
        line: ruleStartLine,
        message: `Rule "${current["rule"]}" has no valid conditions`,
      });
      return;
    }

    if (rules.length >= MAX_RULES) {
      errors.push({
        line: lineNum,
        message: `Maximum of ${MAX_RULES} rules exceeded`,
      });
      return;
    }

    const priority = current["priority"] ? Number(current["priority"]) : 0;

    rules.push(
      Object.freeze({
        name: current["rule"],
        conditions,
        logicalOperator,
        action,
        message: (current["message"] ?? "").replace(/^["']|["']$/g, ""),
        severity,
        priority: isNaN(priority) ? 0 : priority,
        enabled: current["enabled"] !== "false",
      }),
    );
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === "" || line.startsWith("#")) continue;

    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;

    const key = line.slice(0, colonIdx).trim().toLowerCase();
    const value = line.slice(colonIdx + 1).trim();

    if (key === "rule") {
      flushRule(i);
      current = {};
      ruleStartLine = i + 1;
    }

    current[key] = value;
  }

  flushRule(lines.length);

  // Sort by priority descending
  const sorted = [...rules].sort((a, b) => b.priority - a.priority);

  return Object.freeze({ rules: sorted, errors: [...errors] });
}

/**
 * Validate a single business rule for structural correctness.
 *
 * @param rule - Rule to validate
 * @returns Validation result with any errors found
 */
export function validateRule(rule: BusinessRule): ValidationResult {
  const errors: ValidationError[] = [];

  if (!rule.name || rule.name.trim().length === 0) {
    errors.push({ field: "name", message: "Rule name is required" });
  }

  if (rule.conditions.length === 0) {
    errors.push({
      field: "conditions",
      message: "At least one condition is required",
    });
  }

  for (const cond of rule.conditions) {
    if (!VALID_OPERATORS.has(cond.operator)) {
      errors.push({
        field: "conditions",
        message: `Unknown operator: "${cond.operator}"`,
      });
    }
  }

  if (!VALID_ACTIONS.has(rule.action)) {
    errors.push({
      field: "action",
      message: `Invalid action: "${rule.action}"`,
    });
  }

  if (!VALID_SEVERITIES.has(rule.severity)) {
    errors.push({
      field: "severity",
      message: `Invalid severity: "${rule.severity}"`,
    });
  }

  if (!rule.message || rule.message.trim().length === 0) {
    errors.push({ field: "message", message: "Rule message is required" });
  }

  return Object.freeze({
    valid: errors.length === 0,
    errors: [...errors],
  });
}

/**
 * Evaluate an ordered set of rules against a context.
 * Rules are evaluated in order (pre-sorted by priority). The highest-priority
 * action from triggered rules determines the final action.
 *
 * @param rules - Business rules (evaluated in array order)
 * @param context - Current request context
 * @returns Evaluation result with triggered rules, final action, and messages
 */
export function evaluateRules(
  rules: readonly BusinessRule[],
  context: RuleContext,
): RuleEvalResult {
  const triggered: BusinessRule[] = [];
  const messages: string[] = [];

  for (const rule of rules) {
    if (!rule.enabled) continue;

    const results = rule.conditions.map((cond) => {
      const evaluator = CONDITION_EVALUATORS[cond.operator];
      if (!evaluator) return false;
      const result = evaluator(context, cond);
      return cond.negate ? !result : result;
    });

    let matched: boolean;
    if (rule.logicalOperator === "OR") {
      matched = results.some((r) => r);
    } else {
      // AND (also used as default)
      matched = results.length > 0 && results.every((r) => r);
    }

    if (matched) {
      triggered.push(rule);
      if (rule.message) {
        messages.push(rule.message);
      }
    }
  }

  if (triggered.length === 0) {
    return Object.freeze({
      triggered: [],
      action: "ALLOW",
      messages: [],
      allPassed: true,
    });
  }

  // Highest-priority action wins (by ACTION_PRIORITY, not rule.priority)
  const finalAction = triggered.reduce<RuleAction>(
    (best, rule) =>
      ACTION_PRIORITY[rule.action] > ACTION_PRIORITY[best] ? rule.action : best,
    triggered[0].action,
  );

  return Object.freeze({
    triggered: [...triggered],
    action: finalAction,
    messages: [...messages],
    allPassed: false,
  });
}
