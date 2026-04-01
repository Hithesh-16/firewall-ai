import axios from "axios";
import { env, isStrictLocal } from "../config";
import {
  PolicyConfig,
  RouteDecision,
  SmartRoutingConfig,
  CostRoutingConfig,
  CostRoutingRule,
} from "../types";

const DEFAULT_ROUTING: SmartRoutingConfig = {
  enabled: false,
  routes: [
    { condition: "risk_score >= 70", target: "local_llm" },
    { condition: "risk_score >= 30", target: "cloud_redacted" },
    { condition: "default", target: "cloud_direct" }
  ],
  local_llm: {
    provider: "ollama",
    model: "llama3",
    endpoint: "http://localhost:11434"
  }
};

function evaluateCondition(condition: string, riskScore: number): boolean {
  if (condition === "default") return true;

  const match = condition.match(/risk_score\s*(>=|>|<=|<|==)\s*(\d+)/);
  if (!match) return false;

  const [, operator, valueStr] = match;
  const value = Number(valueStr);

  switch (operator) {
    case ">=": return riskScore >= value;
    case ">":  return riskScore > value;
    case "<=": return riskScore <= value;
    case "<":  return riskScore < value;
    case "==": return riskScore === value;
    default:   return false;
  }
}

export async function isLocalLlmAvailable(config: SmartRoutingConfig): Promise<boolean> {
  try {
    const base = config.local_llm.endpoint.replace(/\/+$/, "");
    const response = await axios.get(`${base}/api/tags`, { timeout: 2000 });
    return response.status === 200;
  } catch {
    return false;
  }
}

function ollamaCompletionUrl(config: SmartRoutingConfig): string {
  const base = config.local_llm.endpoint.replace(/\/+$/, "");
  return `${base}/api/chat`;
}

export function resolveRoute(
  riskScore: number,
  requestedModel: string,
  policy: PolicyConfig
): RouteDecision {
  const routing = policy.smart_routing ?? DEFAULT_ROUTING;

  // STRICT_LOCAL: always route to local LLM
  if (isStrictLocal()) {
    return {
      target: "local_llm",
      providerUrl: ollamaCompletionUrl(routing),
      model: routing.local_llm.model,
      requiresRedaction: false,
      isLocal: true
    };
  }

  if (!routing.enabled) {
    return {
      target: "cloud_direct",
      providerUrl: env.PROVIDER_URL,
      model: requestedModel,
      requiresRedaction: false,
      isLocal: false
    };
  }

  for (const route of routing.routes) {
    if (evaluateCondition(route.condition, riskScore)) {
      switch (route.target) {
        case "local_llm":
          return {
            target: "local_llm",
            providerUrl: ollamaCompletionUrl(routing),
            model: routing.local_llm.model,
            requiresRedaction: false,
            isLocal: true
          };
        case "cloud_redacted":
          return {
            target: "cloud_redacted",
            providerUrl: env.PROVIDER_URL,
            model: requestedModel,
            requiresRedaction: true,
            isLocal: false
          };
        case "cloud_direct":
          return {
            target: "cloud_direct",
            providerUrl: env.PROVIDER_URL,
            model: requestedModel,
            requiresRedaction: false,
            isLocal: false
          };
      }
    }
  }

  return {
    target: "cloud_direct",
    providerUrl: env.PROVIDER_URL,
    model: requestedModel,
    requiresRedaction: false,
    isLocal: false
  };
}

// ── Cost-Aware Routing (opt-in extension) ──────────────────────────────────

/**
 * Evaluate a cost routing condition string.
 * Supports: "estimated_cost > 0.10", "estimated_cost >= 0.05"
 * Compound: "risk_score >= 30 AND estimated_cost > 0.05"
 */
