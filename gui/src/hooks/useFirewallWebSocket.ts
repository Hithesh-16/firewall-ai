/**
 * Firewall WebSocket Hook — Real-time dashboard events
 *
 * Connects to the proxy's WebSocket and dispatches events to callbacks.
 * Extends the existing useWebSocketApprovals pattern for broader event types.
 *
 * Events:
 *   - scan_result: new scan completed (for live feed)
 *   - scan_blocked: content blocked by policy
 *   - credit_exceeded: usage limit hit
 *   - policy_changed: policy updated (refresh UI)
 *   - session_started / session_ended
 */

import { useEffect, useRef, useCallback } from "react";

const PROXY_BASE = (window as any).__PROXY_URL ?? "http://localhost:8080";
const RECONNECT_DELAY_MS = 3000;

interface WsEvent {
  type: string;
  payload: Record<string, unknown>;
  timestamp: number;
}

type EventHandler = (payload: Record<string, unknown>) => void;

export function useFirewallWebSocket(
  handlers: Record<string, EventHandler>,
  enabled = true
) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const connect = useCallback(() => {
    const token = localStorage.getItem("afw_token");
    if (!token || !enabled) return;

    const wsUrl = PROXY_BASE.replace(/^http/, "ws") + `/ws?token=${encodeURIComponent(token)}`;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        handlersRef.current.connected?.({});
      };

      ws.onmessage = (event) => {
        try {
          const data: WsEvent = JSON.parse(event.data);
          const handler = handlersRef.current[data.type];
          if (handler) {
            handler(data.payload);
          }
        } catch {
          // Invalid JSON — skip
        }
      };

      ws.onclose = () => {
        wsRef.current = null;
        handlersRef.current.disconnected?.({});
        // Auto-reconnect
        if (enabled) {
          reconnectTimerRef.current = setTimeout(connect, RECONNECT_DELAY_MS);
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch {
      // WebSocket construction failed — retry
      reconnectTimerRef.current = setTimeout(connect, RECONNECT_DELAY_MS);
    }
  }, [enabled]);

  useEffect(() => {
    if (enabled) {
      connect();
    }

    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [connect, enabled]);

  return {
    isConnected: wsRef.current?.readyState === WebSocket.OPEN,
  };
}
