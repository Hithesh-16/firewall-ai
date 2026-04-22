# Token Utilization Implementation Plan

## Overview

This plan implements the remaining optimizations from `token-utilisation-plan.md` to reduce token costs by 80-90% on typical agentic coding sessions.

**Current State**: ~70% of optimizations already implemented  
**Target State**: Full plan compliance with instrumentation

---

## Phase 1: Cache Improvements (HIGH Priority)

### 1.1 Add TTL to Firewall Cache

**File**: `core/firewall/cache.ts`

```typescript
interface CacheEntry {
  result: PreflightScanResult;
  timestamp: number;
  ttl: number; // milliseconds
}

export class FirewallExactHashCache {
  private cache = new Map<string, CacheEntry>();
  private readonly maxCapacity = 10000;
  private readonly defaultTTL = 5 * 60 * 1000; // 5 minutes default

  // Add TTL parameter to set()
  public set(
    prompt: string,
    result: PreflightScanResult,
    ttl?: number,
    policyVersion?: string,
  ): void {
    if (this.cache.size >= this.maxCapacity) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    const key = this.generateKey(prompt, policyVersion);
    this.cache.set(key, {
      result,
      timestamp: Date.now(),
      ttl: ttl ?? this.defaultTTL,
    });
  }

  public get(
    prompt: string,
    policyVersion?: string,
  ): PreflightScanResult | undefined {
    const key = this.generateKey(prompt, policyVersion);
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    // Evict expired entries
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.result;
  }
}
```

**Changes**:

- Wrap stored values in `CacheEntry` with timestamp + TTL
- Evict expired entries on `get()`
- Default TTL: 5 minutes for all verdicts
- Never cache BLOCK/negative verdicts with TTL > 60 seconds

---

### 1.2 Explicit TTL in Anthropic Cache Breakpoints

**File**: `core/llm/promptOptimizer.ts`

Current code (line 179):

```typescript
if (msg.role === "system") return injectCacheControl(msg, "1h");
```

**Add explicit TTL to ALL breakpoints**:

```typescript
// Line 147: injectCacheControl helper
const injectCacheControl = (msg: T, ttl?: string): T => {
  const cacheControl: Record<string, string> = { type: "ephemeral" };
  if (ttl) {
    cacheControl.ttl = ttl;
  } else {
    // CRITICAL: Default to 1h for Anthropic's March 2026 change
    cacheControl.ttl = "1h";
  }
  // ...
};

// Rolling breakpoints need explicit TTL
if (breakpointSet.has(i)) return injectCacheControl(msg, "5m");
```

**Changes**:

- System message: `ttl: "1h"` ✅ (already correct)
- 20%/50%/80% breakpoints: Add `ttl: "5m"` explicitly
- Last user turn: Add `ttl: "5m"` explicitly

---

### 1.3 OpenAI Session Pinning

**File**: `extensions/cli/src/stream/streamChatResponse.ts` (around line 385)

```typescript
// Add sessionId to request for prompt caching
const sessionId = services.session?.getSessionId?.() ?? uuidv4();

return await chatCompletionStreamWithBackoff(
  llmApi,
  {
    model: model.model,
    messages: optimizedHistory,
    stream: true,
    tools,
    ...getDefaultCompletionOptions(model.defaultCompletionOptions),
    // OpenAI prompt caching: pin to session
    ...(model.provider === "openai"
      ? {
          extra_body: {
            prompt_cache_key: sessionId,
            prompt_cache_retention: "24h",
          },
        }
      : {}),
  },
  retryAbortSignal,
);
```

**Changes**:

- Generate/use session ID
- Add `prompt_cache_key` + `prompt_cache_retention` for OpenAI requests
- Other providers (Anthropic, Gemini) already use their own caching mechanisms

---

## Phase 2: Delta/Incremental Scanning (MEDIUM Priority)

### 2.1 Session State Hash for Delta Scanning

**File**: `core/firewall/thinContext.ts`

