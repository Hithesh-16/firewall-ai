import crypto from "node:crypto";
import {
  extractScanHeaders,
  fetchwithRequestOptions,
} from "@ai-firewall/fetch";
import {
  scanSecrets,
  scanPII,
  scanPromptInjection,
  scanEntropy,
} from "@ai-firewall/scanner";
import {
  firewallLocalCache,
  firewallSimHashCache,
  firewallMetrics,
  maybeLogFirewallMetrics,
} from "../firewall/cache.js";
import { getThinnedContextWithHash } from "../firewall/thinContext.js";
import { classifyWithPromptGuard2 } from "../firewall/classifiers/promptGuard2.js";

const SCAN_URL = "http://127.0.0.1:8080/api/scan";
const SCAN_TIMEOUT_MS = 5000;

// ── Session-scoped delta-scan state ───────────────────────────────────────────
// Previously this was a single module-level `let`, which meant the IDE path
// (core/llm/index.ts) and the CLI path (extensions/cli/src/stream/*) shared one
// slot and poisoned each other whenever both were active. We now key by
// sessionId with LRU + TTL so concurrent sessions each keep their own state
// without growing unbounded.
const DELTA_STATE_TTL_MS = 30 * 60 * 1000; // 30 min
const DELTA_STATE_MAX_SESSIONS = 1000;
const DEFAULT_SESSION_KEY = "__global__";

interface DeltaStateEntry {
  hash: string;
  at: number;
}

const deltaStateBySession = new Map<string, DeltaStateEntry>();

function getDeltaState(sessionId: string): string | undefined {
  const entry = deltaStateBySession.get(sessionId);
  if (!entry) return undefined;
  if (Date.now() - entry.at > DELTA_STATE_TTL_MS) {
    deltaStateBySession.delete(sessionId);
    return undefined;
  }
  return entry.hash;
}

function setDeltaState(sessionId: string, hash: string): void {
  if (deltaStateBySession.size >= DELTA_STATE_MAX_SESSIONS) {
    const oldestKey = deltaStateBySession.keys().next().value;
    if (oldestKey) deltaStateBySession.delete(oldestKey);
  }
  deltaStateBySession.set(sessionId, { hash, at: Date.now() });
}

// ── In-flight scan coalescing ─────────────────────────────────────────────────
// Agentic loops can trigger the same scan from multiple code paths in the same
// tick. Dedup concurrent identical scans so only one pays the L1/L2/L3 cost.
// Pattern adapted from kilocode's withInFlightCache util.
const inFlightScans = new Map<string, Promise<PreflightScanResult>>();

function inFlightKey(
  sessionId: string,
  body: string,
  forceRedact: boolean,
): string {
  const bodyHash = crypto
    .createHash("sha256")
    .update(body)
    .digest("hex")
    .slice(0, 16);
  return `${sessionId}:${forceRedact ? "R" : "N"}:${bodyHash}`;
}

/**
 * Compact finding shape mirrored from the proxy's `X-AF-Findings`
 * header / 403 BLOCK response body. Lives in core so the GUI can
 * type-narrow against it without importing from the proxy.
 */
export interface FirewallFinding {
  /** Pattern type — e.g. "OPENAI_PROJECT_KEY", "EMAIL", "PROMPT_INJECTION". */
  type: string;
  /** Severity — "critical" | "high" | "medium" | "low" or whatever the scanner emits. */
  severity?: string;
  /** Pre-masked display value the GUI may render (never the raw secret). */
  masked?: string;
}

export interface PreflightScanResult {
  finalBody: string;
  blocked: boolean;
  blockMessage?: string;
  /** When blocked, the structured payload from the proxy (if available). */
  blockDetail?: BlockDetail;
  cachedHit?: boolean;
}

export interface BlockDetail {
  riskScore: number;
  reasons: string[];
  findings: FirewallFinding[];
  action: "BLOCK" | "REDACT" | "ALLOW";
}

/**
 * Typed error the LLM layer throws when the firewall blocks a request.
 *
 * Detected by `gui/src/pages/gui/StreamError.tsx` to render a
 * firewall-themed dialog (with masked findings + remediation guidance)
 * instead of the generic "Error handling model response" surface.
 *
 * Subclasses `Error` so any existing `catch (e)` blocks keep working
 * without changes — the structured detail is on `error.detail`.
 */
