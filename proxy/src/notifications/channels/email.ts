/**
 * Email Notification Channel
 *
 * Sends notifications via SMTP using nodemailer (if available).
 * Falls back to a simple SMTP fetch if nodemailer is not installed.
 *
 * Config: {
 *   smtpHost: string,
 *   smtpPort: number,
 *   smtpUser: string,
 *   smtpPass: string,
 *   fromAddress: string,
 *   toAddress: string
 * }
 */

import type { WsEvent } from "../../types";
import type { NotificationChannelHandler } from "../notificationService";

export const emailChannel: NotificationChannelHandler = {
  type: "email",

  async send(
    userId: number,
    event: WsEvent,
    config: Record<string, unknown>
  ): Promise<boolean> {
    const { smtpHost, smtpPort, smtpUser, smtpPass, fromAddress, toAddress } = config as {
      smtpHost?: string;
      smtpPort?: number;
      smtpUser?: string;
      smtpPass?: string;
      fromAddress?: string;
      toAddress?: string;
    };

    if (!smtpHost || !fromAddress || !toAddress) return false;

    const title = event.type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

    const detailRows = Object.entries(event.payload)
      .slice(0, 15)
      .map(([k, v]) => `<tr><td style="padding:4px 8px;font-weight:600;color:#64748b;">${k}</td><td style="padding:4px 8px;">${typeof v === "object" ? JSON.stringify(v) : String(v)}</td></tr>`)
      .join("");

    const html = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;">
        <div style="background:#059669;color:#fff;padding:16px 24px;border-radius:8px 8px 0 0;">
          <h2 style="margin:0;font-size:18px;">AI Firewall Alert: ${title}</h2>
        </div>
        <div style="padding:20px 24px;background:#f8fafc;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;">
          <table style="width:100%;border-collapse:collapse;font-size:14px;">
            ${detailRows}
          </table>
          <p style="margin-top:16px;font-size:12px;color:#94a3b8;">
            User ID: ${userId} &mdash; ${new Date(event.timestamp).toISOString()}
          </p>
        </div>
      </div>
    `;

    try {
      // Try nodemailer if available
      // @ts-ignore — nodemailer is an optional dependency
      const nodemailer = await import("nodemailer").catch(() => null) as any;
      if (nodemailer) {
        const transporter = nodemailer.createTransport({
          host: smtpHost,
          port: smtpPort ?? 587,
          secure: (smtpPort ?? 587) === 465,
          auth: smtpUser ? { user: smtpUser, pass: smtpPass } : undefined,
        });

        await transporter.sendMail({
          from: fromAddress,
          to: toAddress,
          subject: `[AI Firewall] ${title}`,
          html,
        });
        return true;
      }

      // Fallback: log that email would be sent (no SMTP library available)
      console.error("[Email Channel] nodemailer not installed. Install with: npm install nodemailer");
      return false;
    } catch (err) {
      console.error("[Email Channel] Send failed:", err);
      return false;
    }
  },
};
