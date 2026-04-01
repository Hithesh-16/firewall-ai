/**
 * Event Hook Registry
 *
 * Register and trigger hooks for security events. Supports two execution modes:
 * - Gating events (pre_send, on_block): sequential with early-exit on deny
 * - Observational events (post_receive, on_approve, on_redact): parallel fire-and-forget
 *
 * SOLID:
 * - SRP: Only manages hook registration and dispatch. No business logic.
 * - OCP: New event types added by extending HookEvent union.
 */

export type HookEvent =
  | "pre_send"
  | "post_receive"
  | "on_block"
  | "on_redact"
  | "on_approve";

export interface HookContext {
  event: HookEvent;
  riskScore?: number;
  action?: string;
  reasons?: string[];
  model?: string;
  timestamp: number;
  /** Sanitized metadata — NEVER include raw blocked content */
  metadata?: Record<string, unknown>;
}

export interface HookResult {
  /** Whether any hook denied the request (only for gating events) */
  denied: boolean;
  /** Reason from the denying hook */
  reason?: string;
}

export interface Hook {
  id: string;
  event: HookEvent;
  /** Hook handler — returns true to deny (gating events only) */
  execute: (context: HookContext) => Promise<boolean | void>;
}

// ── Gating vs Observational ──────────────────────────────────────────

/** Gating events run sequentially — first deny stops the chain */
const GATING_EVENTS = new Set<HookEvent>(["pre_send", "on_block"]);

/** Max timeout for a single gating hook (prevent request stalls) */
const GATING_HOOK_TIMEOUT_MS = 5000;

// ── Registry ─────────────────────────────────────────────────────────

const registry = new Map<HookEvent, Hook[]>();

export function registerHook(hook: Hook): void {
  const existing = registry.get(hook.event) ?? [];
  registry.set(hook.event, [...existing, hook]);
}

export function unregisterHook(hookId: string): void {
  for (const [event, hooks] of registry) {
    registry.set(
      event,
      hooks.filter((h) => h.id !== hookId),
    );
  }
}

export function getRegisteredHooks(event?: HookEvent): Hook[] {
  if (event) return registry.get(event) ?? [];
  const all: Hook[] = [];
  for (const hooks of registry.values()) {
    all.push(...hooks);
  }
  return all;
}

// ── Trigger ──────────────────────────────────────────────────────────

/**
 * Trigger all hooks for an event.
 *
 * - Gating events: sequential, first deny stops chain, bounded by timeout
 * - Observational events: parallel via Promise.allSettled, fire-and-forget
 */
export async function triggerHooks(
  event: HookEvent,
  context: Omit<HookContext, "event" | "timestamp">,
): Promise<HookResult> {
  const hooks = registry.get(event) ?? [];
  if (hooks.length === 0) return { denied: false };

  const fullContext: HookContext = {
    ...context,
    event,
    timestamp: Date.now(),
  };

  if (GATING_EVENTS.has(event)) {
    // Sequential — early exit on deny
    for (const hook of hooks) {
      try {
        const denied = await Promise.race([
          hook.execute(fullContext),
          new Promise<false>((resolve) =>
            setTimeout(() => resolve(false), GATING_HOOK_TIMEOUT_MS),
          ),
        ]);

        if (denied === true) {
          return { denied: true, reason: `Hook ${hook.id} denied the request` };
        }
      } catch {
        // Hook failure does NOT deny — fail open for gating hooks
        // (the security scanners already caught any issues)
      }
    }
    return { denied: false };
  }

  // Observational — parallel, fire-and-forget
  await Promise.allSettled(hooks.map((h) => h.execute(fullContext)));
  return { denied: false };
}
