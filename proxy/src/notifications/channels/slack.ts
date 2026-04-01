/**
 * Slack Notification Channel
 *
 * Sends notifications to Slack via Incoming Webhook URL.
 * Formats events as Slack Block Kit messages for rich display.
 *
 * Config: { webhookUrl: string, channel?: string }
 */

import type { WsEvent } from "../../types";
import type { NotificationChannelHandler } from "../notificationService";

const EVENT_EMOJI: Record<string, string> = {
  scan_blocked: ":no_entry:",
  approval_needed: ":raised_hand:",
  approval_resolved: ":white_check_mark:",
  credit_exceeded: ":warning:",
  session_started: ":computer:",
  session_ended: ":wave:",
  policy_changed: ":shield:",
};

export const slackChannel: NotificationChannelHandler = {
  type: "slack",

  async send(
    userId: number,
    event: WsEvent,
    config: Record<string, unknown>
  ): Promise<boolean> {
    const webhookUrl = config.webhookUrl as string | undefined;
    if (!webhookUrl) return false;

    const emoji = EVENT_EMOJI[event.type] ?? ":bell:";
    const title = event.type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

    const blocks = [
      {
        type: "header",
        text: { type: "plain_text", text: `${emoji} AI Firewall: ${title}`, emoji: true },
      },
      {
        type: "section",
        fields: Object.entries(event.payload).slice(0, 10).map(([key, value]) => ({
          type: "mrkdwn",
          text: `*${key}:*\n${typeof value === "object" ? JSON.stringify(value) : String(value)}`,
        })),
      },
      {
        type: "context",
        elements: [
          { type: "mrkdwn", text: `User ID: ${userId} | ${new Date(event.timestamp).toISOString()}` },
        ],
      },
    ];

    try {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(config.channel ? { channel: config.channel } : {}),
          blocks,
          text: `AI Firewall: ${title}`, // fallback for notifications
        }),
      });
      return res.ok;
    } catch {
      return false;
    }
  },
};
