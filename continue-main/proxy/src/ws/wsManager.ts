/**
 * WebSocket Connection Manager
 *
 * Manages WebSocket connections for real-time event push to clients
 * (VS Code, CLI, PWA, mobile).
 *
 * SOLID:
 * - SRP: Only manages connection lifecycle + message delivery. No business logic.
 * - OCP: New event types added in types/index.ts without changing this module.
 * - DIP: Depends on WsEvent interface, not on approval/notification implementations.
 */

import type { WsEvent } from "../types";

/** Minimal WebSocket interface — compatible with ws and browser WebSocket */
interface WebSocket {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
  ping(): void;
  on(event: string, listener: (...args: unknown[]) => void): void;
}

// ── Types ──────────────────────────────────────────────────────────────────

interface ConnectedClient {
  ws: WebSocket;
  userId: number;
  deviceId: string;
  connectedAt: number;
  lastPingAt: number;
}

// ── Singleton State ────────────────────────────────────────────────────────

const clients = new Map<string, ConnectedClient>();
const HEARTBEAT_INTERVAL = 30_000; // 30s
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

// ── Connection Management ──────────────────────────────────────────────────

/**
 * Register a new WebSocket client.
 * Key: `${userId}:${deviceId}` — one connection per device per user.
 */
export function registerClient(
  userId: number,
  deviceId: string,
  ws: WebSocket
): void {
  const key = `${userId}:${deviceId}`;

  // Close existing connection for this device (reconnect scenario)
  const existing = clients.get(key);
  if (existing && existing.ws.readyState === 1) {
    existing.ws.close(1000, "Replaced by new connection");
  }

  clients.set(key, {
    ws,
    userId,
    deviceId,
    connectedAt: Date.now(),
    lastPingAt: Date.now(),
  });

  // Start heartbeat if not running
  if (!heartbeatTimer) {
    startHeartbeat();
  }

  // Handle close
  ws.on("close", () => {
    clients.delete(key);
    if (clients.size === 0 && heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  });

  // Handle pong (client responded to ping)
  ws.on("pong", () => {
    const client = clients.get(key);
    if (client) {
      client.lastPingAt = Date.now();
    }
  });
}

/**
 * Remove a client connection.
 */
export function removeClient(userId: number, deviceId: string): void {
  const key = `${userId}:${deviceId}`;
  const client = clients.get(key);
  if (client) {
    client.ws.close(1000, "Server disconnect");
    clients.delete(key);
  }
}

// ── Message Delivery ───────────────────────────────────────────────────────

/**
 * Broadcast an event to ALL connected devices for a user.
 * Returns the number of devices that received the message.
 */
export function broadcast(userId: number, event: WsEvent): number {
  let delivered = 0;
  const payload = JSON.stringify(event);

  for (const [, client] of clients) {
    if (client.userId === userId && client.ws.readyState === 1) {
      try {
        client.ws.send(payload);
        delivered++;
      } catch {
        // Connection dead — will be cleaned up by heartbeat
      }
    }
  }

  return delivered;
}

/**
 * Send an event to a specific device.
 * Returns true if delivered, false if device not connected.
 */
export function sendToDevice(
  userId: number,
  deviceId: string,
  event: WsEvent
): boolean {
  const key = `${userId}:${deviceId}`;
  const client = clients.get(key);

  if (!client || client.ws.readyState !== 1) {
    return false;
  }

  try {
    client.ws.send(JSON.stringify(event));
    return true;
  } catch {
    return false;
  }
}

/**
 * Broadcast to ALL connected clients (all users).
 * Use sparingly — for system-wide announcements only.
 */
export function broadcastAll(event: WsEvent): number {
  let delivered = 0;
  const payload = JSON.stringify(event);

  for (const [, client] of clients) {
    if (client.ws.readyState === 1) {
      try {
        client.ws.send(payload);
        delivered++;
      } catch {
        // ignore
      }
    }
  }

  return delivered;
}

// ── Query ──────────────────────────────────────────────────────────────────

/**
 * Get connected device IDs for a user.
 */
export function getConnectedDevices(userId: number): string[] {
  const devices: string[] = [];
  for (const [, client] of clients) {
    if (client.userId === userId && client.ws.readyState === 1) {
      devices.push(client.deviceId);
    }
  }
  return devices;
}

/**
 * Get total connected client count.
 */
export function getConnectionCount(): number {
  let count = 0;
  for (const [, client] of clients) {
    if (client.ws.readyState === 1) count++;
  }
  return count;
}

/**
 * Check if a user has any connected devices.
 */
export function isUserConnected(userId: number): boolean {
  for (const [, client] of clients) {
    if (client.userId === userId && client.ws.readyState === 1) {
      return true;
    }
  }
  return false;
}

// ── Heartbeat ──────────────────────────────────────────────────────────────

function startHeartbeat(): void {
  heartbeatTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, client] of clients) {
      if (client.ws.readyState !== 1) {
        clients.delete(key);
        continue;
      }

      // If client didn't respond to last ping within 2 intervals, disconnect
      if (now - client.lastPingAt > HEARTBEAT_INTERVAL * 2) {
        client.ws.terminate();
        clients.delete(key);
        continue;
      }

      // Send ping
      try {
        client.ws.ping();
      } catch {
        clients.delete(key);
      }
    }
  }, HEARTBEAT_INTERVAL);
}
