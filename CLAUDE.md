# AI Firewall (continue-main)

## What This Is

Open-source AI code agent (built on Continue) with a built-in security proxy. Every LLM request and MCP tool call passes through a local Fastify proxy that scans for secrets, PII, and prompt injection before forwarding to any provider. Ships as a VS Code extension, CLI agent, JetBrains plugin, and standalone web dashboard.

## Architecture

```
continue-main/
├── proxy/                    — Security proxy (Fastify, port 8080)
│   ├── src/scanner/          — Re-exports from @ai-firewall/scanner (backward-compatible)
│   ├── src/policy/           — Policy engine (BLOCK/REDACT/ALLOW decisions)
│   ├── src/gateway/          — Multi-provider adapters + token intelligence
│   │   ├── adapters/         — OpenAI, Anthropic, Gemini, Ollama format adapters
│   │   ├── tokenCounter.ts   — Real token counting (js-tiktoken, WASM BPE)
│   │   ├── contextWindow.ts  — Advisory context window checks (never truncates)
│   │   └── costEstimator.ts  — Pre-request cost estimation
│   ├── src/schemas/          — Centralized Zod schemas (chatSchemas.ts)
│   ├── src/mcp/              — MCP Security Gateway
│   │   ├── mcpScanPipeline.ts — Scan MCP tool I/O through scanner pipeline
│   │   └── mcpAuditLogger.ts  — Log/query MCP audit trail
│   ├── src/routes/           — 25+ API endpoints
│   ├── src/router/           — Risk-based + cost-aware smart routing
│   ├── src/auth/             — Auth, SSO, RBAC middleware
│   ├── src/vault/            — AES-256-GCM encrypted token vault
│   ├── src/db/               — SQLite (better-sqlite3, WAL mode)
│   └── src/redactor/         — Sensitive data redaction
├── packages/
│   ├── scanner/              — @ai-firewall/scanner (pure-function scanners, shared)
│   │   └── src/              — secretScanner, piiScanner, entropyScanner,
│   │                           promptInjectionScanner, contextScanner, patterns, types
│   ├── config-types/         — TypeScript types
│   ├── fetch/                — HTTP client with proxy support
│   ├── llm-info/             — LLM metadata & pricing
│   ├── openai-adapters/      — OpenAI format converters
│   ├── terminal-security/    — Terminal sandboxing
│   ├── config-yaml/          — YAML configuration parsing
│   ├── continue-sdk/         — Continue SDK wrapper
│   └── hub/                  — Hub/registry functionality
├── core/                     — Agent engine (60+ LLM providers, 26 tools, 40+ context providers)
│   ├── llm/llms/             — Provider implementations
│   ├── llm/countTokens.ts    — Token counting (tiktoken + llama tokenizer)
│   ├── tools/                — Built-in agent tools (read_file, edit_file, grep_search, etc.)
│   ├── context/              — Context providers (@file, @diff, @git, @web, @docs, MCP, etc.)
│   ├── context/mcp/          — MCP client (stdio, ws, sse, http transports, OAuth)
│   ├── indexing/             — LanceDB vector + full-text codebase search
│   ├── autocomplete/         — Tab completion engine
│   └── commands/             — Slash commands (/commit, /review, /cmd)
├── gui/                      — React + Vite + Tailwind webview UI
│   └── src/pages/            — Chat, Security, Organization, Config, History, Usage
├── extensions/
│   ├── vscode/               — VS Code extension (spawns proxy, hosts webview)
│   ├── intellij/             — JetBrains plugin (Kotlin/Gradle)
│   └── cli/                  — Terminal agent (Ink TUI)
└── docs/                     — Documentation
```

## Build & Run

```bash
# Install all workspace packages (links @ai-firewall/scanner)
npm install

# Build shared packages first (required — scanner package must build before proxy)
cd packages/scanner && npm run build
npm run build -w packages

# Start proxy (port 8080)
cd proxy && npm run build && npm start

# Start GUI dev server (port 3000)
cd gui && npm run dev

# Build VS Code extension (then F5 to debug)
cd extensions/vscode && npm run build

# Build CLI agent
cd extensions/cli && npm run build
```

## Design Principles

