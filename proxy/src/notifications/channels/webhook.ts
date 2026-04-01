/**
 * Webhook Notification Channel
 *
 * Sends notifications to any HTTP endpoint (Slack, Teams, Discord, custom).
 * Implements NotificationChannelHandler interface (LSP).
 *
 * Config: { url: string, headers?: Record<string, string> }
 */

import type { WsEvent } from "../../types";
import type { NotificationChannelHandler } from "../notificationService";

export const webhookChannel: NotificationChannelHandler = {
  type: "webhook",

  async send(
    userId: number,
    event: WsEvent,
    config: Record<string, unknown>
  ): Promise<boolean> {
    const url = config.url as string | undefined;
    if (!url) return false;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(config.headers as Record<string, string> | undefined),
    };

    const body = JSON.stringify({
      source: "ai-firewall",
      userId,
      event: event.type,
      payload: event.payload,
      timestamp: event.timestamp,
    });

    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body,
        signal: AbortSignal.timeout(10_000), // 10s timeout
      });
      return response.ok;
    } catch {
      return false;
    }
  },
};
