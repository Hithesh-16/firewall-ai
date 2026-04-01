xxx# AI Firewall / Secure AI OS — Master Implementation Plan

## Context

AI Firewall is evolving from a security-first AI code agent (built on Continue.dev) into a full **Secure AI OS** — a multi-device AI runtime with built-in firewall, token intelligence, MCP tool ecosystem, and controlled automation. The moat is: **security + token efficiency** — no competitor scans before sending, optimizes tokens before spending, or controls AI across devices.

This plan is grounded in a complete audit of what EXISTS vs what NEEDS TO BE BUILT.

---

## CURRENT STATE AUDIT (Verified Against Codebase)

### ALREADY BUILT (Leverage, don't rebuild)

| Feature | Location | Depth |
|---------|----------|-------|
| Proxy (Fastify, 20 routes, 6 scanners) | `proxy/src/` | Production |
| Policy engine (BLOCK/REDACT/ALLOW) | `proxy/src/policy/policyEngine.ts` | Production |
| AES-256-GCM vault | `proxy/src/vault/` | Production |
| Auth + SSO (Google/GitHub/MS/OIDC) | `proxy/src/auth/ssoService.ts` | Production |
| SQLite DB (19 tables) | `proxy/src/db/database.ts` | Production |
| Core agent (60+ LLM providers) | `core/llm/llms/` | Production |
| 26 agent tools | `core/tools/implementations/` | Production |
| 40+ context providers | `core/context/providers/` | Production |
| **MCP CLIENT** (stdio/ws/sse/http) | `core/context/mcp/MCPConnection.ts` | Production |
| Token counting (tiktoken + llama) | `core/llm/countTokens.ts` | Production |
| Message pruning + context compilation | `core/llm/countTokens.ts` | Production |
| LanceDB vector indexing | `core/indexing/` | Production |
| Cost/usage tracking + credit limits | `proxy/src/gateway/usageService.ts`, `creditService.ts` | Production |
| Risk-based smart routing | `proxy/src/router/smartRouter.ts` | Production |
| Plan tool, Memory tool, Worktree tool | `core/tools/implementations/` | Production |
| GUI (React+Redux, 8 pages, 44+ components) | `gui/src/` | Production |
| VS Code extension (v1.3.33) | `extensions/vscode/` | Production |
| CLI agent (Ink TUI) | `extensions/cli/` | Beta |
| JetBrains plugin (Kotlin/Gradle) | `extensions/intellij/` | Alpha |
| Permission check endpoint | `proxy/src/routes/permission.route.ts` | Partial |
| Webhook registration + fire-and-forget delivery | `proxy/src/routes/webhook.route.ts` | Partial |
| Rate limits table | `proxy/src/db/database.ts` (schema only) | Schema only |
| File scope validation | `proxy/src/scope/fileScope.ts` | Security only |

### NOT BUILT (Must create)

| Feature | Status | Priority |
|---------|--------|----------|
| Token Intelligence Engine (real tokenizer in proxy) | Proxy uses naive `length/4` | HIGH |
| Context Reduction Pipeline (grep + AST + window) | No reducer code exists | HIGH |
| Cost-aware model routing | smartRouter.ts is risk-only | HIGH |
| Custom MCP Servers (Gmail, WhatsApp, etc.) | MCP client exists, NO servers | MEDIUM |
| File Service (upload/index/summarize) | No `/files/*` routes | MEDIUM |
| Secure File Reader (per-line scanning) | Standard `readFile` only | MEDIUM |
| Prompt Optimizer (intent + templates) | Not implemented | MEDIUM |
| Benchmark system (token savings metrics) | No tracking | MEDIUM |
| Rate limit enforcement middleware | Table exists, no enforcement | MEDIUM |
| Permission enforcement middleware | Check endpoint only | MEDIUM |
| Hook execution framework | No `HookRunner` | LOW |
| Docker/K8s deployment | No containerization | LOW (Phase 5) |
| PostgreSQL migration | SQLite only | LOW (Phase 5) |
| Redis caching | Not in dependencies | LOW (Phase 5) |
| Mobile app (React Native) | Not started | LOW (Phase 4) |
| Smartwatch integration | Not started | LOW (Phase 5) |

---

## MARKET ANALYSIS

### Competitive Landscape

| Feature | AI Firewall | Cursor | GitHub Copilot | Windsurf | Tabnine | Cody |
|---------|------------|--------|----------------|----------|---------|------|
| Pre-send security scanning | YES | No | No | No | No | No |
| Token optimization (before send) | PLANNED | No | No | No | No | No |
| Local-first / offline mode | YES (Ollama) | No | No | No | Yes | Partial |
| Multi-provider (60+) | YES | 3-4 | 1 | 3-4 | 3-4 | 3-4 |
| PII/Secret redaction | YES | No | No | No | No | No |
| Open source core | YES | No | No | No | No | Yes |
| MCP tool ecosystem | YES (client) | No | No | No | No | No |
| Cost tracking + credit limits | YES | No | No | No | No | No |
| Multi-device control | PLANNED | No | No | No | No | No |
| Policy engine (BLOCK/REDACT) | YES | No | No | No | No | No |
| Enterprise RBAC + audit | YES | Partial | Yes | No | Yes | Yes |
| Risk-based routing | YES | No | No | No | No | No |

### Our Advantages (Moat)

1. **Firewall-first architecture** — Every byte scanned BEFORE it reaches any LLM. No competitor does this
2. **Token optimization** — Reduce context BEFORE spending tokens. Cursor/Copilot send full files
3. **Provider agnostic** — 60+ providers vs locked ecosystems. Switch providers without code changes
4. **Local-first privacy** — Can run entirely offline with Ollama. Enterprise compliance without cloud dependency
5. **Open source + extensible** — MCP client already built, policy-as-code, custom scanners
6. **Cost transparency** — Real-time token/cost tracking with credit limits. No surprise bills

### Areas of Improvement

1. **Token estimation in proxy is naive** — `length/4` is inaccurate; need real tokenizer integration
2. **No context reduction pipeline** — Sending full files wastes tokens/money
3. **No cost-aware routing** — Only risk-based; doesn't pick cheaper models when appropriate
4. **No MCP servers** — Client is production-grade but no custom tool servers (Gmail, Slack, etc.)
5. **Rate limiting exists in schema but not enforced** — Security gap
6. **Permission check doesn't enforce** — Only reports what permissions are needed
7. **No Docker/deployment** — Can't easily deploy to enterprise environments
8. **JetBrains plugin early stage** — Missing feature parity with VS Code
9. **No benchmark proof** — Can't quantify token savings to users
10. **Webhook delivery unreliable** — Fire-and-forget with no retry

---

## PHASED IMPLEMENTATION PLAN

### Design Principles (ALL phases)

1. **Proxy is a gateway, not a controller** — it informs, never modifies user prompts/context silently
2. **Loosely coupled** — every new feature is independently toggleable via `policy.json`
3. **Never truncate or limit tokens automatically** — if context exceeds limits, return warning headers so the CLIENT can prompt the user to decide
4. **Scan, don't manage** — proxy scans content, it doesn't store/manage files or tool I/O

---

### PHASE 1: Token Intelligence Engine

**Context:** Token estimation uses `Math.ceil(text.length / 4)` everywhere — ~30-50% inaccurate. Cost estimates are wrong, context window limits are unchecked, routing can't factor in cost. Zod schemas are loose.

#### Step 1: Real Tokenizer Service
- **New** `proxy/src/gateway/tokenCounter.ts`
  - Install `js-tiktoken` (WASM, ~2ms/call)
  - Singleton encoders: `cl100k_base` (GPT-4/3.5, Claude, Gemini) and `o200k_base` (GPT-4o, o-series)
  - `resolveEncoding(modelName)` — maps model to correct BPE vocabulary
  - `countTokens(text, modelName)` — count tokens in plain string
  - `countMessageTokens(messages, modelName)` — count across messages with ~4 token per-message overhead
  - `estimateTokensFallback(text)` — retains `length/4` as defensive fallback
  - All calls wrapped in try/catch, falls back to heuristic on error
- **Modify** `proxy/package.json` — add `"js-tiktoken": "^1.0.15"`
- **Replace heuristic in:**
  - `proxy/src/routes/estimate.route.ts` line 35-37
  - `proxy/src/gateway/adapters/openaiAdapter.ts` lines 24-29
  - `proxy/src/gateway/adapters/anthropicAdapter.ts` lines 24-27
  - `proxy/src/gateway/adapters/geminiAdapter.ts` lines 23-26
  - `proxy/src/gateway/adapters/ollamaAdapter.ts` lines 27-30