1. **Proxy is a gateway, not a controller** — it informs via headers, never modifies user prompts/context silently
2. **Loosely coupled** — every feature is independently toggleable via `policy.json`
3. **Never truncate or limit tokens automatically** — return `X-AF-Context-Overflow` warning headers, let the CLIENT prompt the user to decide
4. **Scan, don't manage** — proxy scans content, it doesn't store/manage files or tool I/O
5. **SOLID everywhere** — SRP per module, OCP via patterns/config, ISP via `@ai-firewall/scanner`, DIP via interfaces

## Key Patterns

- **Zod** for input validation — centralized in `proxy/src/schemas/chatSchemas.ts` with strict role enum (`system|user|assistant|tool`) + multimodal content support
- **SQLite** via better-sqlite3 — WAL mode, parameterized queries, 15+ tables
- **Provider adapters** normalize OpenAI <-> Anthropic <-> Gemini <-> Ollama formats
- **Scanner pipeline** order: secret -> PII -> entropy -> context adjustment -> prompt injection -> policy decision
- **Token Intelligence** — real token counting via `js-tiktoken` in `proxy/src/gateway/tokenCounter.ts`, advisory context window checks (never truncates), cost-aware routing (opt-in via `policy.json`)
- **File Scanning** — `proxy/src/scanner/fileScanService.ts` runs full pipeline on files, `fileScanCache.ts` provides content-addressed caching (SHA-256 hash key)
- **MCP Security Gateway** — `proxy/src/mcp/mcpScanPipeline.ts` scans all MCP tool inputs/outputs, `mcpAuditLogger.ts` logs audit trail. No competitor scans MCP tool calls.
- **Shared Scanner Package** — `@ai-firewall/scanner` (`packages/scanner/`) contains all pure-function scanners. Proxy re-exports for backward compatibility. MCP servers and future services import directly.
- **X-AF-*** response headers carry scan metadata + token intelligence from proxy to extension
- **AES-256-GCM** encryption for all stored API keys in token vault
- **Redux Toolkit** for GUI state management
- **esbuild** for VS Code extension bundling
- **LanceDB** for vector indexing of codebase
- **MCP Client** (in `core/context/mcp/MCPConnection.ts`) — production-grade, 4 transports (stdio, ws, sse, http), OAuth, tool registry

## Testing

```bash
cd proxy && npm test        # 75 tests (policy, scanners, token, file scan, MCP, control plane, enterprise)
cd core && npm test         # Core agent engine tests
cd gui && npm test          # GUI component tests
```

Test breakdown (62 proxy tests):
- **14** — Original (policy engine, prompt injection, STRICT_LOCAL, model policy, BlindMI)
- **20** — Phase 1: Token Intelligence (tokenCounter, contextWindow, costEstimator)
- **9** — Phase 2: File Scanning (fileScanService, fileScanCache)
- **9** — Phase 3: MCP Gateway (mcpScanPipeline, mcpAuditLogger)
- **10** — Phase 4: Control Plane (approvals, sessions, notifications, WebSocket)
- **13** — Phase 5: Enterprise (cache, license, webhook queue)

## Request Flow (Token-Optimized)

```
Extension/CLI -> localhost:8080/v1/chat/completions
  1. Token Estimation (js-tiktoken, fallback to length/4)
  2. Scanner Pipeline (secrets, PII, entropy, prompt injection)
  3. Policy Engine (BLOCK/REDACT/ALLOW)
  4. Context Window Check (ADVISORY — sets X-AF-Context-Overflow, never truncates)
  5. Cost Estimation (real tokens x model pricing)
  6. Cost-Aware Routing (opt-in, disabled by default — falls through to risk-based)
  7. Redactor (if REDACT)
  8. Gateway Router (resolve provider + model)
  9. Provider Adapter (format conversion)
  10. AI Provider (OpenAI/Anthropic/Gemini/Ollama)
  11. Audit Logger (SQLite)
  12. Response with X-AF-* headers
```

## File Scan Flow

```
POST /api/scan/file or /api/scan/batch
  -> File scope check (blocklist/allowlist via picomatch, max size)
  -> Read file + compute SHA-256 hash
  -> Check cache (content-addressed: path + hash)
  -> If cache hit: return cached result (cached: true)
  -> If miss: run full scanner pipeline (secret -> PII -> entropy -> context -> injection -> policy)
  -> Cache result for future lookups
  -> Return { action, riskScore, secretsFound, piiFound, reasons }
```

## MCP Security Gateway Flow