```typescript
import crypto from "node:crypto";

export interface ThinContextResult {
  thinnedMessages: T[];
  stateHash: string;
}

/**
 * Extracts thinned context + a hash representing current session state.
 * If stateHash matches previous scan, skip re-scanning (identical context).
 */
export function getThinnedContextWithHash<T extends { role: string }>(
  messages: T[],
  maxTurns: number = 6,
): ThinContextResult {
  // Always include system message
  const systemMessage = messages.find((m) => m.role === "system");
  const thinned: T[] = systemMessage ? [systemMessage] : [];

  // Get last N turns
  const nonSystemIdxs = messages.filter((m) => m.role !== "system");
  const recent = nonSystemIdxs.slice(-maxTurns);

  const result = [...thinned, ...recent];

  // Generate state hash from message content hashes
  const stateHash = crypto
    .createHash("sha256")
    .update(result.map((m) => JSON.stringify(m)).join("|"))
    .digest("hex")
    .slice(0, 16); // First 16 chars sufficient for dedup

  return { thinnedMessages: result, stateHash };
}
```

**Changes**:

- Return state hash alongside thinned messages
- Hash based on message content, not just count
- CLI uses hash to skip identical scans

---

### 2.2 Firewall Scan with Delta Detection

**File**: `core/llm/firewallScan.ts`

```typescript
// At top of firewallCascade function
let previousStateHash: string | undefined;

export async function firewallCascade(
  body: string,
  model: string,
  forceRedact = false,
  previousStateHash?: string, // NEW PARAM
): Promise<PreflightScanResult> {
  // ...

  const { thinnedMessages, stateHash } = getThinnedContextWithHash(messages, 6);

  // If state unchanged, skip scanning entirely
  if (previousStateHash && stateHash === previousStateHash) {
    return { finalBody: body, blocked: false, cachedHit: true };
  }

  // ... rest of cascade
}
```

---

## Phase 3: SimHash Near-Duplicate Cache (MEDIUM Priority)

### 3.1 SimHash Implementation

**File**: `core/firewall/cache.ts`

```typescript
import crypto from "node:crypto";

/**
 * SimHash for near-duplicate detection.
 * Allows finding prompts that are "similar enough" to cached verdicts.
 */
class SimHash {
  private static readonly FEATURES = 64;

  static async hash(text: string): Promise<string> {
    // Normalize: lowercase, trim, remove extra whitespace
    const normalized = text.toLowerCase().trim().replace(/\s+/g, " ");

    // Simple bag-of-words hash (production should use proper tokenizer)
    const words = normalized.split(" ");
    const bits = new Array(SimHash.FEATURES).fill(0);

    for (const word of words) {
      const wordHash = crypto.createHash("md5").update(word).digest("hex");

      for (let i = 0; i < SimHash.FEATURES; i++) {
        const bit = parseInt(wordHash[i % wordHash.length], 16) % 2;
        bits[i] += bit === 0 ? -1 : 1;
      }
    }

    return bits.map((b) => (b >= 0 ? "1" : "0")).join("");
  }

  static hammingDistance(a: string, b: string): number {
    let distance = 0;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) distance++;
    }
    return distance;
  }
}

export class FirewallSimHashCache {
  private cache = new Map<
    string,
    { result: PreflightScanResult; hash: string; timestamp: number }
  >();
  private readonly maxCapacity = 5000;
  private readonly simThreshold = 3; // Hamming distance threshold for "similar"

  private async generateKey(text: string): Promise<string> {
    return SimHash.hash(text);
  }

  public async getNearMatch(
    text: string,
    ttlMs: number = 5 * 60 * 1000,
  ): Promise<PreflightScanResult | null> {
    const hash = await this.generateKey(text);
    const now = Date.now();

    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > ttlMs) {
        this.cache.delete(key);
        continue;
      }

      if (SimHash.hammingDistance(hash, entry.hash) <= this.simThreshold) {
        return entry.result;
      }
    }
    return null;
  }

  public set(text: string, result: PreflightScanResult): void {
    if (this.cache.size >= this.maxCapacity) {
      // Evict oldest
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }

    this.generateKey(text).then((hash) => {
      this.cache.set(text, {
        result,
        hash,
        timestamp: Date.now(),
      });
    });
  }
}

export const firewallSimHashCache = new FirewallSimHashCache();
```