export class FirewallBlockedRequestError extends Error {
  readonly name = "FirewallBlockedRequestError";
  readonly detail: BlockDetail;

  constructor(message: string, detail: BlockDetail) {
    super(message);
    this.detail = detail;
  }
}

export function isFirewallBlockedRequestError(
  e: unknown,
): e is FirewallBlockedRequestError {
  return e instanceof Error && e.name === "FirewallBlockedRequestError";
}

/**
 * Pre-flight scan: sends request body to the AI Firewall proxy
 * for secret/PII/injection scanning before forwarding to any LLM.
 *
 * - BLOCK  -> returns blocked=true with reason + structured detail
 * - REDACT -> returns finalBody with sanitised messages
 * - ALLOW  -> returns original body unchanged
 * - Proxy unreachable -> fail-open (returns original body)
 *
 * When `forceRedact` is set, the proxy is asked to downgrade any BLOCK
 * decision to REDACT — used after the user explicitly consents to send
 * a sanitised version of a previously-blocked prompt.
 */
export async function firewallCascade(
  body: string,
  model: string,
  forceRedact = false,
  sessionId: string = DEFAULT_SESSION_KEY,
): Promise<PreflightScanResult> {
  // ── In-flight coalescing ────────────────────────────────────────────────
  // If another caller is already scanning the same (sessionId, body, redact)
  // combo, share that promise instead of doing the work twice. The cache key
  // is intentionally identical across callers (IDE and CLI) so cross-consumer
  // duplicate scans also collapse.
  const key = inFlightKey(sessionId, body, forceRedact);
  const pending = inFlightScans.get(key);
  if (pending) return pending;

  const task = runCascade(body, model, forceRedact, sessionId);
  inFlightScans.set(key, task);
  try {
    return await task;
  } finally {
    inFlightScans.delete(key);
  }
}

