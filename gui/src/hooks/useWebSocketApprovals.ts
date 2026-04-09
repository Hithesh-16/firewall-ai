import { useEffect, useRef } from "react";
import { useAppDispatch } from "../redux/hooks";
import {
  addPendingApproval,
  removePendingApproval,
  setPendingApprovals,
  type PendingApproval,
} from "../redux/slices/agentSlice";

const PROXY_URL = "http://localhost:8080";
const MAX_FAILURES = 3;
const BASE_DELAY_MS = 10_000;
const MAX_DELAY_MS = 60_000;

interface WsEvent {
  type: string;
  payload: Record<string, unknown>;
  timestamp: number;
}

/**
 * WebSocket hook for real-time approval events.
 *
 * Listens for `approval_needed` and `approval_resolved` events from the proxy.
 * On reconnect (WS drop, proxy restart), re-fetches pending approvals via REST
 * to recover any approvals that arrived while disconnected.
 */
export function useWebSocketApprovals() {
  const dispatch = useAppDispatch();
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let failures = 0;

    function connect() {
      const token = localStorage.getItem("afw_token");
      if (!token || failures >= MAX_FAILURES) return;

      const wsUrl =
        PROXY_URL.replace(/^http/, "ws") +
        `/ws?token=${encodeURIComponent(token)}`;

      try {
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          failures = 0;
          fetchPendingApprovals();
        };

        ws.onmessage = (event) => {
          try {
            const data: WsEvent = JSON.parse(event.data);

            if (data.type === "approval_needed") {
              const p = data.payload;
              dispatch(
                addPendingApproval({
                  requestId: p.requestId as number,
                  actionType: p.actionType as string,
                  resource: p.resource as string,
                  context: (p.context as Record<string, unknown>) ?? {},
                  timeoutMs: (p.timeoutMs as number) ?? 60000,
                  createdAt: data.timestamp,
                }),
              );
            }

            if (data.type === "approval_resolved") {
              dispatch(removePendingApproval(data.payload.requestId as number));
            }
          } catch {
            // Ignore malformed messages
          }
        };

        ws.onclose = () => {
          wsRef.current = null;
          failures += 1;
          if (failures < MAX_FAILURES) {
            const delay = Math.min(
              BASE_DELAY_MS * Math.pow(2, failures - 1),
              MAX_DELAY_MS,
            );
            reconnectTimerRef.current = setTimeout(connect, delay);
          }
        };

        ws.onerror = () => {
          ws.close();
        };
      } catch {
        failures += 1;
      }
    }

    async function fetchPendingApprovals() {
      const token = localStorage.getItem("afw_token");
      if (!token) return;

      try {
        const res = await fetch(`${PROXY_URL}/api/approvals/pending`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          const approvals: PendingApproval[] = (data ?? []).map(
            (a: Record<string, unknown>) => ({
              requestId: a.id as number,
              actionType: a.actionType as string,
              resource: a.resource as string,
              context: a.contextJson ? JSON.parse(a.contextJson as string) : {},
              timeoutMs: 60000,
              createdAt: a.createdAt as number,
            }),
          );
          dispatch(setPendingApprovals(approvals));
        }
      } catch {
        // Proxy may be offline — will retry on next reconnect
      }
    }

    connect();

    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [dispatch]);
}
