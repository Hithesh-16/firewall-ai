import { AsyncLocalStorage } from "node:async_hooks";
import type { ScanReport } from "./FileBlockedByScanError.js";

/**
 * Per-session pub/sub that threads scan reports from the decorator
 * (wherever a file gets read) up to the chat layer (which attaches
 * the report as a context item on the next message).
 *
 * Scoping is by `correlationId`. Core wraps each user-turn handler
 * in `runInScanContext(correlationId, fn)`; the decorator reads the
 * current correlation id via `currentCorrelationId()` and publishes
 * reports against it. Subscribers drain reports keyed to their own
 * correlation id — crosstalk is impossible.
 *
 * Without a correlation id the publish is silently dropped (the
 * read happened outside any user turn, e.g. indexing startup) so
 * reports never leak across turns.
 */

const als = new AsyncLocalStorage<{ correlationId: string }>();

type Handler = (report: ScanReport) => void;
const handlers = new Map<string, Set<Handler>>();

/** Wrap an async function so any scan reports it publishes get tagged with `correlationId`. */
export function runInScanContext<T>(
  correlationId: string,
  fn: () => Promise<T> | T,
): Promise<T> | T {
  return als.run({ correlationId }, fn);
}

/** Synchronous variant for tests and hot paths that don't return a promise. */
export function runInScanContextSync<T>(correlationId: string, fn: () => T): T {
  return als.run({ correlationId }, fn);
}

/** Returns the correlation id of the current async context, or `undefined`. */
export function currentCorrelationId(): string | undefined {
  return als.getStore()?.correlationId;
}

/** Publish a report. Dropped if no correlation context or no subscribers. */
export function publishScanReport(report: ScanReport): void {
  const cid = currentCorrelationId();
  if (!cid) return;
  const set = handlers.get(cid);
  if (!set || set.size === 0) return;
  for (const handler of set) {
    try {
      handler(report);
    } catch {
      // Don't let a handler crash the caller.
    }
  }
}

/**
 * Subscribe to reports for a specific correlation id. Returns an
 * unsubscribe function; callers MUST invoke it at turn-end (use
 * try/finally) to prevent leaks when a turn completes.
 */
export function subscribeScanReports(
  correlationId: string,
  handler: Handler,
): () => void {
  let set = handlers.get(correlationId);
  if (!set) {
    set = new Set();
    handlers.set(correlationId, set);
  }
  set.add(handler);
  return () => {
    const s = handlers.get(correlationId);
    if (!s) return;
    s.delete(handler);
    if (s.size === 0) handlers.delete(correlationId);
  };
}

/**
 * Collect reports for a correlation id, deduped by file path.
 * Returned reports preserve insertion order (so the chat shows them
 * in the order files were read). The caller is responsible for
 * subscribing + unsubscribing around the window of interest.
 */
export function dedupeReports(reports: ScanReport[]): ScanReport[] {
  const seen = new Set<string>();
  const out: ScanReport[] = [];
  for (const r of reports) {
    if (seen.has(r.filePath)) continue;
    seen.add(r.filePath);
    out.push(r);
  }
  return out;
}

/** For tests. */
export function _resetScanReportChannel(): void {
  handlers.clear();
}
