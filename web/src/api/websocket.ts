import { getToken } from "../utils/storage";

export type WsEventType =
  | "connected"
  | "disconnected"
  | "scan_result"
  | "scan_blocked"
  | "credit_exceeded"
  | "policy_changed"
  | "task_event"
  | "approval_needed"
  | "approval_resolved";

export type WsHandler = (payload: unknown) => void;

export class FirewallWebSocket {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, Set<WsHandler>>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private enabled = false;

  connect(): void {
    if (this.ws) return;
    this.enabled = true;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const token = getToken();
    const query = token ? `?token=${encodeURIComponent(token)}` : "";
    const url = `${protocol}//${window.location.host}/ws${query}`;

    try {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        this.emit("connected", null);
      };

      this.ws.onclose = () => {
        this.ws = null;
        this.emit("disconnected", null);
        if (this.enabled) {
          this.scheduleReconnect();
        }
      };

      this.ws.onerror = () => {
        // onclose will fire after onerror
      };

      this.ws.onmessage = (event) => {
        this.handleMessage(event.data as string);
      };
    } catch {
      this.scheduleReconnect();
    }
  }

  disconnect(): void {
    this.enabled = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  on(event: string, handler: WsHandler): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);

    // Return unsubscribe function
    return () => {
      const set = this.handlers.get(event);
      if (set) {
        set.delete(handler);
        if (set.size === 0) {
          this.handlers.delete(event);
        }
      }
    };
  }

  private handleMessage(data: string): void {
    try {
      const parsed = JSON.parse(data);
      const eventType = parsed.type || parsed.event;
      if (eventType) {
        this.emit(eventType, parsed.payload ?? parsed.data ?? parsed);
      }
    } catch {
      // ignore malformed messages
    }
  }

  private emit(event: string, payload: unknown): void {
    const set = this.handlers.get(event);
    if (set) {
      for (const handler of set) {
        try {
          handler(payload);
        } catch {
          // don't let one handler break others
        }
      }
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.enabled) {
        this.connect();
      }
    }, 3000);
  }
}

export const wsClient = new FirewallWebSocket();