**Changes**:

- Add SimHash class for near-duplicate detection
- Add `FirewallSimHashCache` for ~5-20% additional cache hits
- Use as fallback after exact-hash cache miss
- Never cache negative verdicts in SimHash

---

## Phase 4: Instrumentation (MEDIUM Priority)

### 4.1 Telemetry Events

**File**: `extensions/cli/src/telemetry/telemetryService.ts` (or new file)

```typescript
export interface FirewallCacheMetrics {
  totalScans: number;
  cacheHits: number;
  exactCacheHits: number;
  simHashHits: number;
  l1Blocks: number;
  l2Blocks: number;
  l3Escapes: number;
  avgL2Confidence: number;
  l2ConfidenceDistribution: { low: number; medium: number; high: number };
}

export interface PromptCacheMetrics {
  totalRequests: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  coldTokens: number;
  cacheHitRate: number; // percentage
  avgTokensSavedPerRequest: number;
}

export function recordFirewallMetrics(metrics: FirewallCacheMetrics): void {
  logger.info("[Firewall Metrics]", {
    hitRate: `${((metrics.cacheHits / metrics.totalScans) * 100).toFixed(1)}%`,
    exactHits: metrics.exactCacheHits,
    simHashHits: metrics.simHashHits,
    l1Blocks: metrics.l1Blocks,
    l2Blocks: metrics.l2Blocks,
    l3Escapes: metrics.l3Escapes,
  });
}

export function recordPromptCacheMetrics(metrics: PromptCacheMetrics): void {
  logger.info("[Prompt Cache Metrics]", {
    hitRate: `${metrics.cacheHitRate.toFixed(1)}%`,
    cachedReadTokens: metrics.cacheReadTokens,
    savedTokens: metrics.avgTokensSavedPerRequest,
  });
}
```

### 4.2 Integrate Metrics in Stream

**File**: `extensions/cli/src/stream/streamChatResponse.ts`

```typescript
// After stream completes (around line 477)
logger.debug("Stream complete", {
  chunkCount,
  responseLength: aiResponse.length,
  toolCallsCount: toolCallsMap.size,
  inputTokens,
  outputTokens,
  // NEW: Cache metrics from usage
  cacheReadTokens:
    fullUsage?.usage?.prompt_tokens_details?.cache_read_tokens ?? 0,
  cacheWriteTokens:
    fullUsage?.usage?.prompt_tokens_details?.cache_write_tokens ?? 0,
  cacheHitRate: fullUsage?.usage?.prompt_tokens_details?.cache_read_tokens
    ? (
        (fullUsage.usage.prompt_tokens_details.cache_read_tokens /
          inputTokens) *
        100
      ).toFixed(1) + "%"
    : "0%",
  cost,
  duration: totalDuration,
});

// NEW: Log to telemetry service
telemetryService.logPromptCacheMetrics({
  totalRequests: 1,
  cacheReadTokens:
    fullUsage?.usage?.prompt_tokens_details?.cache_read_tokens ?? 0,
  cacheWriteTokens:
    fullUsage?.usage?.prompt_tokens_details?.cache_write_tokens ?? 0,
  coldTokens:
    inputTokens -
    (fullUsage?.usage?.prompt_tokens_details?.cache_read_tokens ?? 0),
  cacheHitRate:
    inputTokens > 0
      ? ((fullUsage?.usage?.prompt_tokens_details?.cache_read_tokens ?? 0) /
          inputTokens) *
        100
      : 0,
  avgTokensSavedPerRequest:
    fullUsage?.usage?.prompt_tokens_details?.cache_read_tokens ?? 0,
});
```

---

## Phase 5: Hard Trigger Threshold (LOW Priority)

### 5.1 Add 75% Hard Trigger

**File**: `extensions/cli/src/compaction.ts`

