# Cutting 90% of firewall tokens without breaking security

**Your preflight-scans-the-whole-history design is doing the right thing for the wrong reason — and doubling your bill to do it.** You can keep every real security property you care about while eliminating 80–95% of the firewall-side LLM tokens by doing three things: move the bulk of detection to a local BERT-class classifier (Prompt Guard 2 86M via ONNX), switch from "scan full history" to "scan system + last N turns + delta," and stop using Sonnet/GPT-4o for compaction. The evidence from every major commercial gateway — Cloudflare, Lakera, Protect AI, Azure, Bedrock, Meta's own LlamaFirewall — is that **nobody in production relies on a big LLM for the first line of defense**. They run a BERT-sized classifier, a regex layer, and escalate to an LLM only on ambiguity. Your double-LLM-call architecture is a greenfield mistake, not an industry norm. This report lays out why preflight scanning remains architecturally necessary (you cannot un-send bytes once OpenAI logs them), what competitors actually do, and a prioritized roadmap that should get your firewall cost-per-request down to the noise floor.

## Why preflight exists, and when you can skip it

The architectural question — "why not scan inline/in-transit?" — has a brutal answer: once a single byte reaches Anthropic or OpenAI's edge, **it is logged for trust-and-safety retention and you cannot recall it**. Forwarding a prompt-injection payload, a leaked API key, or PII-laden text means the breach has already occurred; the firewall verdict arrives too late to matter for compliance (GDPR, HIPAA, SOC 2) or data-exfiltration threat models. HTTP request bodies to provider APIs are a single JSON write, so there is no meaningful "streaming upload" to gate on bytes-in-flight. **Preflight is not a design choice, it is a consequence of the trust boundary.** Output-side scanning is different — you are reading a stream you own and can truncate before the user sees it, which is why NeMo Guardrails and Guardrails AI have real streaming validators for responses but not for requests.

Speculative forwarding — firing the firewall check and the upstream LLM call in parallel, canceling the LLM on a flag — saves latency but **not tokens and not security**. You are still billed for the LLM call (the provider accepts it into their queue), the provider still logs the payload, and cutting the TCP connection mid-stream does not purge their retention. It is acceptable only for pure output-moderation use cases where you genuinely do not care about what your prompts contain. For a code-completion CLI that may ingest `.env` files, API keys, proprietary source, or customer data, speculative forwarding is fail-open by default. Cloudflare's Firewall for AI is explicitly **not** speculative; it fans out detection modules in parallel with each other (PII, Llama Guard, injection classifier) and gates the origin forward on all of them resolving.

