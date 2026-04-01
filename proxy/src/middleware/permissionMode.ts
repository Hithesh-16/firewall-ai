/**
 * Permission Mode Middleware
 *
 * Enforces one of three permission modes on tool calls:
 * - Off:   Every tool requires explicit approval (most restrictive)
 * - Auto:  Follow per-tool policies from config (default, current behavior)
 * - Turbo: Skip approval for tools with risk below turbo_threshold (fastest)
 *
 * High-risk actions in Turbo mode (score >= threshold) fall back to the
 * same approval queue as Off mode.
 *
 * SOLID:
 * - SRP: Only resolves permission mode → approval requirement. No scanning.
 * - OCP: New modes added by extending PermissionMode union + switch case.
 */

import type { PermissionMode } from "../types";

export interface PermissionDecision {
  /** Whether the tool call requires user approval before execution */
  requiresApproval: boolean;
  /** Why this decision was made */
  reason: string;
  /** The mode that was applied */
  mode: PermissionMode;
}

const DEFAULT_TURBO_THRESHOLD = 70;

/**
 * Evaluate whether a tool call requires approval based on the active permission mode.
 *
 * @param mode - The active permission mode (off/auto/turbo)
 * @param riskScore - Risk score from the scanner pipeline (0-100)
 * @param toolPolicyRequiresApproval - Whether the per-tool policy says approval is needed
 * @param turboThreshold - Risk threshold for turbo mode (default: 70, configurable)
 */
export function evaluatePermission(
  mode: PermissionMode,
  riskScore: number,
  toolPolicyRequiresApproval: boolean,
  turboThreshold?: number,
): PermissionDecision {
  const threshold = turboThreshold ?? DEFAULT_TURBO_THRESHOLD;

  switch (mode) {
    case "off":
      // Most restrictive: every tool call requires approval
      return {
        requiresApproval: true,
        reason: "Permission mode is OFF — all tools require approval",
        mode: "off",
      };

    case "turbo":
      // Least restrictive: skip approval for low-risk tools
      if (riskScore >= threshold) {
        return {
          requiresApproval: true,
          reason: `Turbo mode: risk score ${riskScore} >= threshold ${threshold}`,
          mode: "turbo",
        };
      }
      return {
        requiresApproval: false,
        reason: `Turbo mode: risk score ${riskScore} < threshold ${threshold}`,
        mode: "turbo",
      };

    case "auto":
    default:
      // Default: follow per-tool policy
      return {
        requiresApproval: toolPolicyRequiresApproval,
        reason: toolPolicyRequiresApproval
          ? "Auto mode: tool policy requires approval"
          : "Auto mode: tool policy allows execution",
        mode: "auto",
      };
  }
}