function evaluateCostCondition(
  condition: string,
  riskScore: number,
  estimatedCost: number
): boolean {
  if (condition === "default") return true;

  // Handle compound AND conditions
  if (condition.includes(" AND ")) {
    const parts = condition.split(" AND ").map((p) => p.trim());
    return parts.every((part) =>
      evaluateCostCondition(part, riskScore, estimatedCost)
    );
  }

  // Cost condition: "estimated_cost > 0.10"
  const costMatch = condition.match(
    /estimated_cost\s*(>=|>|<=|<|==)\s*([\d.]+)/
  );
  if (costMatch) {
    const [, operator, valueStr] = costMatch;
    const value = Number(valueStr);
    switch (operator) {
      case ">=": return estimatedCost >= value;
      case ">":  return estimatedCost > value;
      case "<=": return estimatedCost <= value;
      case "<":  return estimatedCost < value;
      case "==": return estimatedCost === value;
      default:   return false;
    }
  }

  // Risk condition fallback
  return evaluateCondition(condition, riskScore);
}

/**
 * Resolve route considering both risk score AND estimated cost.
 * Falls through to standard resolveRoute() if cost routing is disabled or no rules match.
 *
 * This is opt-in: cost_routing.enabled must be true in policy.json.
 */
export function resolveRouteWithCost(
  riskScore: number,
  estimatedCost: number,
  requestedModel: string,
  policy: PolicyConfig
): RouteDecision {
  const costRouting = policy.smart_routing?.cost_routing;

  // If cost routing is not configured or disabled, fall through to standard routing
  if (!costRouting?.enabled) {
    return resolveRoute(riskScore, requestedModel, policy);
  }

  // Check max cost per request hard limit
  if (
    costRouting.maxCostPerRequest != null &&
    costRouting.maxCostPerRequest > 0 &&
    estimatedCost > costRouting.maxCostPerRequest
  ) {
    // Route to local LLM if available (cheapest option)
    const routing = policy.smart_routing ?? DEFAULT_ROUTING;
    return {
      target: "local_llm",
      providerUrl: ollamaCompletionUrl(routing),
      model: routing.local_llm.model,
      requiresRedaction: false,
      isLocal: true,
    };
  }

  // Evaluate cost routing rules
  for (const rule of costRouting.rules) {
    if (evaluateCostCondition(rule.condition, riskScore, estimatedCost)) {
      const routing = policy.smart_routing ?? DEFAULT_ROUTING;
      switch (rule.target) {
        case "local_llm":
          return {
            target: "local_llm",
            providerUrl: ollamaCompletionUrl(routing),
            model: rule.preferModel ?? routing.local_llm.model,
            requiresRedaction: false,
            isLocal: true,
          };
        case "cloud_redacted":
          return {
            target: "cloud_redacted",
            providerUrl: env.PROVIDER_URL,
            model: rule.preferModel ?? requestedModel,
            requiresRedaction: true,
            isLocal: false,
          };
        case "cloud_direct":
          return {
            target: "cloud_direct",
            providerUrl: env.PROVIDER_URL,
            model: rule.preferModel ?? requestedModel,
            requiresRedaction: false,
            isLocal: false,
          };
      }
    }
  }

  // No cost rules matched — fall through to standard risk-based routing
  return resolveRoute(riskScore, requestedModel, policy);
}

export function formatOllamaPayload(
  model: string,
  messages: Array<{ role: string; content: string }>
): unknown {
  return {
    model,
    messages,
    stream: false
  };
}

export function normalizeOllamaResponse(ollamaData: Record<string, unknown>): unknown {
  const message = ollamaData.message as { role?: string; content?: string } | undefined;
  return {
    id: `local-${Date.now()}`,
    object: "chat.completion",
    model: ollamaData.model,
    choices: [
      {
        index: 0,
        message: {
          role: message?.role ?? "assistant",
          content: message?.content ?? ""
        },
        finish_reason: "stop"
      }
    ],
    usage: {
      prompt_tokens: ollamaData.prompt_eval_count ?? 0,
      completion_tokens: ollamaData.eval_count ?? 0,
      total_tokens:
        ((ollamaData.prompt_eval_count as number) ?? 0) +
        ((ollamaData.eval_count as number) ?? 0)
    }
  };
}