**Can you eliminate preflight entirely?** Only if you accept a specific set of failures. You will lose defense against data exfiltration to the provider (everything in the prompt is now in OpenAI's logs), unbounded-consumption DoS (massive prompts bill you before any response), and indirect prompt injection from tool outputs in agentic flows (the destructive action fires before the output scanner sees the response). What you **can** recover via output-scanning plus post-hoc logging is unsafe content delivery to the user, jailbreak-success detection, and forensics for offline signature updates. **The honest answer for your use case is: do not eliminate preflight, but make it cheap enough to stop caring about.**

For the narrow case of sub-100ms tab completion, skipping full preflight is defensible and is what Cursor and Copilot actually do — Cursor's Tab model is a small local Supermaven-lineage model running with KV-cache optimization, and Copilot's guardrails for inline completion are baked into the completion model's RLHF reward rather than run as a separate classifier. Both apply heavier scanning only to chat/agent mode where stakes are higher and latency budget is measured in seconds.

## What competitors actually ship

The commercial landscape has converged on a small set of architectural patterns that your implementation is visibly diverging from. **BERT-class classifiers dominate the fast first stage**: Meta's Prompt Guard 2 (86M mDeBERTa or 22M DeBERTa-xsmall), Azure Prompt Shields (binary classifiers), Pangea's first-tier, and Google Model Armor's injection classifier all run in the single-digit-millisecond range before any LLM gets involved. **Cascade detection is the default** for serious vendors — Meta's own reference implementation, LlamaFirewall, explicitly chains PromptGuard → AlignmentCheck (a larger reasoning LLM auditor) → CodeShield (Semgrep static analysis). Pangea documents "heuristics → ML classifiers → fine-tuned LLMs" as the cascade sequence. Rebuff's canonical four-layer diagram (heuristics → LLM judge → vector-DB similarity → canary-word leak detection) remains the clearest public reference, even though the repo is archived.

**Only Invariant Labs publicly documents delta/incremental scanning** — their rule engine pre-computes rule matches and caches across requests so only residual evaluation runs on the new turn. AWS Bedrock Guardrails best-practice docs actively _warn_ customers against re-scanning full chat history each turn. Kong's AI Gateway exposes this as an explicit toggle: `match_all_conversation_history: false` is the default, meaning it scans only the latest user message. **Your "send the full history to the firewall every turn" pattern is the opposite of the documented best practice across the industry.**

Pricing models also undermine the "LLM firewall" intuition. AWS Bedrock Guardrails charges **$0.15 per 1,000 text units** (1,000 characters each) — per-request and per-character, not per-LLM-token. Azure AI Content Safety is **$0.38 per 1,000 text records** of 1,000 chars. Google Model Armor is $0.10 per 1M tokens with 2M free. Lakera is a flat per-API-call subscription. **Nobody is charging you to run a big LLM as a firewall; the economics work because they aren't running big LLMs as firewalls.** The outliers who actually pay LLM-scale inference costs — NeMo Guardrails dialog rails (3+ LLM calls per turn, historically 1–2s latency) and Rebuff (OpenAI judge call per request) — are the ones with known performance problems and are either self-hosted or archived.

| Vendor                     | First-stage detection                                           | Scope per call                          | Streaming output             | Local model?               |
| -------------------------- | --------------------------------------------------------------- | --------------------------------------- | ---------------------------- | -------------------------- |
| Cloudflare Firewall for AI | WAF regex + Presidio NER + Llama Guard 3 8B in parallel         | Per-request prompt                      | Not documented               | Llama Guard on CF edge     |
| Lakera Guard               | Proprietary classifier ensemble trained on 80M+ Gandalf prompts | Full msg-array with smart chunking      | Incremental ≥10-token chunks | Docker self-host available |
| Protect AI LLM Guard (OSS) | Regex + DeBERTa classifiers (184M / 22M small)                  | Per-message string                      | No native stream             | Yes, ONNX on CPU           |
| AWS Bedrock Guardrails     | Per-policy classifiers + regex + Automated Reasoning            | Per-call I/O, buffered chunks on stream | Sync/async modes             | No                         |
| Azure Prompt Shields       | Binary classifier ensemble                                      | Per-call I/O, ≤10K chars                | Async parallel               | Yes (container + embedded) |
| Google Model Armor         | Injection classifier + RAI filters + DLP regex + URL scan       | Per-request sanitize calls              | Via generateContent only     | No                         |
| NeMo Guardrails            | Colang flows + NemoGuard-8B NIMs                                | Input/output/dialog rails               | Native sliding-window chunks | Yes (8B NIMs on-prem)      |
| Invariant Labs             | Rule DSL + ML detectors, **stateful/incremental**               | Delta on traces, cached rules           | Yes via proxy                | Yes                        |
| Kong AI Gateway            | PCRE regex + embedding similarity                               | `match_all_conversation_history` toggle | Response guard plugin        | None native                |
| LiteLLM Proxy              | Heuristics + in-memory similarity + LLM judge                   | JSONPath field selectors                | `during_call` parallel mode  | None native                |

The takeaways for your design: **BERT-sized ONNX classifiers for stage one, cascade to an LLM only on ambiguity, scan the delta (not the history), and treat the firewall as a side-channel rather than an inline LLM call.** That is the consensus.

## The optimization stack ranked by ROI

Ordered by estimated token savings divided by implementation complexity, the optimizations fall into a clear hierarchy. You should implement them top-down and stop measuring cost when it stops mattering.

**Tier 1 — ship this week.** Context thinning is the single highest-ROI change. Sliced to `system + last 5–8 turns`, you will see 60–85% token reduction on the scan side with no new dependencies. Crescendo and similar multi-turn jailbreaks cap at around 5 turns of accumulation in the published literature, so an N of 5–8 that always includes the system message and the most recent assistant turn captures the active attack surface. Add an exact-hash verdict cache next — SHA-256 of the normalized prompt keyed to the policy version, LRU-capped at 10k entries, takes microseconds and pays 5–50% back on top depending on traffic shape (coding assistants with repeated commands see the high end). Never cache negative verdicts across policy updates, or a stale block lingers forever.

**Tier 2 — ship this sprint.** Replace the LLM-based firewall pass with a local Prompt Guard 2 86M via ONNX Runtime in Node. Meta publishes the model under their community license on HuggingFace; `gravitee-io/Llama-Prompt-Guard-2-86M-onnx` ships a pre-converted ONNX build. The Node bindings are `onnxruntime-node` for native-speed CPU inference (5–20ms warmup-amortized) or `@huggingface/transformers` for pure-WASM portability. This **converts the firewall's LLM-token cost to zero** for roughly 95% of traffic — the classifier runs locally on the same Node process. Pair it with an always-on regex layer using Gitleaks patterns (spawn via `child_process` or use `@secretlint/secretlint` in-process) and the OWASP prompt-injection pattern set; regex runs in under a millisecond and fail-closes immediately on a secret match, which is what you want for `.env` leakage prevention.

**Tier 3 — for high-security paths.** A true three-tier cascade (regex → local classifier → Llama Guard 3 8B via Groq or Cloudflare Workers AI, gated on classifier confidence in the 0.3–0.7 band) reduces the LLM-tier invocation rate to roughly 2–10% of traffic in tuned production systems. Published numbers from the PromptGuard paper (Nature Sci. Reports 2025) show Layer-1 regex+MiniBERT alone filters 91% of direct injections with a 4-layer stack yielding F1=0.91 at under 8% latency overhead. PromptArmor's open-source implementation reports 91.7% F1 at 27ms fully offline. The LLM tier earns its keep specifically on Crescendo-style multi-turn attacks and novel jailbreak patterns the classifier hasn't seen.

| #   | Technique                                   | Est. token savings                           | Complexity  | Verdict                                                        |
| --- | ------------------------------------------- | -------------------------------------------- | ----------- | -------------------------------------------------------------- |
| 1   | Context thinning (system + last 5–8 turns)  | 60–85% scan-side                             | Low         | Ship first                                                     |
| 2   | Exact-hash LRU verdict cache                | 5–50% additive                               | Low         | Ship, policy-versioned                                         |
| 3   | Prompt Guard 2 86M ONNX local classifier    | Converts ~95% of LLM-firewall tokens to zero | Medium      | Ship — replaces the preflight LLM                              |
| 4   | Regex L1 (Gitleaks + OWASP patterns)        | Blocks before classifier cost on hit         | Low         | Ship, fail-closed on secrets                                   |
| 5   | Delta scan + session-state hash             | 80–95% additive on long sessions             | Medium      | Ship paired with #1 — never standalone                         |
| 6   | 3-tier cascade to Llama Guard via Groq      | LLM tier drops to 2–10% of traffic           | Medium–High | Ship for regulated paths                                       |
| 7   | SimHash near-duplicate benign-verdict cache | 5–20% additive on top of exact hash          | Medium      | Optional; never cache negatives                                |
| 8   | Summarize-before-scan                       | 50–80%                                       | Medium      | **Do not ship for security scanning** — destroys attack signal |
| 9   | Speculative forward (parallel firewall+LLM) | 0 tokens saved                               | High        | Avoid — fails open on provider logging                         |

## The prompt-caching playbook

Prompt caching is the single largest lever you have on the **main** LLM call, and your current design is probably leaving most of it on the table. Concrete math on a realistic 50K-token context with a 10-turn agentic loop: Claude Sonnet 4.5 costs $1.71 without caching and **$0.44 with optimal caching** (74% savings). GPT-5.1 with the new 90% cached-read discount drops from $0.73 to $0.18 (75% savings). GPT-4o on the older 50% discount tier saves only 46% — if your main model is still GPT-4o, **switch to GPT-5.1 with `prompt_cache_retention: "24h"` as your first cost optimization before touching anything else**.

The structural rules are the same across providers. Put static content first and variable content last: `tools → system → persona/context → few-shot examples → conversation history → current user turn`. No timestamps, session IDs, UUIDs, or PII in the static prefix — move them to the last user message or to metadata headers. Keep `tool_choice`, `temperature`, and thinking budget constant within a session. Use deterministic JSON serialization for tool arguments (Go and Swift randomize object keys, which will silently destroy your cache). On OpenAI, set `prompt_cache_key = sessionId` to pin related requests to the same inference machine — OpenAI's own cookbook documents a case going from 60% to 87% hit rate with just that change. Set `safety_identifier = sha256(userId)` separately for abuse detection; it does not affect cache routing.

Anthropic is the most flexible and the most footgun-prone. You get four explicit `cache_control` breakpoints per request and a 20-block lookback window per breakpoint. The canonical agentic-loop pattern:

```ts
const resp = await client.messages.create({
  model: "claude-sonnet-4-5",
  tools: [
    ...toolDefs,
    // breakpoint #1: tools (1h TTL, nearly static)
    { ...lastTool, cache_control: { type: "ephemeral", ttl: "1h" } },
  ],
  system: [
    { type: "text", text: LONG_STATIC_SYSTEM_PROMPT },
    // breakpoint #2: system (1h TTL)
    {
      type: "text",
      text: PROJECT_CONTEXT,
      cache_control: { type: "ephemeral", ttl: "1h" },
    },
  ],
  messages: [
    ...olderTurns,
    // breakpoint #3: end of PREVIOUS turn (5m TTL)
    {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "y",
          content: prevTurnResult,
          cache_control: { type: "ephemeral" },
        },
      ],
    },
    // breakpoint #4: end of CURRENT turn (5m TTL)
    {
      role: "user",
      content: [
        {
          type: "text",
          text: currentUserMessage,
          cache_control: { type: "ephemeral" },
        },
      ],
    },
  ],
  metadata: { user_id: hashedUserId }, // trust & safety only
});
```

On the next turn, shift breakpoint #3 forward to what was the current turn and put #4 on the new turn. Because each breakpoint's lookback window is only 20 blocks, this rolling pattern is what keeps multi-step agentic loops hitting cache even at turn 50+. **Important: Anthropic silently reduced the default TTL from 1 hour to 5 minutes on March 6, 2026** — you must set `"ttl": "1h"` explicitly on the tools and system breakpoints (costs 2× base write vs 1.25× for 5-minute) or your hit rate will collapse across natural user pauses.

**The firewall-doubles-the-call problem does not benefit from caching** because the firewall prompt and the main prompt are different strings with different prefixes; they share no cacheable content. The correct move is to stop treating the firewall as a cacheable LLM call and instead add a local content-hash cache around your firewall invocation. If the same sanitized message hashes to a verdict you computed 5 minutes ago, skip the firewall entirely — free wins on edit-run-edit coding loops.

Critically, **compaction invalidates cache**. Any modification above the last breakpoint kills every cached prefix from that point forward. Anthropic's explicit mitigation pattern (documented in their compaction guide) is to place a `cache_control` breakpoint at the end of the system prompt so it stays valid across compaction events, and another on the compaction summary block itself so the summary becomes the new cacheable prefix. After compaction, you eat one cache-write turn and then amortize. Never compact opportunistically mid-conversation — only at task boundaries or when forced by the context window.

## Fix your compaction model first

Your current setup uses the same expensive main model (GPT-4o / Sonnet) for compaction summaries. **This is the single most wasteful line item in your architecture.** Anthropic themselves previously routed Claude Code's compaction calls to Haiku (Sonnet is 3–4× more expensive per token; Opus 19× Haiku). aider hardcodes a weak model for history summarization — default gpt-4o-mini or Haiku — and makes this architecturally central via `--weak-model`. Summarization is a low-reasoning task with severe task/model mismatch; using the flagship model is burning money to produce the same output.

The correct compaction stack mirrors Claude Code's three-layer design. **Layer one is microcompaction** — for any tool output over ~2KB, replace the inline content with a reference stub (`<tool_result path="/tmp/x/123" tokens=4200 summary="lint found 3 errors in foo.ts" />`) and keep only the last 3–5 tool results verbatim. This alone saves 40–60% on typical agentic coding sessions with zero LLM calls needed. Tool outputs dominate the token budget in coding agents, and they are the cheapest thing to discard because the content is still on disk. **Layer two is structured-checklist summarization** when context crosses threshold, run Haiku 4.5 or gpt-4o-mini with a fixed-template prompt covering user intent, technical decisions, files touched and why, errors and fixes, pending tasks, and next step. Free-form "summarize this conversation" produces worse summaries and costs the same. **Layer three is rehydration** — after summarization, re-read the top-5 recently-touched files fresh (they are on disk, cheap to tokenize) and append a continuation instruction so the agent doesn't ask "what were we doing?"

Compact earlier than your current 80% threshold. Community reports on Claude Code document a failure mode where auto-compact waits until ~95% and then cannot fit the compaction request itself. Use a **soft trigger at 60%** for opportunistic compaction at task boundaries (quality of the summary is highest when the context being summarized is still clean), a **hard trigger at 75–80%** as a forced floor, and reserve 15–20% compaction headroom plus 10% output headroom on top. The 80% figure from your current code matches Claude Code's documented headroom model reasonably, but you are compacting with the wrong model.

If you want another lever, **LLMLingua-2** is the one compression technique from the research literature that actually ports to Node/TS cleanly. It reformulates compression as BERT-sized token classification (keep/drop) trained by distilling GPT-4's extractive labels, runs via `@xenova/transformers` with no Python dependency, and yields 2–5× compression task-agnostically. It is plausibly useful as a squeeze stage on the compaction summary itself before it is written back to context. ICAE and AutoCompressors (soft-prompt methods) are research dead-ends for hosted-model users since you cannot inject embeddings into GPT or Claude over an API. Skip them unless you self-host.

## The security-cost tradeoff matrix

Decisions you can make to cut cost, ordered by how much security you lose:

Safe to cut entirely — **summarize-before-scan** (destroys attack signal anyway), **speculative forwarding to save latency** (saves nothing on cost, and fails open on provider-side logging), **full-history scanning every turn** (no major vendor does this and Bedrock docs actively warn against it). Replace with delta scanning plus session-state hashing.

Safe to reduce — **LLM-based firewall** can safely drop to ~2–10% of traffic via a cascade; 90%+ of requests resolve cleanly on a regex + local classifier pass. **Context window sent to firewall** can drop from full history to system + last 5–8 turns with no measurable loss on published jailbreak benchmarks because Crescendo-class attacks live in the recent window by construction. **Compaction model** can drop from flagship to Haiku/gpt-4o-mini with no observable quality loss on a low-reasoning task.

Must keep — **preflight gating before forward** (the trust boundary is non-negotiable if you care about provider-side data retention), **regex secret scanning as fail-closed** (cost is sub-millisecond, consequences of leakage are catastrophic), **output-side streaming validator** for high-severity content going to the user, **prompt caching on the main LLM** (free 60–90% cost reduction is not optional at scale).

Cost-dependent — **Llama Guard 3 tier in the cascade** (keep if you are a regulated use case or process third-party content; drop if your threat model is solo developer with known-benign prompts), **Presidio PII sidecar** (mandatory for GDPR/HIPAA, skip otherwise — Prompt Guard 2 plus regex covers the common cases for developer tooling).

## The recommended request flow

Pulling all of this together, the architecture for your `firewallPreflightScan` function should collapse from "send chat history to a firewall LLM" to a local cascade that only occasionally makes any network call at all:

```
incoming request
  ├─ [L0]  hash lookup in LRU verdict cache          (µs)
  │         hit → return cached verdict, done
  ├─ [L1]  regex scan: Gitleaks patterns, OWASP
  │         injection patterns, length/entropy caps  (<2 ms)
  │         secret match → fail-closed 403
  ├─ [L2]  Prompt Guard 2 86M ONNX via
  │         onnxruntime-node                          (5–20 ms CPU)
  │         confidence >0.7 → block
  │         confidence <0.3 → allow, cache verdict
  │         confidence 0.3–0.7 → escalate
  ├─ [L2b] (parallel) Presidio via Docker sidecar
  │         if processing regulated data              (10–30 ms)
  ├─ [L3]  Llama Guard 3 8B via Groq                 (50–150 ms, ~5% traffic)
  │         with system + last 5–8 turns only
  └─ forward to main LLM with:
        - 4 cache_control breakpoints (Anthropic)
          or prompt_cache_key=sessionId + 24h retention (OpenAI)
        - static prefix untouched across turns
        - tool results microcompacted beyond last 3–5
        - compaction worker on cheap model at 60% threshold

on response:
  ├─ streaming output rail (NeMo-style chunked validator)
  │    with chunk_size=128, context_size=50
  │    truncate + replace on violation
  └─ stream to user
```

Concrete file-level changes to your `src/stream/streamChatResponse.ts`. Rename `firewallPreflightScan` to `firewallCascade` and make it return `{verdict, reasonCode, cachedHit}`. Add `src/firewall/classifiers/promptGuard2.ts` wrapping the ONNX session (lazy-load the 86M model once at process start, reuse across calls). Add `src/firewall/patterns/secretRegex.ts` with Gitleaks rule set — vendor the patterns, do not spawn the binary. Add `src/firewall/cache.ts` with an LRU keyed by `sha256(normalizedPrompt + policyVersion)`. Add `src/firewall/thinContext.ts` that returns `[systemMessage, ...messages.slice(-N)]` where N is config-driven, default 6. Add `src/compaction/compactWithCheapModel.ts` that invokes Haiku 4.5 or gpt-4o-mini with a structured-checklist prompt, triggered at 60% of context-window soft, 75% hard. Modify your while(true) agentic loop to place cache breakpoints on the last two turns and refresh the "previous turn" breakpoint on each iteration.

Instrument everything. Log `cache_read_input_tokens` / `cached_tokens` / `cached_content_token_count` on every response, track firewall-cache hit rate separately, measure the L2 confidence distribution to tune your escalation thresholds, and add a CI replay test that makes the same request twice and asserts a cache hit on the second — cache regressions are invisible without this and a single malformed timestamp can silently cost you 5× for weeks.

## Expected outcomes

Stacked, these changes move a typical 50K-context, 10-turn agentic session from roughly $1.70 per session (GPT-4o, no caching, full-history firewall LLM) to roughly **$0.20 per session** — about 88% reduction. The firewall tier converts from a flagship-LLM call per turn to a local ONNX inference for roughly 95% of traffic, with the LLM judge firing only on ambiguous classifier scores. The main LLM tier goes from paying full input price on every turn to paying 10% (Anthropic/GPT-5.1 cached-read tier) on the 90%+ stable prefix. Compaction costs drop 3–4× by switching the summarizer model. Crescendo and jailbreak detection quality actually improves compared to your current LLM-firewall pass, because a classifier specifically trained on 80M+ adversarial prompts outperforms a general-purpose model asked to double as a safety judge.

The insight that should reframe your thinking: **your current architecture is expensive because you treat the firewall as an LLM problem. The industry has moved on.** Firewalls are classifier-and-regex problems with occasional LLM escalation, and the money you were spending on the firewall LLM is better spent on prompt caching for the main model where it actually buys you 90% off the input token bill. Your 80% auto-compaction is the right instinct — you just need to pair it with a cheap compaction model and cache-breakpoint discipline so that compaction doesn't also invalidate your main-model cache. The double-billing problem is not the preflight pattern, it is the choice of what runs during preflight. Fix that choice and the architectural concern disappears.