#### Step 2: Context Window WARNINGS (not enforcement)
**Key principle: NEVER auto-truncate. Warn the user, let them decide.**

- **New** `proxy/src/gateway/contextWindow.ts`
  - `checkContextWindow(messages, modelName, maxContextTokens)` — returns analysis, NOT modified messages
  - Returns: `{ fits, totalTokens, maxContextTokens, overageTokens, overagePercent, warningMessage? }`
  - When `maxContextTokens` is 0 (unknown model), returns `{ fits: true }` — no warning
- **Integrate** into `proxy/src/routes/ai.route.ts`
  - After scanning, before provider call
  - Resolve `maxContextTokens` from gateway model, fallback to `packages/llm-info` via `findLlmInfo(modelName)?.contextLength`
  - If `!fits`, set response headers:
    - `X-AF-Context-Overflow: true`
    - `X-AF-Context-Tokens: <totalTokens>`
    - `X-AF-Context-Max: <maxContextTokens>`
    - `X-AF-Context-Warning: "Prompt uses 45000 tokens, model limit is 8192. Consider reducing context."`
  - **DO NOT block or truncate** — forward as-is, let provider handle overflow
  - Client (extension/CLI) reads headers and shows warning dialog to user
- **Add** `"@ai-firewall/llm-info": "workspace:*"` in `proxy/package.json`

#### Step 3: Cost-Aware Routing (opt-in, disabled by default)
- **New** `proxy/src/gateway/costEstimator.ts`
  - `estimateCost(messages, model)` — pre-compute using real token count + model pricing
  - Returns: `{ inputTokens, estimatedOutputTokens, inputCost, outputCost, totalEstimatedCost }`
- **Modify** `proxy/src/router/smartRouter.ts`
  - Add `resolveRouteWithCost(riskScore, estimatedCost, requestedModel, policy)` alongside existing `resolveRoute()`
  - Add `evaluateCostCondition()` to parse `"estimated_cost > 0.10"` and compound conditions
  - If cost routing disabled or no rules match, falls through to existing `resolveRoute()`
- **Modify** `proxy/src/types/index.ts` — add `CostRoutingRule`, `CostRoutingConfig` types; extend `SmartRoutingConfig`
- **Modify** `proxy/policy.json` — add `cost_routing` inside `smart_routing` (disabled by default):
  ```json
  "cost_routing": { "enabled": false, "maxCostPerRequest": null, "preferCheaper": false, "rules": [] }
  ```
- **Modify** `proxy/src/routes/ai.route.ts` — add `X-AF-Estimated-Cost` and `X-AF-Input-Tokens` headers

#### Step 4: Schema Hardening
- **New** `proxy/src/schemas/chatSchemas.ts`
  - `messageRoleSchema` — `z.enum(["system", "user", "assistant", "tool"])` instead of `z.string()`
  - `messageContentSchema` — `z.union([z.string(), z.array(contentPartSchema)])` for vision/multimodal
  - `chatCompletionSchema` — strict model name, validated messages, optional stream/temperature/max_tokens
  - `metadataSchema` — with max length constraints
- **Modify** `proxy/src/routes/ai.route.ts` lines 35-49 — replace inline `chatSchema` with import; update `mergeMessages()` for union content
- **Modify** `proxy/src/routes/estimate.route.ts` lines 19-33 — replace inline schema
- **Modify** `proxy/src/types/index.ts` lines 138-141 — update `ChatCompletionMessage` role + content types

#### Step 5: Enhance Estimate Endpoint
- **Modify** `proxy/src/routes/estimate.route.ts`
  - Replace `estimateTokens(rawText)` with `countMessageTokens(messages, model)`
  - Add to response: `estimatedOutputTokens`, `maxContextTokens`, `contextUtilization` (percentage)
  - Add `tokenMethod: "tiktoken" | "heuristic"` to response

#### Step 6: Tests
- **New** `proxy/src/test/tokenCounter.test.ts` — encoder selection, known token counts, fallback
- **New** `proxy/src/test/contextWindow.test.ts` — fits/overflow/unknown models (NO truncation tests — we never truncate)
- **New** `proxy/src/test/costEstimator.test.ts` — cost accuracy, zero-cost local models
- **Modify** `proxy/src/test/run-tests.ts` — register new tests

#### Phase 1 Response Headers
| Header | Value | When |
|--------|-------|------|
| `X-AF-Input-Tokens` | number | Always (real count) |
| `X-AF-Estimated-Cost` | number | Always |
| `X-AF-Token-Method` | tiktoken/heuristic | Always |
| `X-AF-Context-Overflow` | true | Only when over model limit |
| `X-AF-Context-Tokens` | number | Only when overflow |
| `X-AF-Context-Max` | number | Only when overflow |
| `X-AF-Context-Warning` | string | Only when overflow |

#### Phase 1 Implementation Order
1. `proxy/src/gateway/tokenCounter.ts` + `proxy/src/schemas/chatSchemas.ts` (new files, no runtime impact)
2. `proxy/package.json` — add `js-tiktoken`, `@ai-firewall/llm-info`, run `npm install`
3. `proxy/src/routes/estimate.route.ts` — swap in real tokenizer (safe first target)
4. Adapter files (4x) — replace heuristic in `estimateTokens()`
5. `proxy/src/types/index.ts` — add cost routing types, update `ChatCompletionMessage`
6. `proxy/src/gateway/contextWindow.ts` — warning-only context window check
7. `proxy/src/gateway/costEstimator.ts` + `proxy/src/router/smartRouter.ts` — cost-aware routing
8. `proxy/src/routes/ai.route.ts` — integrate schema, context warnings, cost headers
9. `proxy/policy.json` — add `cost_routing` config (disabled by default)
10. Tests — all 3 new test files + register in runner

**New files (7):** `tokenCounter.ts`, `contextWindow.ts`, `costEstimator.ts`, `chatSchemas.ts`, 3 test files
**Modified files (10):** `ai.route.ts`, `estimate.route.ts`, 4 adapters, `smartRouter.ts`, `types/index.ts`, `policy.json`, `package.json`, `test/run-tests.ts`

---

### PHASE 2: File-Aware Proxy (Scan + Cache)

**Context:** The proxy scans text in LLM messages and browser content, but has no way to scan files independently. Clients (CLI, extension, dashboard) need a way to scan files before they enter the LLM pipeline. This adds file scanning as a service — proxy reads, scans, and returns results with hash-based cache. **No file storage, no upload management.**