```typescript
// Current values
export const AUTO_COMPACT_BUFFER_CAP = 15_000;
export const AUTO_COMPACT_BUFFER_RATIO = 0.6; // Soft trigger at 60%

// NEW: Hard trigger at 75%
export const AUTO_COMPACT_HARD_RATIO = 0.75;

export interface AutoCompactParams {
  chatHistory: ChatHistoryItem[];
  model: ModelConfig;
  systemMessage?: string;
  tools?: ChatCompletionTool[];
}

export function getCompactionLevel(
  params: AutoCompactParams,
): "none" | "soft" | "hard" {
  const { chatHistory, model, systemMessage, tools } = params;

  const inputTokens = countTotalInputTokens({
    chatHistory,
    systemMessage,
    tools,
    model,
  });
  const contextLimit = getModelContextLimit(model);
  const maxTokens = getModelMaxTokens(model);

  const softBuffer = Math.min(
    Math.ceil((1 - AUTO_COMPACT_BUFFER_RATIO) * (contextLimit - maxTokens)),
    AUTO_COMPACT_BUFFER_CAP,
  );
  const softThreshold = contextLimit - maxTokens - softBuffer;

  const hardBuffer = Math.ceil(
    (1 - AUTO_COMPACT_HARD_RATIO) * (contextLimit - maxTokens),
  );
  const hardThreshold = contextLimit - maxTokens - hardBuffer;

  if (inputTokens >= hardThreshold) return "hard";
  if (inputTokens >= softThreshold) return "soft";
  return "none";
}

// Update shouldAutoCompact to accept level
export function shouldAutoCompact(
  params: AutoCompactParams,
  level: "soft" | "hard" = "hard",
): boolean {
  const compactionLevel = getCompactionLevel(params);
  return level === "hard"
    ? compactionLevel !== "none"
    : compactionLevel === "soft";
}
```

---

## Implementation Order

| Phase | Task                        | Complexity | ETA     |
| ----- | --------------------------- | ---------- | ------- |
| 1.1   | Cache TTL                   | Low        | 30 min  |
| 1.2   | Explicit TTL in breakpoints | Low        | 15 min  |
| 1.3   | OpenAI session pinning      | Medium     | 1 hour  |
| 2.1   | State hash for delta scan   | Medium     | 1 hour  |
| 2.2   | Integrate delta scanning    | Medium     | 1 hour  |
| 3.1   | SimHash implementation      | Medium     | 2 hours |
| 3.2   | Integrate SimHash cache     | Medium     | 1 hour  |
| 4.1   | Telemetry events            | Low        | 1 hour  |
| 4.2   | Integration                 | Low        | 30 min  |
| 5.1   | Hard trigger                | Low        | 30 min  |

---

## Expected Outcomes After Implementation

| Metric                  | Before | After         |
| ----------------------- | ------ | ------------- |
| Firewall tokens/session | 100%   | ~15-40%       |
| Main LLM input tokens   | 100%   | ~10% (cached) |
| Compaction model cost   | 3-4×   | 1×            |
| Cache hit rate          | ~20%   | ~40-60%       |
| **Total cost/session**  | ~$1.70 | ~$0.20        |

---

## Testing Checklist

1. [ ] `npm run test` passes
2. [ ] `npm run lint` passes
3. [ ] CLI runs without firewall proxy connected (fail-open)
4. [ ] Cache eviction works correctly with TTL
5. [ ] SimHash returns similar results for paraphrased prompts
6. [ ] Hard trigger fires at 75% threshold
7. [ ] OpenAI requests include `prompt_cache_key`
8. [ ] Telemetry logs show cache hit rates

---

## Files to Modify

```
core/firewall/cache.ts                    # Phase 1.1, 3.1
core/llm/promptOptimizer.ts               # Phase 1.2
core/firewall/thinContext.ts              # Phase 2.1
core/llm/firewallScan.ts                  # Phase 2.2
extensions/cli/src/stream/streamChatResponse.ts    # Phase 1.3, 4.2
extensions/cli/src/compaction.ts          # Phase 5.1
extensions/cli/src/telemetry/             # Phase 4.1 (create if not exist)
```
