import { useEffect, useRef, useState } from "react";
import { wsClient, type WsHandler } from "../api/websocket";

export function useWebSocket(handlers?: Record<string, WsHandler>): {
  connected: boolean;
} {
  const [connected, setConnected] = useState(false);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    wsClient.connect();

    const unsubs: (() => void)[] = [];

    unsubs.push(wsClient.on("connected", () => setConnected(true)));
    unsubs.push(wsClient.on("disconnected", () => setConnected(false)));

    // Register user-provided handlers
    if (handlersRef.current) {
      for (const [event, handler] of Object.entries(handlersRef.current)) {
        unsubs.push(wsClient.on(event, handler));
      }
    }

    return () => {
      for (const unsub of unsubs) unsub();
      wsClient.disconnect();
    };
  }, []);

  return { connected };
}