```
Agent requests MCP tool call
  -> POST /v1/mcp/tools/call (gateway route)
  -> Serialize tool arguments to text
  -> Scan INPUTS (secret/PII/entropy/injection pipeline via @ai-firewall/scanner)
  -> If BLOCK -> 403 + X-AF-MCP-Action: BLOCK + audit log
  -> If REDACT -> sanitize args, return sanitizedArguments
  -> If ALLOW -> return original args
  -> Log to mcp_audit table (server, tool, direction, action, risk, timings)
  -> Return with X-AF-MCP-* headers
```

## Approval Flow (Human-in-the-Loop)

```
Agent triggers high-risk action (risk >= approval threshold in policy.json)
  -> Check remembered rules (approval_rules table)
  -> If "allow_always" rule exists: proceed without prompt
  -> If "deny_always" rule exists: block
  -> If no rule: create approval_request (status: pending)
  -> Push "approval_needed" event via WebSocket to all user's devices
  -> Fan out to notification channels (webhook, Slack, email, Web Push)
  -> Wait for response (configurable timeout, default 60s)
  -> If user responds: Allow/Deny/AllowAlways/DenyAlways
  -> If timeout: default-deny (OWASP: never auto-approve)
  -> Push "approval_resolved" event to all devices
```

## Response Headers

### LLM Chat Headers (on every `/v1/chat/completions` response)

| Header | Value | When |
|--------|-------|------|
| `X-AF-Action` | ALLOW/BLOCK/REDACT | Always |
| `X-AF-Risk-Score` | 0-100 | Always |
| `X-AF-Secrets-Count` | number | Always |
| `X-AF-PII-Count` | number | Always |
| `X-AF-Entropy-Count` | number | Always |
| `X-AF-Redacted-Types` | comma-separated | When redacted |
| `X-AF-Input-Tokens` | number | Always (real tiktoken count) |
| `X-AF-Estimated-Cost` | number | Always (pre-request estimate) |
| `X-AF-Token-Method` | tiktoken/heuristic | Always |
| `X-AF-Context-Overflow` | true | Only when over model context limit |
| `X-AF-Context-Tokens` | number | Only when overflow |
| `X-AF-Context-Max` | number | Only when overflow |
| `X-AF-Context-Warning` | string | Only when overflow (advisory) |

### MCP Gateway Headers (on every `/v1/mcp/tools/call` response)

| Header | Value | When |
|--------|-------|------|
| `X-AF-MCP-Action` | ALLOW/BLOCK/REDACT | Always |
| `X-AF-MCP-Risk-Score` | 0-100 | Always |
| `X-AF-MCP-Server` | server ID | Always |
| `X-AF-MCP-Tool` | tool name | Always |

## API Endpoints

### Core Proxy

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v1/chat/completions` | OpenAI-compatible proxy with scanning + token intelligence |
| GET | `/health` | Health check |

### Token Intelligence (Phase 1)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/estimate` | Pre-flight: real token count, cost estimate, context window utilization, scan preview |

### File Scanning (Phase 2)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/scan/file` | Scan a single file (with content-addressed cache) |
| POST | `/api/scan/batch` | Scan multiple files (max 50, returns per-file results + summary) |
| DELETE | `/api/scan/cache` | Clear scan cache (optional `filePath` query filter) |
| GET | `/api/scan/cache/stats` | Cache statistics (total entries, total size) |

### MCP Security Gateway (Phase 3)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v1/mcp/tools/call` | Scan tool inputs, forward to MCP server, scan outputs |
| POST | `/v1/mcp/scan` | Standalone text scan for MCP context |
| GET | `/v1/mcp/audit` | Query MCP audit log (filter by server, action, limit) |
| GET | `/v1/mcp/audit/stats` | Aggregate MCP tool call stats |

### Control Plane — Approvals (Phase 4)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/approvals/pending` | List pending approvals for user |
| POST | `/api/approvals/:id/resolve` | Respond to approval (allow_once/allow_always/deny/deny_always) |
| GET | `/api/approvals/history` | Past approval decisions for audit |
| GET | `/api/approvals/rules` | Remembered "Allow Always" / "Deny Always" rules |
| DELETE | `/api/approvals/rules/:id` | Revoke a remembered rule |

### Control Plane — Sessions (Phase 4)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/sessions/active` | Active sessions across all devices |
| GET | `/api/sessions/:id` | Get specific session details |

### Control Plane — Notifications (Phase 4)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/notifications/channels` | List configured notification channels |
| POST | `/api/notifications/channels` | Configure a new channel (webhook, slack, email, webpush) |
| DELETE | `/api/notifications/channels/:id` | Remove a channel |
| POST | `/api/notifications/test` | Send test notification to all channels |

