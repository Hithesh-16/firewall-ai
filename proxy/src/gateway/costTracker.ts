/**
 * Session Cost Tracker
 *
 * Tracks cumulative cost and token usage per session, per model.
 * Used by GUI cost badge and CLI cost display.
 *
 * State is in-memory (per-process). For persistent cost data,
 * use the usage_logs table via usageService.
 */

// ── Types ──────────────────────────────────────────────────────

export interface ModelUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUSD: number;
  requestCount: number;
}

export interface SessionCost {
  readonly sessionId: string;
  readonly totalCostUSD: number;
  readonly totalInputTokens: number;
  readonly totalOutputTokens: number;
  readonly totalRequests: number;
  readonly modelUsage: Readonly<Record<string, ModelUsage>>;
  readonly startedAt: number;
  readonly lastRequestAt: number;
}

// ── State ──────────────────────────────────────────────────────

const sessions = new Map<
  string,
  {
    totalCostUSD: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalRequests: number;
    modelUsage: Record<string, ModelUsage>;
    startedAt: number;
    lastRequestAt: number;
  }
>();

// ── Track ──────────────────────────────────────────────────────

export function trackUsage(
  sessionId: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
  costUSD: number,
): void {
  let session = sessions.get(sessionId);
  if (!session) {
    session = {
      totalCostUSD: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalRequests: 0,
      modelUsage: {},
      startedAt: Date.now(),
      lastRequestAt: Date.now(),
    };
    sessions.set(sessionId, session);
  }

  session.totalCostUSD += costUSD;
  session.totalInputTokens += inputTokens;
  session.totalOutputTokens += outputTokens;
  session.totalRequests += 1;
  session.lastRequestAt = Date.now();

  if (!session.modelUsage[model]) {
    session.modelUsage[model] = {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      costUSD: 0,
      requestCount: 0,
    };
  }

  const mu = session.modelUsage[model];
  mu.inputTokens += inputTokens;
  mu.outputTokens += outputTokens;
  mu.costUSD += costUSD;
  mu.requestCount += 1;
}

// ── Query ──────────────────────────────────────────────────────

export function getSessionCost(sessionId: string): SessionCost | null {
  const session = sessions.get(sessionId);
  if (!session) return null;

  return {
    sessionId,
    ...session,
    modelUsage: { ...session.modelUsage },
  };
}

export function getAllSessionCosts(): SessionCost[] {
  return Array.from(sessions.entries()).map(([sessionId, s]) => ({
    sessionId,
    ...s,
    modelUsage: { ...s.modelUsage },
  }));
}

// ── Format ─────────────────────────────────────────────────────

export function formatSessionCost(sessionId: string): string {
  const session = sessions.get(sessionId);
  if (!session) return "No cost data for this session.";

  const lines: string[] = [
    `Session Cost: $${session.totalCostUSD.toFixed(4)}`,
    `Total tokens: ${session.totalInputTokens + session.totalOutputTokens} (${session.totalInputTokens} in / ${session.totalOutputTokens} out)`,
    `Requests: ${session.totalRequests}`,
    "",
    "Per model:",
  ];

  for (const [model, usage] of Object.entries(session.modelUsage)) {
    lines.push(
      `  ${model}: $${usage.costUSD.toFixed(4)} (${usage.inputTokens} in / ${usage.outputTokens} out, ${usage.requestCount} reqs)`,
    );
  }

  return lines.join("\n");
}

// ── Cleanup ────────────────────────────────────────────────────

export function clearSession(sessionId: string): boolean {
  return sessions.delete(sessionId);
}

export function clearAllSessions(): void {
  sessions.clear();
}

/**
 * Remove sessions older than maxAgeMs (default 24h).
 */
export function purgeOldSessions(maxAgeMs = 24 * 60 * 60 * 1000): number {
  const cutoff = Date.now() - maxAgeMs;
  let purged = 0;

  for (const [id, session] of sessions) {
    if (session.lastRequestAt < cutoff) {
      sessions.delete(id);
      purged++;
    }
  }

  return purged;
}
