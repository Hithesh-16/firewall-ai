/**
 * Unified Streaming Event Taxonomy — Phase K.K1
 * (SECURITY_HARDENING_PLAN.md).
 *
 * Defines the event shapes emitted alongside OpenAI SSE chunks on
 * `/v1/chat/completions` when the client opts in via the
 * `X-AF-Stream: events` header. Each event is a single JSON line
 * prefixed with `event:` in the SSE stream.
 *
 * Design principles:
 *   - Every event has `{type, ns?, ts, data}` so a generic consumer
 *     can route by type without parsing `data`.
 *   - `ns` (namespace) is set when the event originates from a
 *     subagent — it carries the subagent's task ID so the frontend
 *     can group sub-streams per agent (same pattern deepagents uses
 *     with `("tools:uuid",)` tuples).
 *   - The taxonomy is additive — new event types slot in by adding
 *     a variant to `StreamEventType` and a corresponding `data`
 *     shape, without touching emitter or consumer code.
 *   - `X-AF-Stream: events` opt-in keeps existing clients working
 *     on the plain OpenAI SSE format (decision Q3 in Phase K plan).
 *     The plan targets flipping the GUI to event-mode by default
 *     after 60 days.
 *
 * Emitters: `ai.route.ts` (main chat), `agentService.ts` (subagent
 * lifecycle), `approvalService.ts` (HITL prompts). Each calls
 * `formatStreamEvent(event)` → `event: ${JSON.stringify(event)}\n\n`.
 *
 * Consumers: `gui/src/hooks/useAgentStream.ts` (Phase K.K2, not
 * yet implemented), CLI event renderer (future).
 */

// ── Event types ─────────────────────────────────────────────────

export type StreamEventType =
  // Subagent lifecycle
  | "subagent.start"
  | "subagent.token"
  | "subagent.progress"
  | "subagent.end"
  // Tool calls
  | "tool.call.start"
  | "tool.call.delta"
  | "tool.call.final"
  // Planning / todos
  | "todo.update"
  // Memory
  | "memory.update"
  // Scan / firewall
  | "scan.finding"
  | "scan.action"
  // HITL approval
  | "approval.needed"
  | "approval.resolved";

// ── Event shape ─────────────────────────────────────────────────

export interface StreamEvent<T = unknown> {
  /** Event type — used by consumers for routing. */
  readonly type: StreamEventType;
  /**
   * Namespace — set when the event originates from a subagent.
   * Carries the subagent's task ID so frontends can group sub-
   * streams per agent.
   */
  readonly ns?: string;
  /** Epoch-ms timestamp. */
  readonly ts: number;
  /** Payload — shape depends on `type`. */
  readonly data: T;
}

// ── Typed payloads per event ────────────────────────────────────

export interface SubagentStartData {
  taskId: string;
  name: string;
  description: string;
  model?: string;
}

export interface SubagentTokenData {
  taskId: string;
  /** The text chunk. */
  content: string;
}

export interface SubagentProgressData {
  taskId: string;
  /** 0-100 */
  progress: number;
  description?: string;
}

export interface SubagentEndData {
  taskId: string;
  status: "completed" | "failed" | "killed";
  resultSummary?: string;
  error?: string;
}

export interface ToolCallStartData {
  toolCallId: string;
  toolName: string;
  arguments?: string;
}

export interface ToolCallDeltaData {
  toolCallId: string;
  /** Incremental argument JSON. */
  argumentsDelta: string;
}

export interface ToolCallFinalData {
  toolCallId: string;
  toolName: string;
  arguments: string;
  result?: string;
}

export interface TodoUpdateData {
  /** The full todo list (markdown). */
  checklist: string;
}

export interface MemoryUpdateData {
  action: "saved" | "deleted";
  name: string;
  type: "user" | "feedback" | "project" | "reference";
}

export interface ScanFindingData {
  filePath?: string;
  type: string;
  severity: string;
  masked?: string;
}

export interface ScanActionData {
  action: "ALLOW" | "REDACT" | "BLOCK";
  riskScore: number;
  reasons: string[];
}

export interface ApprovalNeededData {
  requestId: number;
  actionType: string;
  resource: string;
  riskScore: number;
}

export interface ApprovalResolvedData {
  requestId: number;
  decision: "allow" | "deny" | "edit";
}

// ── Factories ───────────────────────────────────────────────────

export function createStreamEvent<T>(
  type: StreamEventType,
  data: T,
  ns?: string,
): StreamEvent<T> {
  return { type, ts: Date.now(), data, ...(ns ? { ns } : {}) };
}

// ── SSE serialization ───────────────────────────────────────────

/**
 * Format a `StreamEvent` as an SSE `event:` line. The result is a
 * complete SSE frame (including the trailing double-newline) ready
 * to be written to the response stream.
 *
 * The `event:` field uses the event type as its name so
 * `EventSource`-based clients can register per-type listeners.
 */
export function formatStreamEvent(event: StreamEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/**
 * Check whether the inbound request opted into event-mode streaming.
 * Returns `true` when the `X-AF-Stream` header is `events`.
 */
export function isEventStreamRequested(
  headers: Record<string, string | string[] | undefined>,
): boolean {
  const value = headers["x-af-stream"];
  if (typeof value === "string") return value.toLowerCase() === "events";
  if (Array.isArray(value))
    return value.some((v) => v.toLowerCase() === "events");
  return false;
}
