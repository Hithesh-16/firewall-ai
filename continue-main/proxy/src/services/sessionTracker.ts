import crypto from "node:crypto";
import { db } from "../db/index";
import { activeSessions } from "../db/schema";
import { broadcast } from "../ws/wsManager";
import type { ActiveSession, WsEvent } from "../types";
import { eq, desc, lt } from "drizzle-orm";

// ── Session Lifecycle ──────────────────────────────────────────────────────

export function startSession(
  userId: number | null,
  deviceId: string,
  deviceType: string,
  model?: string
): string {
  const sessionId = crypto.randomUUID();
  const now = Date.now();

  db.insert(activeSessions).values({
    id: sessionId,
    userId,
    deviceId,
    deviceType,
    model: model ?? null,
    startedAt: now,
    lastActivityAt: now
  }).run();

  // Notify connected devices
  if (userId != null) {
    const event: WsEvent = {
      type: "session_started",
      payload: { sessionId, deviceId, deviceType, model },
      timestamp: now,
    };
    broadcast(userId, event);
  }

  return sessionId;
}

export function endSession(sessionId: string): boolean {
  const session = getSessionById(sessionId);
  if (!session) return false;

  db.delete(activeSessions).where(eq(activeSessions.id, sessionId)).run();

  if (session.userId != null) {
    const event: WsEvent = {
      type: "session_ended",
      payload: { sessionId, deviceId: session.deviceId },
      timestamp: Date.now(),
    };
    broadcast(session.userId, event);
  }

  return true;
}

export function touchSession(sessionId: string): void {
  db.update(activeSessions)
    .set({ lastActivityAt: Date.now() })
    .where(eq(activeSessions.id, sessionId))
    .run();
}

// ── Query ──────────────────────────────────────────────────────────────────

export function getActiveSessions(userId: number): ActiveSession[] {
  const rows = db.select()
    .from(activeSessions)
    .where(eq(activeSessions.userId, userId))
    .orderBy(desc(activeSessions.lastActivityAt))
    .all();

  return rows.map(mapSessionRow);
}

export function getSessionById(sessionId: string): ActiveSession | null {
  const row = db.select().from(activeSessions).where(eq(activeSessions.id, sessionId)).get();
  return row ? mapSessionRow(row) : null;
}

export function cleanStaleSessions(maxAgeMs = 30 * 60_000): number {
  const cutoff = Date.now() - maxAgeMs;
  const result = db.delete(activeSessions).where(lt(activeSessions.lastActivityAt, cutoff)).run();
  return result.changes;
}

// ── Mapper ─────────────────────────────────────────────────────────────────

function mapSessionRow(row: any): ActiveSession {
  return {
    id: row.id,
    userId: row.userId,
    deviceId: row.deviceId,
    deviceType: row.deviceType,
    model: row.model,
    startedAt: row.startedAt,
    lastActivityAt: row.lastActivityAt,
  };
}