async function runCascade(
  body: string,
  model: string,
  forceRedact: boolean,
  sessionId: string,
): Promise<PreflightScanResult> {
  try {
    const parsed = JSON.parse(body);
    const messages = parsed?.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      return { finalBody: body, blocked: false, cachedHit: false };
    }

    // Track total scan attempts for metrics
    firewallMetrics.totalScans++;
    // Best-effort: emit a metrics snapshot to the debug logger every N scans.
    maybeLogFirewallMetrics();

    // Step L0: Cache Lookup
    // We cache based on the normalized raw body
    const cachedVerdict = firewallLocalCache.get(body);
    if (cachedVerdict) {
      // Blocks are cached with a short TTL (60s) so rapid retries of the same
      // blocked prompt don't re-run L1+L2. Honour both verdict kinds.
      return { ...cachedVerdict, cachedHit: true };
    }

    // Step L0b: SimHash Near-Duplicate Lookup (fallback)
    // Uses fuzzy matching for 5-20% additional hits. Never returns blocks.
    const simHashResult = await firewallSimHashCache.getNearMatch(body);
    if (simHashResult && !simHashResult.blocked) {
      return { ...simHashResult, cachedHit: true };
    }

    // Context Thinning: Send only System + Last 6 turns to the cascade
    // AND generate state hash for delta scanning
    const { thinnedMessages, stateHash } = getThinnedContextWithHash(
      messages,
      6,
    );
    const thinnedText = thinnedMessages
      .map((m: any) =>
        typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      )
      .join("\n");

    // Delta scanning: If this session's last-scanned state matches, skip the
    // full cascade. Scoped per-session so concurrent sessions don't poison
    // each other's state.
    const priorHash = getDeltaState(sessionId);
    if (priorHash && stateHash === priorHash) {
      return { finalBody: body, blocked: false, cachedHit: true };
    }

    // Update state hash for next call (per session)
    setDeltaState(sessionId, stateHash);

    // ── Step L1: Static scanning via @ai-firewall/scanner (zero-cost, <2ms) ────────
    // Uses the canonical shared scanner package — the same one the proxy uses.
    // Covers: 19 secret patterns, PII, entropy anomalies, and 22 injection patterns.
    // No duplication: patterns live only in packages/scanner/src/patterns.ts.
    const secretResult = scanSecrets(thinnedText);
    const entropyMatches = scanEntropy(thinnedText);
    const allSecrets = [...secretResult.secrets, ...entropyMatches];

    if (allSecrets.length > 0) {
      firewallMetrics.l1Blocks++;
      const topSecret = allSecrets[0];
      const masked =
        topSecret.value.length > 8
          ? `${topSecret.value.slice(0, 4)}${"*".repeat(Math.min(topSecret.value.length - 6, 12))}${topSecret.value.slice(-2)}`
          : "****";
      const detail: BlockDetail = {
        action: "BLOCK",
        riskScore: 95,
        reasons: [`L1 detected: ${topSecret.type} (${topSecret.severity})`],
        findings: allSecrets.map((s) => ({
          type: s.type,
          severity: s.severity,
          masked,
        })),
      };
      const result: PreflightScanResult = {
        finalBody: body,
        blocked: true,
        blockMessage: `AI Firewall blocked this request — ${topSecret.type} detected.`,
        blockDetail: detail,
        cachedHit: false,
      };
      // Cache with short TTL (see BLOCK_TTL_MS in firewall/cache.ts) so a
      // rapid retry doesn't re-run L1. SimHash cache is intentionally skipped
      // for blocks (security: never fuzzy-match a block).
      firewallLocalCache.set(body, result);
      return result;
    }

    // PII check (soft-block: can be redacted but not fail-closed by default)
    const piiResult = scanPII(thinnedText);
    if (piiResult.pii.length > 0 && !forceRedact) {
      // PII found — fall through to L3 proxy which handles REDACT policy
      // (leave the proxy in charge of PII policy decisions)
    }

    // Injection check
    const injectionResult = scanPromptInjection(thinnedText, 60);
    if (injectionResult.isInjection) {
      firewallMetrics.l1Blocks++;
      const detail: BlockDetail = {
        action: "BLOCK",
        riskScore: injectionResult.score,
        reasons: [
          `L1 injection detected (score: ${injectionResult.score}): ${injectionResult.matches.map((m) => m.pattern).join(", ")}`,
        ],
        findings: [],
      };
      const result: PreflightScanResult = {
        finalBody: body,
        blocked: true,
        blockMessage: `AI Firewall blocked this request — prompt injection detected.`,
        blockDetail: detail,
        cachedHit: false,
      };
      firewallLocalCache.set(body, result);
      return result;
    }

    // ── Step L2: Local ONNX Classifier (5–20ms, zero tokens) ──────────────────
    // Only runs if L1 passed. Gracefully falls back to ESCALATE if the
    // @huggingface/transformers package isn't installed yet.
    const l2Result = await classifyWithPromptGuard2(thinnedText);
    if (l2Result.decision === "BLOCK") {
      firewallMetrics.l2Blocks++;
      const detail: BlockDetail = {
        action: "BLOCK",
        riskScore: Math.round(l2Result.confidence * 100),
        reasons: [
          `L2 classifier detected JAILBREAK (confidence: ${(l2Result.confidence * 100).toFixed(1)}%)`,
        ],
        findings: [],
      };
      const result: PreflightScanResult = {
        finalBody: body,
        blocked: true,
        blockMessage: `AI Firewall blocked this request — prompt injection detected.`,
        blockDetail: detail,
        cachedHit: false,
      };
      firewallLocalCache.set(body, result);
      return result;
    }

    if (l2Result.decision === "ALLOW") {
      // High-confidence benign result — skip L3 entirely, cache and return
      const result: PreflightScanResult = {
        finalBody: body,
        blocked: false,
        cachedHit: false,
      };
      firewallLocalCache.set(body, result);
      // Also add to SimHash for near-duplicate matching
      firewallSimHashCache.set(body, result).catch(() => {});
      return result;
    }

    // ── Step L3: Proxy Escalation (~5% of traffic) ─────────────────────────────
    // Only fires when L2 confidence is ambiguous (0.3–0.7).
    firewallMetrics.l3Escapes++;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SCAN_TIMEOUT_MS);

    try {
      const scanResp = await fetchwithRequestOptions(
        new URL(SCAN_URL),
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: thinnedMessages.map((m: any) => ({
              role: m.role,
              content:
                typeof m.content === "string"
                  ? m.content
                  : JSON.stringify(m.content),
            })),
            model: parsed.model || model,
            forceRedact: forceRedact || undefined,
          }),
          signal: controller.signal,
        },
        {},
      );

      clearTimeout(timer);

      // Fire scan result listeners so the GUI updates
      extractScanHeaders(scanResp);

      if (scanResp.status === 403) {
        // Read as text first, then try to parse. A bare
        // `scanResp.json()` throws a cryptic V8
        // "Unexpected non-whitespace character after JSON at
        // position N" when the proxy returns anything that isn't
        // valid JSON (broken build, upstream proxy, HTML error
        // page). Surface those the same way we fail-open below
        // instead of killing the whole chat with a useless stack.
        const rawText = await scanResp.text().catch(() => "");
        let d: {
          riskScore?: number;
          reasons?: string[];
          findings?: FirewallFinding[];
          secrets?: Array<{ type: string; severity?: string; masked?: string }>;
          pii?: Array<{ type: string; severity?: string; masked?: string }>;
        } = {};
        try {
          if (rawText.trim()) d = JSON.parse(rawText);
        } catch {
          // Block with an empty detail — better than crashing.
          d = { reasons: ["AI Firewall scan returned non-JSON"] };
        }
        const detail: BlockDetail = {
          action: "BLOCK",
          riskScore: d.riskScore ?? 0,
          reasons: d.reasons ?? [],
          // Prefer the unified `findings` array; fall back to merging
          // the older shape if the proxy hasn't been redeployed yet.
          findings:
            d.findings ??
            [...(d.secrets ?? []), ...(d.pii ?? [])].map((f) => ({
              type: f.type,
              severity: f.severity,
              masked: f.masked,
            })),
        };
        return {
          finalBody: body,
          blocked: true,
          blockMessage:
            "AI Firewall blocked this request (risk: " +
            detail.riskScore +
            "). " +
            detail.reasons.join("; "),
          blockDetail: detail,
        };
      }

      if (scanResp.ok) {
        // Same read-as-text-then-parse pattern as the 403 branch
        // above — defend against a proxy that streams or otherwise
        // returns a body JSON.parse rejects. An unparseable 200 is
        // treated as "no scan signal" (fail-open).
        const rawText = await scanResp.text().catch(() => "");
        let d: any = {};
        try {
          if (rawText.trim()) d = JSON.parse(rawText);
        } catch {
          d = {};
        }
        if (d.action === "REDACT" && d.sanitizedMessages) {
          const result = {
            finalBody: JSON.stringify({
              ...parsed,
              messages: d.sanitizedMessages,
            }),
            blocked: false,
          };
          // Cache benign/redacted result
          firewallLocalCache.set(body, result);
          // Also add to SimHash for near-duplicate matching
          firewallSimHashCache.set(body, result).catch(() => {});
          return result;
        }
      }

      const result = { finalBody: body, blocked: false };
      // Cache benign result
      firewallLocalCache.set(body, result);
      // Also add to SimHash for near-duplicate matching
      firewallSimHashCache.set(body, result).catch(() => {});
      return result;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    // Fail-open: if proxy is unreachable, allow the request through
    return { finalBody: body, blocked: false };
  }
}

/**
 * Backward-compatible alias — existing callers (core/llm/index.ts,
 * extensions/cli/src/stream/streamChatResponse.ts) can migrate
 * incrementally. New code should call firewallCascade directly.
 *
 * @deprecated Use firewallCascade instead.
 */
export const firewallPreflightScan = firewallCascade;

/**
 * Test-only hooks. Not part of the public API — used by
 * `core/llm/firewallScan.test.ts` to reset cross-test state so the replay
 * regression test observes a deterministic cold → warm cache transition.
 */
export function __resetFirewallStateForTests(): void {
  deltaStateBySession.clear();
  inFlightScans.clear();
}
