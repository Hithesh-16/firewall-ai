/**
 * useCostTracker — Real-time session cost tracking hook.
 * Polls the proxy costTracker API and exposes session-level
 * and per-model cost/token data for GUI components.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useProxyApi } from "./useProxyApi";

// ── Types ──────────────────────────────────────────────────────

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUSD: number;
  requestCount: number;
}

export interface SessionCost {
  sessionId: string;
  totalCostUSD: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalRequests: number;
  modelUsage: Record<string, ModelUsage>;
  startedAt: number;
  lastRequestAt: number;
}

interface CostTrackerState {
  session: SessionCost | null;
  loading: boolean;
  error: string | null;
}

// ── Hook ───────────────────────────────────────────────────────

/**
 * Polls `/api/usage/summary` for session cost data.
 * @param sessionId - The current session ID (from sessionSlice or similar)
 * @param pollIntervalMs - How often to refresh (default 10s)
 */
export function useCostTracker(
  sessionId: string | null,
  pollIntervalMs = 10_000,
): CostTrackerState & { refresh: () => Promise<void> } {
  const { get } = useProxyApi();
  const [state, setState] = useState<CostTrackerState>({
    session: null,
    loading: false,
    error: null,
  });
  const mountedRef = useRef(true);

  const refresh = useCallback(async () => {
    if (!sessionId) return;

    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const data = await get<{
        totalRequests?: number;
        totalTokens?: number;
        totalInputTokens?: number;
        totalOutputTokens?: number;
        totalCost?: number;
        byModel?: Record<
          string,
          {
            requests: number;
            tokens: number;
            inputTokens?: number;
            outputTokens?: number;
            cost: number;
          }
        >;
      }>("/api/usage/summary");

      if (!mountedRef.current) return;

      // Map proxy usage summary to SessionCost shape.
      // Use real input/output tokens when the API provides them;
      // otherwise show only totalTokens (do NOT fabricate a split).
      const totalTokens = data.totalTokens ?? 0;
      const totalInput = data.totalInputTokens ?? totalTokens;
      const totalOutput = data.totalOutputTokens ?? 0;

      const modelUsage: Record<string, ModelUsage> = {};
      if (data.byModel) {
        for (const [model, usage] of Object.entries(data.byModel)) {
          modelUsage[model] = {
            inputTokens: usage.inputTokens ?? usage.tokens,
            outputTokens: usage.outputTokens ?? 0,
            cacheReadTokens: 0,
            costUSD: usage.cost,
            requestCount: usage.requests,
          };
        }
      }

      const session: SessionCost = {
        sessionId,
        totalCostUSD: data.totalCost ?? 0,
        totalInputTokens: totalInput,
        totalOutputTokens: totalOutput,
        totalRequests: data.totalRequests ?? 0,
        modelUsage,
        startedAt: Date.now(),
        lastRequestAt: Date.now(),
      };

      setState({ session, loading: false, error: null });
    } catch (err: unknown) {
      if (!mountedRef.current) return;
      const msg = err instanceof Error ? err.message : String(err);
      setState((prev) => ({ ...prev, loading: false, error: msg }));
    }
  }, [get, sessionId]);

  // Tie mountedRef lifecycle to the polling effect so cleanup is
  // always in sync with the interval (avoids race on sessionId change).
  useEffect(() => {
    if (!sessionId) return;

    mountedRef.current = true;
    refresh();
    const interval = setInterval(refresh, pollIntervalMs);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [sessionId, pollIntervalMs, refresh]);

  return { ...state, refresh };
}

// ── Formatting helpers ─────────────────────────────────────────

export function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

export function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return count.toString();
}