### Auth, Policy, Gateway, Org (existing)

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/register`, `/api/auth/login` | User auth |
| GET/PUT | `/api/policy` | Policy CRUD |
| POST/GET | `/api/providers` | AI provider management (BYOK) |
| POST/GET | `/api/credits` | Credit limits |
| GET | `/api/usage/summary`, `/api/usage/recent` | Usage analytics |
| GET | `/api/logs` | Paginated audit logs |
| GET | `/api/stats` | Aggregated statistics |
| POST | `/api/browser-scan` | Browser extension scan |
| POST | `/api/permission-check` | Interactive permission prompt |
| POST | `/api/simulate` | AI leak simulator |
| GET/POST | `/api/export/json`, `/api/export/csv` | Data export |

## Database Tables

| Table | Phase | Purpose |
|-------|-------|---------|
| `logs` | 1 | Request audit trail (sanitized text, risk scores, actions) |
| `organizations` | 3 | Multi-org support |
| `users` | 3 | Auth + RBAC (4 roles: admin, security_lead, developer, auditor) |
| `api_tokens` | 3 | Bearer token auth (SHA-256 hashed, never raw) |
| `providers` | 4 | BYOK AI providers (API keys AES-256-GCM encrypted) |
| `models` | 4 | Model registry per provider (pricing, context window) |
| `credits` | 4 | Credit limits (requests/tokens/dollars, auto-reset) |
| `usage_logs` | 4 | Per-request token + cost tracking |
| `admin_audit` | — | Admin action audit trail |
| `audit_queue` | — | Privacy review queue (BlindMI) |
| `sso_sessions` | 7 | SSO provider sessions (encrypted tokens) |
| `webhooks` | 7 | Webhook registrations per org |
| `org_model_rules` | 7 | Model allowlist/denylist per org |
| `rate_limits` | 7 | Per-user/org rate limits (schema only — enforcement in Phase 5) |
| `file_scan_cache` | P2 | Content-addressed file scan cache (UNIQUE on path+hash) |
| `mcp_audit` | P3 | MCP tool call audit log (server, tool, direction, action, risk) |
| `approval_requests` | P4 | Human-in-the-loop approval workflow (pending/approved/denied/expired) |
| `approval_rules` | P4 | Remembered decisions ("Allow Always" / "Deny Always" per resource pattern) |
| `notification_channels` | P4 | Pluggable notification configs (webpush, slack, email, webhook) |
| `webpush_subscriptions` | P4 | Web Push API subscription endpoints |
| `active_sessions` | P4 | Cross-device session tracking (device, model, last activity) |
| `webhook_deliveries` | P5 | Stripe-pattern delivery queue (status, attempts, retry, dead letter) |

## Shared Packages

### @ai-firewall/scanner (`packages/scanner/`)

Pure-function security scanners extracted for reuse across proxy, MCP servers, CLI tools, and tests.

**Exports:**
- `scanSecrets(text)` — 12 secret patterns (AWS, private key, JWT, DB URL, GitHub token, etc.)
- `scanPII(text)` — 7 PII patterns (email, phone, SSN, Aadhaar, PAN, credit card, IP)
- `scanEntropy(text)` — Shannon entropy analysis with context keyword detection
- `scanPromptInjection(text, threshold?)` — 13 injection/jailbreak pattern categories
- `adjustSeverity(value, type, severity, filePaths?)` — Path-aware severity adjustment
- Types: `Severity`, `SecretMatch`, `PiiMatch`, `SecretScanResult`, `PiiScanResult`, `PromptInjectionResult`, `ScanPipelineResult`

**Usage:**
```typescript
import { scanSecrets, scanPII, scanPromptInjection } from "@ai-firewall/scanner";

