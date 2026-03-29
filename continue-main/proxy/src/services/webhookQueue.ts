/**
 * Webhook Delivery Queue
 *
 * Stripe/GitHub-style reliable webhook delivery with exponential backoff + jitter.
 * SQLite-backed queue, polled via setInterval.
 *
 * Retry schedule: immediate, 30s, 2min, 15min, 1hr, 4hr → dead letter
 * HMAC-SHA256 signed payloads with X-AF-Webhook-Signature header.
 * Idempotency key (X-AF-Webhook-ID) for receiver deduplication.
 *
 * SOLID:
 * - SRP: Only manages delivery queue and retry logic. No event generation.
 * - OCP: New retry strategies possible by modifying RETRY_DELAYS array.
 * - DIP: Depends on the webhook record structure, not on how webhooks are registered.
 */

import crypto from "node:crypto";
import db from "../db/database";

// ── Retry Schedule (Stripe pattern) ────────────────────────────────────────

const RETRY_DELAYS_MS = [
  0,          // Attempt 1: immediate
  30_000,     // Attempt 2: 30s
  120_000,    // Attempt 3: 2 min
  900_000,    // Attempt 4: 15 min
  3_600_000,  // Attempt 5: 1 hr
  14_400_000, // Attempt 6: 4 hr
];

const MAX_ATTEMPTS = RETRY_DELAYS_MS.length;
const POLL_INTERVAL_MS = 10_000; // Check for retries every 10s

// ── Enqueue ────────────────────────────────────────────────────────────────

/**
 * Enqueue a webhook delivery for all matching webhooks.
 */
export function enqueueWebhookEvent(
  event: string,
  payload: Record<string, unknown>
): number {
  const payloadStr = JSON.stringify(payload);
  const payloadHash = crypto.createHash("sha256").update(payloadStr).digest("hex");
  const now = Date.now();

  // Find all enabled webhooks that subscribe to this event
  const webhooks = db
    .prepare("SELECT * FROM webhooks WHERE enabled = 1")
    .all() as Array<Record<string, unknown>>;

  let queued = 0;

  for (const wh of webhooks) {
    const events = (wh.events as string).split(",").map((e) => e.trim());
    if (!events.includes(event) && !events.includes("*")) continue;

    const idempotencyKey = `${wh.id}-${payloadHash}-${now}`;

    db.prepare(
      `INSERT INTO webhook_deliveries
       (webhook_id, event, payload_hash, idempotency_key, status, attempts, next_retry_at, created_at)
       VALUES (?, ?, ?, ?, 'pending', 0, ?, ?)`
    ).run(wh.id, event, payloadHash, idempotencyKey, now, now);

    queued++;
  }

  return queued;
}

// ── Process Queue ──────────────────────────────────────────────────────────

/**
 * Process pending deliveries. Called by the poller.
 */
export async function processDeliveryQueue(): Promise<{
  delivered: number;
  failed: number;
  dead: number;
}> {
  const now = Date.now();
  let delivered = 0;
  let failed = 0;
  let dead = 0;

  // Fetch deliveries ready for attempt
  const pending = db
    .prepare(
      `SELECT d.*, w.url, w.secret
       FROM webhook_deliveries d
       JOIN webhooks w ON d.webhook_id = w.id
       WHERE d.status IN ('pending', 'failed')
         AND d.next_retry_at <= ?
       ORDER BY d.next_retry_at ASC
       LIMIT 50`
    )
    .all(now) as Array<Record<string, unknown>>;

  for (const delivery of pending) {
    const attempt = (delivery.attempts as number) + 1;
    const url = delivery.url as string;
    const secret = delivery.secret as string | null;
    const event = delivery.event as string;
    const idempotencyKey = delivery.idempotency_key as string;
    const deliveryId = delivery.id as number;

    // Build payload
    const body = JSON.stringify({
      event,
      payload_hash: delivery.payload_hash,
      idempotency_key: idempotencyKey,
      attempt,
      timestamp: now,
    });

    // HMAC-SHA256 signature
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-AF-Webhook-ID": idempotencyKey,
      "X-AF-Webhook-Event": event,
    };

    if (secret) {
      const timestamp = Math.floor(now / 1000);
      const signaturePayload = `${timestamp}.${body}`;
      const hmac = crypto.createHmac("sha256", secret).update(signaturePayload).digest("hex");
      headers["X-AF-Webhook-Signature"] = `t=${timestamp},v1=${hmac}`;
    }

    // Attempt delivery
    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(10_000),
      });

      if (response.ok) {
        db.prepare(
          "UPDATE webhook_deliveries SET status = 'delivered', attempts = ?, delivered_at = ? WHERE id = ?"
        ).run(attempt, now, deliveryId);
        delivered++;
      } else {
        handleFailure(deliveryId, attempt, `HTTP ${response.status}`);
        failed++;
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Unknown error";
      const isDead = handleFailure(deliveryId, attempt, errMsg);
      if (isDead) {
        dead++;
      } else {
        failed++;
      }
    }
  }

  return { delivered, failed, dead };
}

/**
 * Handle a failed delivery attempt.
 * Returns true if moved to dead letter.
 */
function handleFailure(deliveryId: number, attempt: number, error: string): boolean {
  if (attempt >= MAX_ATTEMPTS) {
    db.prepare(
      "UPDATE webhook_deliveries SET status = 'dead', attempts = ?, last_error = ? WHERE id = ?"
    ).run(attempt, error, deliveryId);
    return true;
  }

  // Schedule next retry with jitter
  const baseDelay = RETRY_DELAYS_MS[attempt] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
  const jitter = Math.floor(Math.random() * baseDelay * 0.2); // ±20% jitter
  const nextRetry = Date.now() + baseDelay + jitter;

  db.prepare(
    "UPDATE webhook_deliveries SET status = 'failed', attempts = ?, next_retry_at = ?, last_error = ? WHERE id = ?"
  ).run(attempt, nextRetry, error, deliveryId);

  return false;
}

// ── Query ──────────────────────────────────────────────────────────────────

/**
 * Get delivery history for a webhook.
 */
export function getDeliveries(
  webhookId: number,
  limit = 20
): Array<Record<string, unknown>> {
  return db
    .prepare(
      "SELECT * FROM webhook_deliveries WHERE webhook_id = ? ORDER BY created_at DESC LIMIT ?"
    )
    .all(webhookId, limit) as Array<Record<string, unknown>>;
}

// ── Poller ──────────────────────────────────────────────────────────────────

let pollTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start the delivery queue poller.
 */
export function startWebhookPoller(): void {
  if (pollTimer) return;

  pollTimer = setInterval(async () => {
    try {
      await processDeliveryQueue();
    } catch {
      // Swallow errors — poller is best-effort
    }
  }, POLL_INTERVAL_MS);

  // Don't keep process alive just for polling
  if (pollTimer.unref) pollTimer.unref();
}

/**
 * Stop the poller.
 */
export function stopWebhookPoller(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}
