/**
 * Firewall WebSocket Hook — Real-time dashboard events
 *
 * Connects once to the proxy's WebSocket. If connection fails, retries
 * up to 3 times with exponential backoff then stops. Does NOT connect
 * if no auth token is available.
 */

import { useEffect, useRef, useCallback } from "react";

const PROXY_BASE = (window as any).__PROXY_URL ?? "http://localhost:8080";
const MAX_FAILURES = 3;
const BASE_DELAY_MS = 10_000;
const MAX_DELAY_MS = 60_000;

interface WsEvent {
  type: string;
  payload: Record<string, unknown>;
  timestamp: number;
}

type EventHandler = (payload: Record<string, unknown>) => void;

export function useFirewallWebSocket(
  handlers: Record<string, EventHandler>,
  enabled = true,
) {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const failuresRef = useRef(0);
  const stoppedRef = useRef(false);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const connect = useCallback(() => {
    if (stoppedRef.current) return;

    const token = localStorage.getItem("afw_token");
    if (!token || !enabled) return;

    if (failuresRef.current >= MAX_FAILURES) {
      stoppedRef.current = true;
      return;
    }

    const wsUrl =
      PROXY_BASE.replace(/^http/, "ws") +
      `/ws?token=${encodeURIComponent(token)}`;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        failuresRef.current = 0;
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

        if (enabled && !stoppedRef.current) {
          failuresRef.current += 1;
          if (failuresRef.current < MAX_FAILURES) {
            const delay = Math.min(
              BASE_DELAY_MS * Math.pow(2, failuresRef.current - 1),
              MAX_DELAY_MS,
            );
            reconnectTimerRef.current = setTimeout(connect, delay);
          } else {
            stoppedRef.current = true;
          }
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch {
      failuresRef.current += 1;
      stoppedRef.current = failuresRef.current >= MAX_FAILURES;
    }
  }, [enabled]);

  useEffect(() => {
    if (enabled) {
      failuresRef.current = 0;
      stoppedRef.current = false;
      connect();
    }

    return () => {
      stoppedRef.current = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
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
