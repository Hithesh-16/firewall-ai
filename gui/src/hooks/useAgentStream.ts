/**
 * useAgentStream — Phase K.K2 (SECURITY_HARDENING_PLAN.md).
 *
 * React hook that replaces the 5-second polling pattern in
 * `CoordinatorView.tsx` and `AgentManagerPage.tsx` with a real-time
 * SSE connection to `GET /api/agents/stream`. Exposes the same
 * shape as deepagents' `useStream`:
 *
 *   const { messages, subagents, todos, status, error } = useAgentStream(sessionId);
 *
 * Falls back to the existing 5s poll when the SSE endpoint returns
 * non-200 (proxy hasn't been upgraded yet) or when EventSource is
 * unavailable. The hook is therefore safe to ship before the proxy
 * endpoint exists — it just degrades to a polling loop.
 *
 * Status: "connecting" | "streaming" | "disconnected" | "polling"
 */

import { useCallback, useEffect, useRef, useState } from "react";

// The GUI webview talks to the proxy via loopback (same pattern as
// AddModelForm.tsx:110 and useSubmitOnboarding.ts). The web standalone
// app reads this from `config/env.ts`; the GUI hardcodes it.
const PROXY_BASE = "http://localhost:8080";

// ── Types ───────────────────────────────────────────────────────

interface SubagentSnapshot {
  taskId: string;
  name: string;
  status: string;
  progress: number;
  resultSummary?: string;
}

interface StreamState {
  subagents: SubagentSnapshot[];
  todos: string | null;
  status: "connecting" | "streaming" | "disconnected" | "polling";
  error: string | null;
  /** Epoch-ms of last event received. */
  lastEventAt: number | null;
}

const POLL_INTERVAL_MS = 5000;

// ── Hook ────────────────────────────────────────────────────────

export function useAgentStream(sessionId: string | undefined): StreamState {
  const [state, setState] = useState<StreamState>({
    subagents: [],
    todos: null,
    status: "connecting",
    error: null,
    lastEventAt: null,
  });

  const eventSourceRef = useRef<EventSource | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── SSE path ──────────────────────────────────────────────────

  const connectSSE = useCallback(() => {
    if (!sessionId) return;

    const url = `${PROXY_BASE}/api/agents/stream?sessionId=${encodeURIComponent(sessionId)}`;
    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.onopen = () => {
      setState((s) => ({ ...s, status: "streaming", error: null }));
    };

    es.addEventListener("subagent.start", (e) => {
      try {
        const event = JSON.parse(e.data);
        const data = event.data as SubagentSnapshot;
        setState((s) => ({
          ...s,
          subagents: [
            ...s.subagents.filter((a) => a.taskId !== data.taskId),
            data,
          ],
          lastEventAt: Date.now(),
        }));
      } catch {
        // malformed — skip
      }
    });

    es.addEventListener("subagent.progress", (e) => {
      try {
        const event = JSON.parse(e.data);
        const data = event.data as { taskId: string; progress: number };
        setState((s) => ({
          ...s,
          subagents: s.subagents.map((a) =>
            a.taskId === data.taskId ? { ...a, progress: data.progress } : a,
          ),
          lastEventAt: Date.now(),
        }));
      } catch {
        // skip
      }
    });

    es.addEventListener("subagent.end", (e) => {
      try {
        const event = JSON.parse(e.data);
        const data = event.data as SubagentSnapshot;
        setState((s) => ({
          ...s,
          subagents: s.subagents.map((a) =>
            a.taskId === data.taskId
              ? { ...a, status: data.status, resultSummary: data.resultSummary }
              : a,
          ),
          lastEventAt: Date.now(),
        }));
      } catch {
        // skip
      }
    });

    es.addEventListener("todo.update", (e) => {
      try {
        const event = JSON.parse(e.data);
        setState((s) => ({
          ...s,
          todos: (event.data as { checklist: string }).checklist,
          lastEventAt: Date.now(),
        }));
      } catch {
        // skip
      }
    });

    es.onerror = () => {
      // SSE failed — fall back to polling.
      es.close();
      eventSourceRef.current = null;
      setState((s) => ({
        ...s,
        status: "polling",
        error: "SSE disconnected — falling back to polling",
      }));
      startPolling();
    };
  }, [sessionId]);

  // ── Polling fallback ──────────────────────────────────────────

  const startPolling = useCallback(() => {
    if (!sessionId) return;
    if (pollTimerRef.current) return; // already polling

    const poll = async () => {
      try {
        const res = await fetch(`${PROXY_BASE}/api/agents?active=true`);
        if (!res.ok) return;
        const data = (await res.json()) as { agents?: SubagentSnapshot[] };
        setState((s) => ({
          ...s,
          subagents: data.agents ?? [],
          lastEventAt: Date.now(),
        }));
      } catch {
        // network error — keep polling
      }
    };

    void poll();
    pollTimerRef.current = setInterval(poll, POLL_INTERVAL_MS);
  }, [sessionId]);

  // ── Lifecycle ─────────────────────────────────────────────────

  useEffect(() => {
    if (!sessionId) return;

    // Try SSE first; fall back to polling on error.
    if (typeof EventSource !== "undefined") {
      connectSSE();
    } else {
      setState((s) => ({ ...s, status: "polling" }));
      startPolling();
    }

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
      }
      setState((s) => ({ ...s, status: "disconnected" }));
    };
  }, [sessionId, connectSSE, startPolling]);

  return state;
}
