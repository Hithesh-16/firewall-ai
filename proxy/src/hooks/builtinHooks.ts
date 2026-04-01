/**
 * Built-in Hooks
 *
 * Default hooks that ship with AI Firewall:
 * - on_block: audit log + optional webhook notification (sanitized payload)
 * - on_redact: audit log of redaction event
 *
 * CRITICAL: Webhook payloads are SANITIZED — event type + risk score only.
 * NEVER echo the raw blocked content (which contains the secret/PII that
 * caused the block).
 */

import { registerHook, type HookContext } from "./hookRegistry";
import { enqueueWebhookEvent } from "../services/webhookQueue";

/**
 * Register all built-in hooks.
 * Called once at server startup.
 */
export function registerBuiltinHooks(): void {
  registerHook({
    id: "builtin:on_block_webhook",
    event: "on_block",
    execute: async (context: HookContext) => {
      // Sanitize: include event metadata, NEVER the raw blocked content
      enqueueWebhookEvent("on_block", {
        event: "on_block",
        riskScore: context.riskScore ?? 0,
        action: context.action ?? "BLOCK",
        reasons: context.reasons ?? [],
        model: context.model ?? "unknown",
        timestamp: context.timestamp,
        // No raw text, no secret values, no PII
      });
    },
  });

  registerHook({
    id: "builtin:on_redact_webhook",
    event: "on_redact",
    execute: async (context: HookContext) => {
      enqueueWebhookEvent("on_redact", {
        event: "on_redact",
        riskScore: context.riskScore ?? 0,
        action: "REDACT",
        model: context.model ?? "unknown",
        timestamp: context.timestamp,
      });
    },
  });
}
