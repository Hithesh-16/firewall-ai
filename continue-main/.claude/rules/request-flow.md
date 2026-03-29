---
paths:
  - "proxy/**/*.ts"
---
# Request Flow — Token-Optimized Pipeline

## Current Flow (What EXISTS in `proxy/src/routes/ai.route.ts`)

```
POST /v1/chat/completions
  -> Zod validation
  -> Secret scan (secretScanner.ts — 12 patterns)
  -> PII scan (piiScanner.ts — 7 patterns)
  -> Entropy scan (entropyScanner.ts — Shannon entropy)
  -> Prompt injection scan (promptInjectionScanner.ts — 13 patterns)
  -> Context adjustment (contextScanner.ts — path-aware severity)
  -> Policy evaluation (policyEngine.ts — weighted risk score)
  -> Model policy check (modelPolicy.ts — per-model file restrictions)
  -> File scope validation (fileScope.ts — glob allowlist/blocklist)
  -> BLOCK (403) / REDACT (sanitize) / ALLOW (forward)
  -> Smart routing (risk >= 70 -> local, >= 30 -> cloud+redact, default -> cloud)
  -> Gateway routing (resolve provider, decrypt key, format payload)
  -> Credit check + consumption
  -> Provider adapter (OpenAI/Anthropic/Gemini/Ollama format conversion)
  -> X-AF-* response headers
  -> Audit log (SQLite, hashed original)
  -> Usage recording (tokens, cost)
```

## Target Flow (After Phase 1 — NEW steps marked with *)

```
POST /v1/chat/completions
  -> Zod validation
  -> *Token estimation (real tokenizer, not length/4)
  -> *Context reduction (grep + window + comment strip + budget trim)
  -> Secret scan
  -> PII scan
  -> Entropy scan
  -> Prompt injection scan
  -> Context adjustment
  -> Policy evaluation
  -> *Permission enforcement (not just check — middleware)
  -> BLOCK / REDACT / ALLOW
  -> *Cost-aware routing (risk + cost + credit remaining)
  -> *Prompt optimization (intent detection + efficient templates)
  -> Gateway routing
  -> *Rate limit enforcement (middleware reads rate_limits table)
  -> Credit check + consumption
  -> Provider adapter
  -> X-AF-* headers
  -> Audit log
  -> Usage recording
  -> *Benchmark log (original vs reduced tokens, % saved, cost saved)
```

## Response Headers (X-AF-*)

Set in `setScanHeaders()` in `ai.route.ts`:
- `X-AF-Action`: ALLOW | REDACT | BLOCK
- `X-AF-Risk-Score`: 0-100
- `X-AF-Secrets-Count`: N
- `X-AF-PII-Count`: N
- `X-AF-Entropy-Count`: N
- `X-AF-Redacted-Types`: comma-separated list