#### Step 1: File Scan Service
- **New** `proxy/src/scanner/fileScanService.ts`
  - `scanFileContent(filePath, policy): FileScanResult`
  - Validate path against `fileScope.ts` (reuse `validateFilePaths()`)
  - Read file via `fs.readFile` (streaming for large files > 1MB)
  - Run full scanner pipeline: `scanSecrets()` -> `scanPII()` -> `scanEntropy()` -> `adjustSeverity()` -> `scanPromptInjection()` -> `evaluatePolicy()`
  - Returns: `{ action, riskScore, reasons, secrets[], pii[], redactedContent?, filePath, fileHash, fileSize, scanDurationMs }`
  - Respects `max_file_size_kb` from policy — returns error if exceeds (doesn't silently truncate)
- **Reuses ALL existing scanners** — no new scanner code

#### Step 2: Scan Cache Table
- **Modify** `proxy/src/db/database.ts` — add `file_scan_cache` table:
  - `UNIQUE(file_path, file_hash)` — content-addressed: different hash = cache miss = re-scan
  - Columns: `file_path`, `file_hash`, `file_size`, `action`, `risk_score`, `secrets_found`, `pii_found`, `entropy_found`, `scan_result` (JSON), `scanned_at`
- **New** `proxy/src/scanner/fileScanCache.ts`
  - `getCachedScan(filePath, fileHash)` — lookup by path + hash
  - `cacheScanResult(filePath, fileHash, fileSize, result)` — store
  - `invalidateCache(filePath?)` — clear one or all entries

#### Step 3: File Scan Routes
- **New** `proxy/src/routes/fileScan.route.ts`
  - `POST /api/scan/file` — Scan single file. Input: `{ filePath, includeRedacted? }`. Checks cache first. Response includes `cached: boolean`
  - `POST /api/scan/batch` — Scan multiple files. Input: `{ filePaths[], includeRedacted? }`. Max 50 per batch. Returns array + summary: `{ totalFiles, scanned, cached, blocked, redacted, allowed }`
  - `DELETE /api/scan/cache` — Clear scan cache (optional `filePath` query param)

#### Step 4: Register Routes
- **Modify** `proxy/src/server.ts` — register `registerFileScanRoutes(app)`

#### Step 5: CLI Scan Command
- **Modify** `extensions/cli/` — add `cn scan <path>` subcommand
  - Calls `POST /api/scan/file` or `/api/scan/batch`
  - Color-coded terminal output (red BLOCK, yellow REDACT, green ALLOW)
  - `cn scan --batch <dir>` scans directory (respecting `.gitignore`)

#### Step 6: Types
- **Modify** `proxy/src/types/index.ts` — add `FileScanResult`, `BatchScanResult` types

#### Step 7: Tests
- **New** `proxy/src/test/fileScan.test.ts`
  - Scan file with secrets -> BLOCK
  - Scan clean file -> ALLOW
  - Cache hit returns same result without re-scanning
  - Batch processes multiple files
  - File exceeding `max_file_size_kb` returns error
  - Blocked path returns error
- **Modify** `proxy/src/test/run-tests.ts` — register tests

**New files (4):** `fileScanService.ts`, `fileScanCache.ts`, `fileScan.route.ts`, `fileScan.test.ts`
**Modified files (5):** `database.ts`, `server.ts`, `types/index.ts`, `test/run-tests.ts`, `extensions/cli/`
**New endpoints (3):** `POST /api/scan/file`, `POST /api/scan/batch`, `DELETE /api/scan/cache`
**New tables (1):** `file_scan_cache`

---

### PHASE 3: MCP Security Gateway + Agent System

**Context:** AI Firewall has a production-grade MCP client (`@modelcontextprotocol/sdk` v1.25.2, 4 transports, OAuth, connection pooling) and 26+ built-in tools. The goal: scan ALL MCP tool inputs/outputs for secrets, PII, and injection — something no competitor does.

**Key insight:** Don't rebuild ecosystem MCP servers (filesystem, GitHub, Slack, Gmail all exist). Instead, build a **security gateway** that wraps ANY MCP server with scanning, plus security-unique servers that are our moat.

**Competitive position:** Claude Code has better raw agent quality. We win on security (scanning, audit, redaction), multi-provider (not locked to Anthropic), and multi-client (VS Code + CLI + JetBrains + mobile).

#### Architecture: MCP Security Gateway
```
Agent (VS Code / CLI / JetBrains)
  |
  v
core/tools/callTool.ts  (existing MCP dispatch, lines 84-183)
  |
  v
proxy POST /v1/mcp/tools/call   <-- NEW gateway route
  |
  +-- Scanner Pipeline on INPUTS (secrets, PII, entropy, injection)
  +-- Tool Policy Engine (per-tool ALLOW/BLOCK/REDACT)
  +-- Audit Logger
  |
  v
MCPManagerSingleton (existing connection pool)
  |
  v
MCP Server (built-in OR any community server)
  |
  v
Scanner Pipeline on OUTPUTS (redact secrets/PII in responses)
  +-- X-AF-MCP-* response headers
  +-- Audit log entry
  |
  v
Return scanned result to agent
```

#### What to BUILD vs REUSE

**BUILD (unique to AI Firewall — our moat):**
| Component | Purpose |
|-----------|---------|
| MCP Gateway Route | Scan all tool I/O through proxy |
| `@ai-firewall/scanner` shared package | Scanners extracted for reuse (verified: all pure functions) |
| `@ai-firewall/mcp-vault` server | Secure secret retrieval (LLM never sees raw keys) |
| `@ai-firewall/mcp-scanner` server | Expose scanner as a tool (any agent can scan text) |
| `@ai-firewall/mcp-audit` server | Query audit logs as tools (compliance from chat) |
| `@ai-firewall/mcp-codebase` server | LanceDB vector search as MCP tool |
| Sub-agent built-in tool | Parallel agent spawning (like Claude Code's Task) |
| `tool_search` built-in tool | Lazy tool loading, 10x context savings |

**REUSE (ecosystem — don't reinvent):**
| Server | Package | Firewall adds |
|--------|---------|---------------|
| Filesystem | `@modelcontextprotocol/server-filesystem` | Scan file contents on read |
| GitHub | `@modelcontextprotocol/server-github` | Scan PR bodies/commits |
| Slack | `@modelcontextprotocol/server-slack` | Scan outbound messages |
| Gmail | `@shinzolabs/gmail-mcp` | Scan outbound emails |
| PostgreSQL | `@modelcontextprotocol/server-postgres` | Scan query results |
| Git | `@modelcontextprotocol/server-git` | Scan diffs before push |

#### Step 1: Extract Scanners to Shared Package
All scanners are verified pure functions (zero proxy deps).
- **New** `packages/scanner/` — workspace package `@ai-firewall/scanner`
  - Move: `secretScanner.ts`, `piiScanner.ts`, `entropyScanner.ts`, `promptInjectionScanner.ts`, `contextScanner.ts`, `patterns.ts`
  - Extract scanner types from `proxy/src/types/index.ts` into `packages/scanner/src/types.ts`
- **Modify** `proxy/src/scanner/*.ts` — re-export from `@ai-firewall/scanner`
- **Modify** root `package.json` — add `packages/scanner` to workspaces
- **Verification:** `cd proxy && npm test` passes unchanged

#### Step 2: MCP Gateway Route in Proxy
- **New** `proxy/src/routes/mcpGateway.route.ts` (follows `ai.route.ts` pattern)
  - `POST /v1/mcp/tools/call` — `{ server_id, tool_name, arguments }` -> scan inputs -> call tool -> scan outputs -> return with `X-AF-MCP-*` headers
  - `POST /v1/mcp/tools/list` — list servers + tools with risk levels
  - `GET /v1/mcp/servers` — server statuses
  - `POST /v1/mcp/scan` — standalone text scan for MCP context
- **Pipeline:** Zod validate -> serialize args -> scanSecrets -> scanPII -> scanEntropy -> scanPromptInjection -> evaluatePolicy -> BLOCK/REDACT/ALLOW -> forward to MCPManagerSingleton -> scan response -> audit log -> return
- **Modify** `proxy/src/db/database.ts` — add `mcp_audit` table
- **Modify** `proxy/src/server.ts` — register routes

#### Step 3: Route Core MCP Calls Through Gateway
- **Modify** `core/tools/callTool.ts` (lines 84-183, `case "mcp":` handler)
  - Instead of direct `MCPManagerSingleton.getConnection(mcpId).callTool()`, route through `proxy POST /v1/mcp/tools/call`
  - **Fallback:** If proxy unreachable, fall back to direct MCP call (preserves existing behavior)

#### Step 4: Tool Search / Lazy Loading
- **Modify** `core/context/mcp/MCPManagerSingleton.ts`
  - Store lightweight tool index (name + description, ~50 tokens each) instead of full schemas (~500 tokens each)
  - Add `searchTools(query): ToolSummary[]` method
  - Add `getToolSchema(serverId, toolName): Tool` for on-demand loading
- **New** `core/tools/definitions/toolSearch.ts` + `core/tools/implementations/toolSearch.ts` — `tool_search` built-in
- **Modify** `core/tools/builtIn.ts` — add `ToolSearch` to `BuiltInToolNames`

#### Step 5: Security MCP Servers

**5A: Base Class** — `packages/mcp-servers/src/base/FirewalledMCPServer.ts`
- Wraps `@modelcontextprotocol/sdk` Server with auto-scanning of all tool I/O via `@ai-firewall/scanner`
- Per-tool risk level and policy configuration

**5B: Vault Server** — `packages/mcp-servers/src/servers/vault/`
- Tools: `get_secret`, `list_secrets`, `rotate_secret`
- Reuses `proxy/src/vault/tokenVault.ts` (AES-256-GCM)

**5C: Scanner Server** — `packages/mcp-servers/src/servers/scanner/`
- Tools: `scan_text`, `scan_file`, `get_risk_score`
- Reuses `@ai-firewall/scanner`

**5D: Audit Server** — `packages/mcp-servers/src/servers/audit/`
- Tools: `query_logs`, `get_risk_timeline`, `export_compliance_report`
- Reuses `proxy/src/db/database.ts`

**5E: Sub-Agent Built-in Tool** (in `core/tools/`, NOT MCP — tighter integration)
- `spawn_agent` — create new agent session with fresh context (like Claude Code's Task)
- `query_agent` — send follow-up to background agent
- `list_agents` / `terminate_agent` — management
- All sub-agent tool calls route through firewall via proxy

**5F: Codebase Server** — `packages/mcp-servers/src/servers/codebase/`
- Tools: `semantic_search`, `symbol_lookup`, `dependency_graph`
- Reuses `core/indexing/` (LanceDB vector + full-text search)

**Entry point:** `packages/mcp-servers/src/cli.ts` — run any server via `node cli.js --server vault`

#### Step 6: MCP Config Schema Extension
- **Modify** `packages/config-yaml/src/schemas/mcp/index.ts` — add optional `firewall: boolean` and `toolPolicies` fields to `baseMcpServerSchema`
- Backward-compatible: existing configs without `firewall` field work unchanged

#### Step 7: Dashboard Integration
- **New** `gui/src/pages/McpServers.tsx` — server list, tool risk levels, MCP audit log, per-tool policy UI
- **Modify** `gui/src/App.tsx` — add route

#### Implementation Priority
1. **MVP (Steps 1-4):** Scanner extraction + Gateway + Core routing + Tool Search. ~18 new files, ~10 modified. Low risk (additive, with fallback)
2. **Security Servers (Step 5):** Vault + Scanner + Audit + Codebase servers + Sub-agent tool. ~25 new files
3. **Config + Dashboard (Steps 6-7):** Per-tool policy config + MCP management UI

#### What We're NOT Doing (Deliberate)
- NOT building filesystem/GitHub/Slack/Gmail servers — use ecosystem, wrap through gateway
- NOT building WhatsApp/mobile MCP — deferred until mobile clients exist (Phase 4+)
- NOT replacing built-in tools with MCP — built-in stays for zero-latency local ops
- NOT extracting policyEngine to shared package — stays in proxy, MCP servers call proxy endpoint

#### Verification
- Scanner package: existing proxy tests pass after extraction
- Gateway integration: tool call with secret in args -> verify BLOCK
- Gateway output scan: tool returning PII -> verify REDACT
- E2E: VS Code -> agent MCP tool -> proxy scans -> audit log created
- Performance: gateway scanning adds <50ms per tool call
- Fallback: proxy down -> direct MCP call still works

---

### PHASE 4: AI Agent Control Plane (Approval + Notifications + PWA)

**Context:** The approval workflow is the genuine market gap. GitHub's Agent Control Plane (GA Feb 2026) is web-only. Microsoft Agent 365 ($15/user, GA May 2026) is dashboard-only. Astrix has Agent Policies but no mobile push. Claude Remote has phone notifications but is Anthropic-only. Nobody does provider-agnostic, scan-integrated, mobile-push agent approval for developer security tools.

**Market reality (verified via web research, March 2026):**
- AI firewall market: $30M, 100% YoY growth ([CSA](https://cloudsecurityalliance.org/blog/2026/03/20/2026-securing-the-agentic-control-plane), [Check Point](https://www.helpnetsecurity.com/2026/03/24/check-point-ai-defense-plane/))
- 86% of orgs send agents to production WITHOUT full security approval ([AGAT](https://agatsoftware.com/blog/ai-agent-security-enterprise-2026/))
- Zero AI coding assistants (Cursor, Windsurf, Tabnine, Cody) have mobile apps — they're all IDE-only ([comparison](https://guptadeepak.com/top-5-ai-coding-assistants-of-2026-cursor-copilot-windsurf-claude-code-and-tabnine-compared/))
- Claude Remote proves the model: 62% of approvals handled via notification without opening app ([Claude Remote](https://www.clauderc.com/blog/2026-02-28-push-notifications-for-ai-coding-workflows/))
- PWA dev costs 3-5x lower than native; iOS 16.4+ supports PWA push ([comparison](https://progressier.com/pwa-vs-native-app-comparison-table))

**What we're building:** "Approve or deny AI agent actions from your phone's lock screen — the first provider-agnostic mobile control plane for AI coding security."

**What we're NOT building:** A mobile chat app. That's ChatGPT/Claude's product. They have billions in investment. We cannot compete and shouldn't try.

#### Step 1: WebSocket Infrastructure in Proxy
- **New** `proxy/src/ws/wsManager.ts` — Fastify WebSocket manager using `@fastify/websocket`
  - `registerClient(userId, deviceId, ws)` — track connected devices
  - `broadcast(userId, event)` — push event to all user's devices
  - `sendToDevice(userId, deviceId, event)` — targeted push
  - Heartbeat/reconnect with 30s ping interval
  - Event types: `approval_needed`, `scan_blocked`, `credit_exceeded`, `session_started`, `session_ended`
- **Modify** `proxy/package.json` — add `@fastify/websocket`
- **Modify** `proxy/src/server.ts` — register WebSocket upgrade at `/ws`

#### Step 2: Approval System (the killer feature)
- **New** `proxy/src/services/approvalService.ts`
  - `requestApproval(userId, action, context): Promise<ApprovalDecision>` — creates request, pushes to all devices via WebSocket, waits with configurable timeout (default 60s)
  - `resolveApproval(requestId, decision)` — device responds Allow/Deny/AllowAlways
  - If no device responds: **default-deny** (configurable in policy.json)
  - Decisions: `allow_once`, `allow_always` (remembered for resource pattern), `deny`, `deny_always`
  - **Never let the agent's chat interface grant permission** — approval must come from a separate channel (OWASP agentic guideline)
- **New** `proxy/src/routes/approval.route.ts`
  - `GET /api/approvals/pending` — list pending approvals for user
  - `POST /api/approvals/:id/resolve` — respond (Allow/Deny)
  - `GET /api/approvals/history` — past decisions for audit
  - `GET /api/approvals/rules` — remembered "Allow Always" rules
  - `DELETE /api/approvals/rules/:id` — revoke a remembered rule
- **Modify** `proxy/src/db/database.ts` — add tables:
  - `approval_requests` — id, user_id, action_type, resource, context_json, status (pending/approved/denied/expired), resolved_by_device, resolved_at, created_at
  - `approval_rules` — id, user_id, resource_pattern, decision, created_at
- **Integrate** into `proxy/src/routes/ai.route.ts` — when policy returns `REQUIRE_APPROVAL`, call `requestApproval()` instead of just setting a header
- **Integrate** into `proxy/src/routes/mcpGateway.route.ts` — high-risk MCP tools trigger approval
- **Add** `REQUIRE_APPROVAL` as 4th policy action alongside BLOCK/REDACT/ALLOW in `proxy/src/policy/policyEngine.ts`

#### Step 3: Notification Integrations (reach developers where they are)
Instead of forcing a new app install, integrate with what developers already have on their phones:

- **New** `proxy/src/notifications/notificationService.ts` — pluggable notification backend:
  - `sendNotification(userId, event, channels[])` — fan out to configured channels
  - Channel interface: `{ send(userId, event): Promise<boolean> }`
- **New** `proxy/src/notifications/channels/webpush.ts` — Web Push API (for PWA)
  - Uses `web-push` npm package (VAPID keys)
  - Service worker receives push, shows actionable notification
- **New** `proxy/src/notifications/channels/slack.ts` — Slack webhook/bot
  - Posts interactive message: "AI Firewall: Agent wants to read `/auth/secrets.ts`. [Allow] [Deny]"
  - Slack button callbacks resolve the approval
- **New** `proxy/src/notifications/channels/email.ts` — Email digest (low-priority alerts)
  - Configurable: immediate for blocks, daily digest for scan summaries
- **New** `proxy/src/notifications/channels/webhook.ts` — Generic webhook for Teams/Discord/custom
- **New** `proxy/src/routes/notification.route.ts`
  - `GET /api/notifications/channels` — list configured channels
  - `POST /api/notifications/channels` — configure a channel (Slack URL, email, etc.)
  - `POST /api/notifications/test` — send test notification
  - `POST /api/notifications/webpush/subscribe` — register Web Push subscription
- **Modify** `proxy/package.json` — add `web-push`, `@slack/web-api` (optional peer deps)

#### Step 4: Progressive Web App (NOT React Native)
**Why PWA over native:** 3-5x lower dev cost, no app store approval, instant updates, one codebase. For an approval-focused app with 3 screens, native is overkill. iOS 16.4+ supports PWA push (must be saved to home screen).

- **New** `apps/control-plane/` — Vite + React + Tailwind PWA
  - **3 screens only:**
    - `ApprovalsPage` — real-time approval cards via WebSocket. Tap Allow/Deny. Swipe to dismiss resolved. Badge count for pending.
    - `SessionsPage` — active agent sessions across all devices (VS Code, CLI, JetBrains). Tap to see tool calls and scan results in real-time.
    - `AlertsPage` — recent blocks, high-risk detections, credit warnings. Filterable by severity.
  - **NO chat. NO file uploads. NO camera. NO logs page. NO dashboard.** Those exist in the VS Code GUI already.
  - **Service worker:** Receives Web Push notifications, shows actionable approve/deny buttons directly on lock screen
  - **Offline:** Queue approve/deny decisions locally, sync when reconnected
  - **Auth:** Same API token (`afw_...`) as CLI/extension
  - **Install:** Add to home screen prompt (PWA manifest)
- **Tech:** Vite, React 18, Tailwind, Workbox (service worker), Web Push API
- **Build:** `cd apps/control-plane && npm run build` → static files, deployable anywhere

#### Step 5: Cross-Device Session Awareness
- **New** `proxy/src/services/sessionTracker.ts`
  - Tracks active sessions per user (which device, what model, tool calls in progress)
  - WebSocket events: `session_started`, `session_ended`, `tool_called`, `scan_result`
  - Lightweight: only tracks metadata, not message content
- **New** `proxy/src/routes/sessions.route.ts`
  - `GET /api/sessions/active` — list active sessions across devices
  - `GET /api/sessions/:id/events` — recent events for a session

#### Step 6: Multimodal Input Scanning (in IDE, NOT mobile)
The right place for file/image/video input is the IDE extensions, not a mobile app:

- **Modify** `proxy/src/scanner/` — add image metadata scanner:
  - Extract EXIF data from images (GPS coordinates, device info, timestamps)
  - Scan for PII in image metadata before sending to vision models
  - Strip EXIF if policy says REDACT
- **Modify** `proxy/src/routes/ai.route.ts` — handle `content: [{ type: "image_url", ... }]` in messages
  - Fetch image, scan metadata, apply policy
- **New** `proxy/src/scanner/imageMetadataScanner.ts` — EXIF extraction + PII check
  - Uses `exif-reader` npm package (lightweight, no native deps)

#### Step 7: Tests
- **New** `proxy/src/test/approval.test.ts` — approval flow, timeout default-deny, remembered rules, REQUIRE_APPROVAL policy
- **New** `proxy/src/test/wsManager.test.ts` — WebSocket connect/disconnect, broadcast, heartbeat
- **New** `proxy/src/test/notifications.test.ts` — channel fan-out, Web Push subscription, Slack message format

#### Smartwatch — DEFERRED to Phase 6
Build after PWA proves the approval workflow works with real users. A watch app with 0 users is pure maintenance cost. If PWA approval rates are strong (target: >50% resolved via push), then build native watch companion.

**New files:** ~20 (proxy: 10, PWA: ~8, tests: 3)
**Modified files:** 5 (`server.ts`, `database.ts`, `package.json`, `ai.route.ts`, `mcpGateway.route.ts`, `policyEngine.ts`)
**New endpoints:** `GET/POST /api/approvals/*`, `GET/POST /api/notifications/*`, `GET /api/sessions/*`
**New tables:** `approval_requests`, `approval_rules`, `notification_channels`, `webpush_subscriptions`
**New dependencies:** `@fastify/websocket`, `web-push`, `exif-reader` (proxy); Vite+React+Tailwind (PWA)

---

### PHASE 5: Enterprise Infrastructure (Industry-Standard)

**Context:** Application layer is stable (Phases 1-4). Now harden for production deployment, horizontal scaling, enterprise compliance, and monetization. Every recommendation below is verified against the actual codebase (64 `db.prepare()` calls, zero transactions, fire-and-forget webhooks, no Docker, Sentry/PostHog in core only) and validated against how GitLab, Sentry, PostHog, n8n, Kong, and Cloudflare solve each problem.

**Design principles:**
- SQLite remains the default for local/dev — PostgreSQL is opt-in via `DB_TYPE=postgres`
- Valkey/Redis is opt-in — all features work with `lru-cache` in-memory (no external deps)
- Docker is recommended but not required
- Core scanning is always free — gate governance/compliance for enterprise tier

#### Step 1: Drizzle ORM Database Abstraction (replaces custom adapter)

**Why Drizzle over custom adapter:** Codebase has 64 raw `db.prepare()` calls across 17 files using `AUTOINCREMENT` (SQLite-specific). A custom adapter would need to reimplement connection pooling, transactions, dialect translation, and prepared statement caching. Drizzle wraps `better-sqlite3` directly (~50KB, not Prisma's 15MB), handles `AUTOINCREMENT` vs `SERIAL` automatically, and gives compile-time type safety. Used by Payload CMS, Cal.com, Turso for exactly this SQLite→PostgreSQL pattern. ([Drizzle docs](https://orm.drizzle.team/docs/get-started-sqlite))

- **New** `proxy/src/db/schema.ts` — Drizzle table definitions (works for both dialects):
  - All 12 existing tables (`logs`, `organizations`, `users`, `api_tokens`, `providers`, `models`, `credits`, `usage_logs`, `admin_audit`, `audit_queue`, `sso_sessions`, `webhooks`, `org_model_rules`, `rate_limits`) + Phase 2-4 tables (`file_scan_cache`, `mcp_audit`, `approval_requests`, `approval_rules`)
  - Drizzle handles `integer().primaryKey({ autoIncrement: true })` → correct DDL per dialect
- **New** `proxy/src/db/index.ts` — factory: `createDb()` returns SQLite or PostgreSQL Drizzle instance based on `DB_TYPE` env
- **New** `proxy/src/db/adapters/sqlite.ts` — `better-sqlite3` + `drizzle-orm/better-sqlite3`
- **New** `proxy/src/db/adapters/postgres.ts` — `pg.Pool` + `drizzle-orm/node-postgres` (min 2, max 10 connections)
- **New** `proxy/src/db/migrate.ts` — run Drizzle migrations on proxy startup
- **Modify** ALL 17 files with `db.prepare()` → Drizzle query builder (type-safe, dialect-agnostic):
  - `authService.ts` (11 queries), `creditService.ts` (7), `orgService.ts` (7), `modelService.ts` (5), `stats.route.ts` (5), `logger.ts` (3), plus 11 more files
  - Migration strategy: file-by-file, test after each file, keep `database.ts` functional during migration
- **Modify** `proxy/package.json`:
  - Add: `drizzle-orm` (~50KB), `pg` (optional dep)
  - Add devDep: `drizzle-kit` (migration generation)
- **Remove** old inline try/catch migration pattern (database.ts lines 206-211)

**Migration order (minimize risk):**
1. Create `schema.ts` + `index.ts` + adapters (new files, no runtime change)
2. Run `drizzle-kit generate` to create SQL migrations from schema
3. Migrate one service at a time: `logger.ts` first (3 queries, lowest risk), then `authService.ts`, etc.
4. After all 17 files migrated: remove raw `db.prepare()` export from `database.ts`
5. Verification: `cd proxy && npm test` passes at every step

#### Step 2: Cache Layer (lru-cache + optional Valkey)

**Why Valkey, not Redis:** Redis changed to SSPL license (March 2024) — not OSI-approved open source. Valkey is the Linux Foundation fork (BSD-3), wire-compatible with Redis, backed by AWS/Google/Oracle. ioredis works with Valkey unchanged. ([Valkey vs Redis 2026](https://dev.to/synsun/redis-vs-valkey-in-2026-what-the-license-fork-actually-changed-1kni))

**Why lru-cache, not custom Map+TTL:** `lru-cache` by Isaac Schlueter (npm creator) has proper LRU eviction, TTL, 50M+ downloads/week. Custom Map+TTL is a maintenance trap.

- **New** `proxy/src/cache/cacheAdapter.ts` — interface `CacheAdapter`:
  - `get(key)`, `set(key, value, ttlSeconds?)`, `del(key)`, `incr(key)`
  - Factory: `createCache()` returns `lru-cache` (default) or Valkey adapter based on `CACHE_STORE=memory|valkey`
- **New** `proxy/src/cache/memoryAdapter.ts` — `lru-cache` wrapper (default, zero external deps)
- **New** `proxy/src/cache/valkeyAdapter.ts` — `ioredis` wrapper for Valkey/Redis
  - `VALKEY_URL` env (default `redis://localhost:6379`)
  - Graceful fallback: if Valkey unavailable, log warning, use memory adapter
- **Integrate:**
  - `proxy/src/auth/authMiddleware.ts` — cache-aside token validation (5min TTL, active invalidation on revoke)
  - `proxy/src/routes/sso.route.ts` — replace in-memory `pendingStates` Map (line 11) with cache adapter (fixes cluster-safety)
  - `proxy/src/scanner/fileScanCache.ts` (Phase 2) — optional Valkey-backed cache
- **Modify** `proxy/package.json`:
  - Add: `lru-cache` (~8KB)
  - Add optionalDep: `ioredis` (for Valkey)

#### Step 3: License Key System (NEW — Critical for Business Model)

**Why:** Zero feature gating exists in the codebase. This is the most important enterprise feature for monetization. Pattern used by GitLab, n8n, Keygen.sh. ([Ed25519 offline licensing](https://keygen.sh/docs/choosing-a-licensing-model/offline-licenses/))

- **New** `proxy/src/license/licenseVerifier.ts`:
  - Ed25519-signed offline license keys (no phone-home required)
  - Format: `base64url(payload).base64url(ed25519_signature)`
  - Public key baked into proxy binary
  - `verifyLicense(key): LicensePayload | null`
  - Expired license degrades to community tier — **never disables security scanning**
  ```typescript
  interface LicensePayload {
    plan: "community" | "team" | "enterprise";
    features: string[];  // ["rbac", "sso:saml", "compliance:soc2", "webhooks:streaming"]
    seats: number;
    orgId: string;
    expiresAt: number;
  }
  ```
- **New** `proxy/src/license/featureGuard.ts`:
  - `requireFeature(feature: string)` — Fastify preHandler that checks license
  - `hasFeature(feature: string): boolean` — for conditional logic
- **New** `proxy/src/routes/license.route.ts`:
  - `POST /api/license` — activate license key
  - `GET /api/license` — current plan and features
  - `DELETE /api/license` — deactivate (revert to community)
- **Modify** `proxy/src/server.ts` — load and verify license on startup

**Tier structure:**
| Feature | Community (Free) | Team | Enterprise |
|---------|-----------------|------|------------|
| All 12+ scanner patterns | Yes | Yes | Yes |
| Policy engine (BLOCK/REDACT/ALLOW) | Yes | Yes | Yes |
| Single-user, single-org | Yes | Yes | Yes |
| Multi-provider gateway | 2 providers | Unlimited | Unlimited |
| Multi-user / RBAC | No | Yes | Yes |
| SSO (SAML/OIDC) | No | No | Yes |
| Hierarchical policies | No | No | Yes |
| Compliance reporting | No | No | Yes |
| Streaming webhooks | No | Basic | Full + SIEM |

#### Step 4: CASL RBAC (replaces hardcoded role checks)

**Why CASL over custom:** Current RBAC is hardcoded `requireRole("admin", "security_lead")` (authMiddleware.ts line 30-43). CASL is isomorphic (same ability defs work in proxy AND React GUI for show/hide), 12KB, condition-based for multi-tenant isolation. There's a Fastify plugin (`fastify-casl`). ([CASL](https://casl.js.org/), [fastify-casl](https://github.com/Inlecom/fastify-casl))

- **New** `proxy/src/auth/abilities.ts` — define abilities per role using `@casl/ability`:
  ```typescript
  defineAbility((can, cannot) => {
    if (role === 'admin') can('manage', 'all');
    if (role === 'developer') { can('read', 'AuditLog', { orgId }); cannot('manage', 'Policy'); }
    if (role === 'auditor') { can('read', 'all'); cannot('manage', 'all'); }
  });
  ```
- **Modify** `proxy/src/auth/authMiddleware.ts` — replace `requireRole()` with `requireAbility('read', 'AuditLog')`
- **Modify** all routes using `requireRole()` (webhook.route.ts, org.route.ts, auth.route.ts, etc.)
- Feature-gated: requires Team+ license (`requireFeature('rbac')`)
- **Modify** `proxy/package.json` — add `@casl/ability`

#### Step 5: Docker + Docker Compose

**Why bookworm-slim over alpine:** Proxy uses `better-sqlite3` (native C++ addon). Alpine uses musl libc — native modules have documented segfault risks. bookworm-slim uses glibc. Used by Sentry, n8n, PostHog. ([Snyk: choosing Node.js Docker image](https://snyk.io/blog/choosing-the-best-node-js-docker-image/))

**Why tini:** Node.js doesn't handle SIGTERM correctly as PID 1. Without tini, K8s graceful shutdown fails silently. Every production Node.js container uses this.

- **New** `Dockerfile` (root) — multi-stage build:
  ```dockerfile
  FROM node:22-bookworm-slim AS builder
  WORKDIR /app
  COPY package*.json ./
  RUN npm ci --omit=dev
  COPY proxy/ proxy/
  RUN cd proxy && npm run build

  FROM node:22-bookworm-slim
  RUN apt-get update && apt-get install -y tini && rm -rf /var/lib/apt/lists/*
  USER node
  WORKDIR /app
  COPY --from=builder /app/proxy/dist ./proxy/dist
  COPY --from=builder /app/node_modules ./node_modules
  COPY proxy/package.json proxy/policy.json ./proxy/
  ENTRYPOINT ["tini", "--"]
  CMD ["node", "proxy/dist/server.js"]
  HEALTHCHECK CMD node -e "fetch('http://localhost:8080/health').then(r=>{if(!r.ok)throw r})"
  ```
- **New** `docker-compose.yml`:
  ```yaml
  services:
    proxy:
      build: .
      ports: ["8080:8080"]
      env_file: .env
      depends_on:
        postgres: { condition: service_healthy }
        valkey: { condition: service_healthy }
      networks: [internal]
    postgres:
      image: postgres:16-alpine
      volumes: [pgdata:/var/lib/postgresql/data]
      environment: { POSTGRES_DB: firewall, POSTGRES_USER: firewall, POSTGRES_PASSWORD_FILE: /run/secrets/pg_password }
      healthcheck: { test: ["CMD", "pg_isready", "-U", "firewall"], interval: 5s }
      networks: [internal]
    valkey:
      image: valkey/valkey:8-alpine
      healthcheck: { test: ["CMD", "valkey-cli", "ping"], interval: 5s }
      networks: [internal]
    ollama:
      image: ollama/ollama
      profiles: [local-llm]
      networks: [internal]
    dashboard:
      build: { context: ., dockerfile: infra/docker/gui.Dockerfile }
      profiles: [dashboard]
      ports: ["3000:3000"]
      networks: [internal]
  networks:
    internal: { driver: bridge }
  ```
- **New** `.dockerignore`, `infra/docker/gui.Dockerfile`

#### Step 6: Helm Chart (replaces raw K8s manifests)

**Why Helm over Kustomize:** Every major OSS product ships Helm (GitLab, Sentry, PostHog, n8n, Grafana, Traefik). Enterprise procurement checks for Helm chart. ArtifactHub for discoverability. ArgoCD/Flux have first-class Helm support. ([n8n Helm chart](https://artifacthub.io/packages/helm/n8n/n8n))

**Key constraint:** SQLite = single-writer = `replicaCount: 1`. With PostgreSQL, replicas scale to 2-10. This is exactly what n8n and Metabase do.

- **New** `deploy/helm/ai-firewall/`:
  - `Chart.yaml`, `values.yaml`
  - `templates/`: `deployment.yaml`, `service.yaml`, `ingress.yaml`, `configmap.yaml`, `secret.yaml`, `hpa.yaml`, `pdb.yaml`, `serviceaccount.yaml`, `networkpolicy.yaml` (critical for security product), `NOTES.txt`
- `values.yaml` toggles: `database.type: sqlite|postgresql`, `cache.type: memory|valkey`, `replicaCount` (forced to 1 when SQLite)
- No Kubernetes Operator — Helm is sufficient for a single-service proxy. Revisit in 12-18 months.

#### Step 7: Observability (OTel-only, not prom-client + OTel)

**Why OTel only:** Don't use both `prom-client` AND OpenTelemetry. Use OTel as single instrumentation layer with Prometheus exporter. `@opentelemetry/instrumentation-fastify` is deprecated — use `@fastify/otel` (maintained by Fastify team). ([fastify/otel](https://github.com/fastify/otel))

**Why configure Pino properly:** Fastify already uses Pino internally (`logger: true` on line 31 of server.ts). Just configure it — don't add a separate logger. **NEVER log request bodies** — they contain the secrets we're scanning for.

- **New** `proxy/src/observability/instrumentation.ts` — OTel setup (MUST load before Fastify):
  - `@fastify/otel` for route instrumentation
  - `@opentelemetry/exporter-prometheus` for `/metrics` endpoint
  - `@opentelemetry/exporter-trace-otlp-http` for distributed tracing (enterprise)
  - Custom histogram boundaries for LLM calls: `[100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000, 120000]`ms (default OTel buckets 0-10s are wrong for 2-120s LLM calls)
- **Modify** `proxy/src/server.ts` — configure Pino properly:
  ```typescript
  Fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info',
      transport: process.env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
      // NEVER log request bodies — they contain secrets
      serializers: { req: (req) => ({ method: req.method, url: req.url }) }
    }
  });
  ```
- **Metrics exposed:**
  - `af_requests_total{action,provider,model}` — counter
  - `af_request_duration_seconds{route}` — histogram
  - `af_tokens_total{direction,provider}` — counter
  - `af_scan_duration_seconds{scanner}` — histogram
  - `af_mcp_calls_total{server,tool,action}` — counter
- **New** `infra/grafana/` — pre-built dashboard JSON files (4 dashboards)
- **Free vs Enterprise:** `/metrics` endpoint is free. OTel Collector + distributed tracing + SIEM = enterprise.

#### Step 8: Webhook Delivery (Stripe/GitHub Pattern)

**Why 6 retries with jitter:** Current implementation is fire-and-forget with silent error suppression (webhook.route.ts line 55-57). Stripe and GitHub use 6 retries with exponential backoff + jitter + HMAC signing + idempotency keys.

- **Modify** `proxy/src/routes/webhook.route.ts`:
  - 6 retries: immediate, 30s, 2min, 15min, 1hr, 4hr (all + random jitter)
  - HMAC-SHA256 signed payloads: `X-AF-Webhook-Signature: t=<timestamp>,v1=<hmac>` (already have HMAC, just add timestamp)
  - Idempotency key: `X-AF-Webhook-ID` for receiver deduplication
  - Dead letter after 6 failures
  - `GET /api/webhooks/:id/deliveries` — delivery history
- **New** `proxy/src/services/webhookQueue.ts` — SQLite-backed delivery queue with `setInterval` polling
  - Upgrade path: BullMQ when volume exceeds ~1000 events/min
- **New** `webhook_deliveries` table: `id, webhook_id, event, payload_hash, status (pending/delivered/failed/dead), attempts, next_retry_at, last_error, created_at`

#### Step 9: Policy Inheritance (Enterprise)

- **New** `proxy/src/policy/policyInheritance.ts`:
  - `resolveEffectivePolicy(orgId, teamId?, projectRoot?)` — AWS SCP-style "deny wins, intersect down"
  - Child policy can only be MORE restrictive than parent (never less)
  - Org policy → Team override → Project `.aifirewall.json` override
  - Cache resolved policies in LRU (invalidate on change)
- **Modify** `proxy/src/routes/org.route.ts` — model allow/denylist per org
- Feature-gated: requires Enterprise license

#### Step 10: Compliance Reporting (Enterprise)

- **New** `proxy/src/services/complianceService.ts`:
  - `setInterval`-based scheduled reports (not node-cron — premature for v1)
  - `REPORT_INTERVAL_HOURS` env (default 168 = weekly, 0 = disabled)
  - Generates: total requests, block rate, top secret types, risk trend, PII exposure summary
  - Stores in `compliance_reports` table, delivers via webhook
- Feature-gated: requires Enterprise license

#### Step 11: CI/CD (Extend Continue's 32 Existing Workflows)

**Why extend, not rewrite:** 32 GitHub workflows already exist. Husky + lint-staged already configured (prettier pre-commit). Don't build from scratch.

- **Add** `proxy-checks` job to existing PR workflow:
  - Type check: `cd proxy && npx tsc --noEmit`
  - Unit tests: `cd proxy && npm test`
  - Build check: `cd proxy && npm run build`
- **New** `.github/workflows/docker.yml`:
  - Buildx multi-arch (`linux/amd64`, `linux/arm64`)
  - Push to GHCR (not DockerHub — GHCR is free for public repos, integrated with GitHub)
  - Tag-triggered publishing
- **New** `.github/workflows/security.yml`:
  - CodeQL + `npm audit` + gitleaks as PR gates
  - Trivy container scanning (CNCF standard; Snyk is proprietary)
- **Enhance** `.husky/pre-commit` — add proxy file scan on staged files (alongside existing prettier)

#### Step 12: Rate Limiting (Two-Layer, Cloudflare/Kong Pattern)

**Why two layers:** `@fastify/rate-limit` only does fixed window per IP — can't do dual RPM + TPM or per-user limits from the `rate_limits` table.

- **Layer 1:** `@fastify/rate-limit` — 200 req/min per IP (DDoS protection, standard `X-RateLimit-*` headers)
- **Layer 2:** Custom middleware using cache adapter:
  - Sliding window counter for requests/minute (Cloudflare's approach)
  - Token bucket for tokens/minute (OpenAI's approach)
  - Reads `rate_limits` table (exists but unused) for per-user/org limits
  - `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` headers (RFC 6585)

#### Implementation Order (dependency-aware)
| # | Step | Effort | Why This Order |
|---|------|--------|----------------|
| 1 | Drizzle DB abstraction + migrations | 3-4 days | Foundation — everything depends on DB |
| 2 | Cache layer (lru-cache + ioredis) | 2 days | Needed before rate limiting and auth caching |
| 3 | License key system (Ed25519) | 2 days | Gates all enterprise features |
| 4 | CASL RBAC + feature guards | 2 days | Depends on license for gating |
| 5 | Dockerfile + docker-compose | 1-2 days | Needed before Helm and CI |
| 6 | Helm chart | 2 days | Depends on Docker |
| 7 | OTel observability + /metrics | 3 days | Independent |
| 8 | Webhook delivery (Stripe pattern) | 2 days | Independent |
| 9 | Policy inheritance | 2 days | Enterprise, depends on RBAC |
| 10 | Compliance reporting | 2-3 days | Enterprise, depends on policy/audit |
| 11 | CI/CD (extend Continue's) | 2 days | Can parallelize |
| 12 | Rate limiting (two-layer) | 2 days | Depends on cache |

**Total: ~25-30 days** (vs ~35+ in old plan)

#### Dependency Changes

**Add:**
- `drizzle-orm` (~50KB) — replaces custom DB adapter
- `lru-cache` (~8KB) — replaces custom Map+TTL
- `@casl/ability` (~12KB) — replaces hardcoded RBAC
- `@fastify/otel` — replaces deprecated `@opentelemetry/instrumentation-fastify`
- `@opentelemetry/sdk-node`, `@opentelemetry/exporter-prometheus`
- `@fastify/rate-limit` — Layer 1 DDoS protection
- `tini` — Docker PID 1 signal handling

**Add as devDeps:**
- `drizzle-kit` — migration generation
- `pino-pretty` — local dev logging

**Add as optionalDeps:**
- `pg` — PostgreSQL (enterprise)
- `ioredis` — Valkey/Redis (enterprise)

**Remove (vs old plan):**
- ~~`prom-client`~~ — OTel Prometheus exporter replaces it
- ~~`node-cron`~~ — `setInterval` sufficient for v1
- ~~Custom `dbAdapter.ts`~~ — Drizzle handles it
- ~~Custom `memoryAdapter.ts`~~ — lru-cache handles it

**New files:** ~30
**Modified files:** ~20 (17 DB files + auth + server + webhook)
**New directories:** `proxy/src/db/adapters/`, `proxy/src/cache/`, `proxy/src/license/`, `proxy/src/observability/`, `deploy/helm/`, `infra/grafana/`
**New tables:** `webhook_deliveries`, `compliance_reports`

---

## ARCHITECTURE DIAGRAM (Final State)

```
User (VS Code / CLI / JetBrains / Mobile / Watch)
      |
      v
Extension Layer (spawns proxy, connects via REST + WebSocket)
      |
      v
+--------------------------------------------------------------------+
|                   AI Firewall Proxy (:8080)                        |
|                                                                    |
|  LLM Request Flow:                                                 |
|    Request -> Token Count (tiktoken) -> Scanner Pipeline           |
|    -> Policy Engine -> Context Window Warning (advisory)           |
|    -> Cost-Aware Router (opt-in) -> Provider Adapter -> LLM       |
|    -> Response Scan -> X-AF-* Headers -> Audit Log                 |
|                                                                    |
|  MCP Tool Flow:                                                    |
|    Tool Call -> Scan Inputs -> Policy Check -> MCP Server          |
|    -> Scan Outputs -> X-AF-MCP-* Headers -> MCP Audit Log         |
|                                                                    |
|  File Scan Flow:                                                   |
|    File Path -> Scope Check -> Scanner Pipeline -> Cache Result    |
|                                                                    |
|  Services:                                                         |
|    Auth + SSO + RBAC  |  Credit/Usage Tracking                     |
|    Approval System (WebSocket)  |  Session Sync                    |
|    MCP Gateway + Registry  |  Benchmark/Metrics                    |
|                                                                    |
|  Storage: SQLite (local) | PostgreSQL (enterprise)                 |
|  Cache: In-Memory (local) | Redis (enterprise)                    |
|  Observability: Prometheus + OpenTelemetry + Grafana               |
+--------------------------------------------------------------------+
      |                    |                    |
      v                    v                    v
AI Providers          MCP Servers          Security MCP Servers
(OpenAI, Anthropic,   (Ecosystem:          (@ai-firewall/vault,
 Gemini, Ollama,       Filesystem, GitHub,   @ai-firewall/scanner,
 60+ via core/)        Slack, Gmail, Git)    @ai-firewall/audit,
                                             @ai-firewall/codebase)
```

---

## REQUEST FLOW (Token-Optimized, Advisory-Only)

```
User Prompt
   |
   v
1. Token Estimation (js-tiktoken, fallback to length/4)
   |
   v
2. Firewall Scan (secret + PII + entropy + prompt injection)
   |
   v
3. Policy Decision (BLOCK / REDACT / ALLOW)
   |
   v
4. Context Window Check (ADVISORY — sets X-AF-Context-Overflow header, never truncates)
   |
   v
5. Cost Estimation (real tokens x model pricing)
   |
   v
6. Cost-Aware Routing (opt-in, disabled by default — falls through to risk-based)
   |
   v
7. Provider Adapter (OpenAI/Anthropic/Gemini/Ollama format)
   |
   v
8. LLM Call (forward as-is, provider handles overflow)
   |
   v
9. Response Scan (scan output for leaked secrets/PII)
   |
   v
10. Audit Log + X-AF-* Headers + Return to User
```

---

## MCP TOOL FLOW

```
Agent requests MCP tool call
   |
   v
1. Route through proxy POST /v1/mcp/tools/call (fallback: direct if proxy down)
   |
   v
2. Scan INPUTS (serialize args -> scanner pipeline)
   |
   v
3. Tool Policy Check (per-tool ALLOW/BLOCK/REDACT from config)
   |
   v
4. Approval Check (high-risk tools -> push to mobile/watch for user consent)
   |
   v
5. Forward to MCP Server via MCPManagerSingleton
   |
   v
6. Scan OUTPUTS (tool response -> scanner pipeline)
   |
   v
7. Redact if needed -> MCP Audit Log -> X-AF-MCP-* Headers -> Return
```

---

## RISK ASSESSMENT

| Risk | Impact | Phase | Mitigation |
|------|--------|-------|------------|
| Tokenizer WASM fails in edge runtime | HIGH | 1 | Fallback to `length/4` heuristic; try/catch wraps all calls |
| Cost routing picks wrong model | MEDIUM | 1 | Disabled by default; user opts in via policy.json |
| MCP gateway adds latency to tool calls | MEDIUM | 3 | Target <50ms; fallback to direct MCP if proxy unreachable |
| Scanner extraction breaks proxy imports | HIGH | 3 | Re-export from proxy scanner files; `npm test` gate |
| Mobile WebSocket disconnects | MEDIUM | 4 | Heartbeat ping, auto-reconnect, offline queue |
| Approval timeout blocks agent | HIGH | 4 | Configurable timeout; default-deny is safe; "Allow Always" remembers |
| PostgreSQL migration data loss | HIGH | 5 | Run both DBs in parallel; migration rollback scripts; backup first |
| Redis unavailable | MEDIUM | 5 | Graceful fallback to in-memory adapter; log warning |
| Docker image too large | LOW | 5 | Multi-stage build; Alpine base; target <150MB |

---

## VERIFICATION PLAN

### Phase 1: Token Intelligence
- `cd proxy && npm test` — all existing + new tests pass
- Estimate endpoint: verify real token count (~4 for "Hello world"), not heuristic (~3)
- Chat headers: `X-AF-Input-Tokens`, `X-AF-Estimated-Cost`, `X-AF-Token-Method: tiktoken` present
- Context overflow: oversized prompt -> `X-AF-Context-Overflow: true` header, request still forwards (NOT blocked)
- Schema: `role: "invalid"` -> 400 error (currently accepts it)
- Cost routing: enable in policy.json, configure rule, verify routing changes
- Fallback: break tokenizer -> heuristic kicks in, requests still work

### Phase 2: File Scanning
- `POST /api/scan/file` with `.env.example` -> returns scan results with secrets found
- `POST /api/scan/batch` with 5 files -> returns array + summary
- Cache: scan same file twice -> second response has `cached: true`
- Max file size: file exceeding `max_file_size_kb` -> error (not silent truncation)
- CLI: `cn scan ./proxy/src/config.ts` -> color-coded terminal output

### Phase 3: MCP Gateway
- Scanner package: `cd proxy && npm test` passes after extraction
- Gateway: tool call with secret in args -> BLOCK response with `X-AF-MCP-Action: BLOCK`
- Gateway output: tool returning PII -> REDACT in response
- E2E: VS Code agent uses MCP filesystem tool -> proxy scans -> `mcp_audit` table entry created
- Performance: gateway scanning <50ms per typical tool call
- Fallback: proxy down -> direct MCP call still works
- Tool search: `tool_search` returns matching tools without loading full schemas

### Phase 4: Mobile + Approvals
- WebSocket: mobile connects, receives heartbeat, survives reconnect
- Approval flow: VS Code triggers high-risk action -> mobile receives push -> tap Allow -> VS Code continues
- Approval timeout: no response in 60s -> default-deny, agent gets permission error
- "Allow Always": approve once with remember -> same resource auto-approved next time
- Session sync: start chat in VS Code -> mobile shows active session

### Phase 5: Enterprise
- **Drizzle migration:** `cd proxy && npm test` passes after each file migration (17 files, one at a time)
- **Docker:** `docker-compose up` -> proxy + postgres:16 + valkey:8 start, health checks pass via `service_healthy`
- **PostgreSQL:** all tables created via Drizzle migrations, queries work identically to SQLite
- **Valkey cache:** repeated API token validation returns from cache (verify via `X-Cache: HIT` header or log)
- **License:** activate Ed25519 key -> `GET /api/license` shows plan + features. Expired key -> degrades to community (scanning still works)
- **CASL RBAC:** developer role can read logs, cannot manage policies. Admin can do both. Verified via 403 on restricted endpoints
- **Observability:** `GET /metrics` returns OpenTelemetry Prometheus format; Grafana dashboards load
- **Helm:** `helm install ai-firewall ./deploy/helm/ai-firewall` -> proxy pod running, service accessible
- **Webhook retry:** fail delivery -> retries 6x with backoff+jitter -> dead letter after exhaustion -> `GET /api/webhooks/:id/deliveries` shows history
- **CI:** PR with staged secret -> GitHub Action flags it via gitleaks + Trivy
- **Rate limiting:** exceed L1 (200 req/min IP) -> 429 with `X-RateLimit-*` headers. Exceed L2 (per-user TPM) -> 429 with custom message
- **Policy inheritance:** org blocks model X -> team can't unblock -> project `.aifirewall.json` inherits