const secrets = scanSecrets("AKIAIOSFODNN7EXAMPLE");
const pii = scanPII("admin@example.com");
const injection = scanPromptInjection("Ignore all previous instructions");
```

All proxy scanner files (`proxy/src/scanner/*.ts`) re-export from this package for backward compatibility.

## Module Responsibilities (SOLID)

| Module | SRP (does ONE thing) | Location |
|--------|---------------------|----------|
| `tokenCounter.ts` | Counts tokens via tiktoken with heuristic fallback | `proxy/src/gateway/` |
| `contextWindow.ts` | Checks if messages fit context window (advisory only) | `proxy/src/gateway/` |
| `costEstimator.ts` | Estimates request cost from tokens + model pricing | `proxy/src/gateway/` |
| `chatSchemas.ts` | Validates chat input via Zod (strict roles, multimodal) | `proxy/src/schemas/` |
| `fileScanService.ts` | Orchestrates scanner pipeline for files | `proxy/src/scanner/` |
| `fileScanCache.ts` | Cache read/write/invalidate for file scans | `proxy/src/scanner/` |
| `mcpScanPipeline.ts` | Scans MCP tool I/O text through scanner pipeline | `proxy/src/mcp/` |
| `mcpAuditLogger.ts` | Writes/reads MCP audit log entries | `proxy/src/mcp/` |
| `mcpGateway.route.ts` | HTTP route handling for MCP gateway (delegates to pipeline + logger) | `proxy/src/routes/` |
| `smartRouter.ts` | Risk-based + cost-aware model routing | `proxy/src/router/` |
| `wsManager.ts` | WebSocket connection lifecycle + message delivery (heartbeat, ping/pong) | `proxy/src/ws/` |
| `approvalService.ts` | Approval workflow (create, wait, resolve, timeout, remembered rules) | `proxy/src/services/` |
| `sessionTracker.ts` | Active session lifecycle (start, end, touch, query, cleanup stale) | `proxy/src/services/` |
| `notificationService.ts` | Pluggable notification dispatch (fan out to channels via interface) | `proxy/src/notifications/` |
| `webhook.ts` (channel) | Webhook notification channel (POST to any URL with JSON payload) | `proxy/src/notifications/channels/` |
| `cacheAdapter.ts` | Cache interface + factory (ISP: get/set/del/incr only) | `proxy/src/cache/` |
| `memoryAdapter.ts` | In-memory cache with TTL (default, zero deps) | `proxy/src/cache/` |
| `valkeyAdapter.ts` | Valkey/Redis cache via ioredis (optional) | `proxy/src/cache/` |
| `licenseVerifier.ts` | Ed25519 offline license key verification | `proxy/src/license/` |
| `featureGuard.ts` | Fastify preHandler for license feature gating | `proxy/src/license/` |
| `webhookQueue.ts` | Stripe-pattern delivery queue (6 retries, HMAC, idempotency) | `proxy/src/services/` |

## Conventions

- No raw secrets stored in DB — only SHA-256 hashes
- Never skip the proxy for LLM requests — it's the security boundary
- Provider-specific logic belongs in `proxy/src/gateway/adapters/`, not in `core/`
- New scanner patterns go in `packages/scanner/src/patterns.ts` (OCP: no scanner code changes needed)
- New proxy scanner types go in `packages/scanner/src/types.ts`
- New context providers go in `core/context/providers/`
- New tools go in `core/tools/implementations/`
- New GUI pages go in `gui/src/pages/`
- Config types are defined in `packages/config-types/`
- Zod schemas for routes centralized in `proxy/src/schemas/` — don't inline schemas in route files
- Token counting uses `proxy/src/gateway/tokenCounter.ts` — never use `Math.ceil(text.length / 4)` in new code
- Cost routing is opt-in via `policy.json` `cost_routing` section — disabled by default
- File scan results are cached by content hash — invalidate on policy change
- MCP tool calls routed through `/v1/mcp/tools/call` for scanning — fallback to direct if proxy unavailable

## Don't

- Store raw secrets or PII in SQLite — only hashes
- Add `any` types without justification — use `unknown` and narrow
- Use `console.log` in production code — use the structured logger
- Mutate objects — use spread operators for immutable updates
- Skip error handling — wrap async operations in try/catch
- Hardcode provider URLs — use the adapter system
- Add dependencies without checking for existing alternatives in the monorepo
- Auto-truncate or modify user prompts/context — proxy INFORMS via headers, client DECIDES
- Silently limit tokens or block oversized contexts — return `X-AF-Context-Overflow` and let the user choose
- Use `Math.ceil(text.length / 4)` for token counting — use `countMessageTokens()` from `tokenCounter.ts`
- Inline Zod schemas in route files — import from `proxy/src/schemas/`
- Build custom MCP servers for filesystem/GitHub/Slack — use ecosystem packages, wrap through gateway
- Duplicate scanner code — import from `@ai-firewall/scanner`, proxy files only re-export
