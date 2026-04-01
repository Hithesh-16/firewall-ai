import { db } from "../db/index";
import { notificationChannels } from "../db/schema";
import type { WsEvent, NotificationChannelType } from "../types";
import { eq, and } from "drizzle-orm";

// ── Channel Interface (DIP) ────────────────────────────────────────────────

export interface NotificationChannelHandler {
  readonly type: NotificationChannelType;
  send(userId: number, event: WsEvent, config: Record<string, unknown>): Promise<boolean>;
}

// ── Channel Registry (OCP: register new channels without modifying service) ─

const channelRegistry = new Map<NotificationChannelType, NotificationChannelHandler>();

export function registerChannel(handler: NotificationChannelHandler): void {
  channelRegistry.set(handler.type, handler);
}

// ── Core Dispatch ──────────────────────────────────────────────────────────

export async function sendNotification(
  userId: number,
  event: WsEvent
): Promise<{ delivered: number; failed: number; channels: string[] }> {
  const rows = db.select().from(notificationChannels)
    .where(and(eq(notificationChannels.userId, userId), eq(notificationChannels.enabled, 1)))
    .all();

  let delivered = 0;
  let failed = 0;
  const channels: string[] = [];

  for (const row of rows) {
    const channelType = row.channelType as NotificationChannelType;
    const handler = channelRegistry.get(channelType);

    if (!handler) {
      failed++;
      continue;
    }

    let config: Record<string, unknown>;
    try {
      config = JSON.parse(row.configJson as string);
    } catch {
      failed++;
      continue;
    }

    try {
      const success = await handler.send(userId, event, config);
      if (success) {
        delivered++;
        channels.push(channelType);
      } else {
        failed++;
      }
    } catch {
      failed++;
    }
  }

  return { delivered, failed, channels };
}

// ── Channel Config CRUD ────────────────────────────────────────────────────

export function addChannel(
  userId: number,
  channelType: NotificationChannelType,
  config: Record<string, unknown>
): number {
  const result = db.insert(notificationChannels).values({
    userId,
    channelType,
    configJson: JSON.stringify(config),
    enabled: 1,
    createdAt: Date.now()
  }).run();

  return Number(result.lastInsertRowid);
}

export function getChannels(userId: number): Array<{
  id: number;
  channelType: NotificationChannelType;
  enabled: boolean;
  createdAt: number;
}> {
  const rows = db.select({
    id: notificationChannels.id,
    channelType: notificationChannels.channelType,
    enabled: notificationChannels.enabled,
    createdAt: notificationChannels.createdAt
  }).from(notificationChannels).where(eq(notificationChannels.userId, userId)).all();

  return rows.map((r) => ({
    id: r.id as number,
    channelType: r.channelType as NotificationChannelType,
    enabled: (r.enabled as number) === 1,
    createdAt: r.createdAt as number,
  }));
}

export function removeChannel(channelId: number): boolean {
  const result = db.delete(notificationChannels).where(eq(notificationChannels.id, channelId)).run();
  return result.changes > 0;
}

export function toggleChannel(channelId: number, enabled: boolean): boolean {
  const result = db.update(notificationChannels).set({ enabled: enabled ? 1 : 0 }).where(eq(notificationChannels.id, channelId)).run();
  return result.changes > 0;
}
