import { CompletionOptions } from "@ai-firewall/config-yaml";
import type { ToolStatus } from "core/index.js";
import type { BlockDetail } from "core/llm/firewallScan.js";
import type { ChatCompletionCreateParamsStreaming } from "openai/resources.mjs";

import { ToolCallPreview } from "../tools/types.js";

/**
 * Resolution of the interactive firewall consent prompt shown when the
 * proxy would have BLOCKed the request. `bypass` skips scanning, `redact`
 * asks the proxy to sanitise + forward, and `cancel` aborts the turn.
 */
export type FirewallConsentChoice = "bypass" | "redact" | "cancel";

export interface UsageStats {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cost?: number;
  contextUtilization?: number;
  maxContextTokens?: number;
}

export interface PlanUpdate {
  title: string;
  tasks: Array<{
    content: string;
    status: "pending" | "in_progress" | "completed";
  }>;
}

export interface StreamCallbacks {
  onContent?: (content: string) => void;
  onContentComplete?: (content: string) => void;
  onToolStart?: (toolName: string, toolArgs?: any) => void;
  onToolResult?: (result: string, toolName: string, status: ToolStatus) => void;
  onToolError?: (error: string, toolName?: string) => void;
  onToolPermissionRequest?: (
    toolName: string,
    toolArgs: any,
    requestId: string,
    preview?: ToolCallPreview[],
  ) => void;
  onSystemMessage?: (message: string) => void;
  onUsageStats?: (stats: UsageStats) => void;
  onPlanUpdate?: (plan: PlanUpdate) => void;
  /**
   * Fired when the firewall flags a prompt that would otherwise be blocked.
   * The UI surfaces a consent prompt and resolves with the user's choice.
   * If omitted, the stream falls back to the legacy throw-on-block behaviour
   * (keeps headless and non-interactive callers fail-safe).
   */
  onFirewallConsent?: (detail: BlockDetail) => Promise<FirewallConsentChoice>;
}

export function getDefaultCompletionOptions(
  opts?: CompletionOptions,
): Partial<ChatCompletionCreateParamsStreaming> {
  if (!opts) return {};
  return {
    max_tokens: opts.maxTokens,
    temperature: opts.temperature,
    frequency_penalty: opts.frequencyPenalty,
    presence_penalty: opts.presencePenalty,
    top_p: opts.topP,
  };
}
