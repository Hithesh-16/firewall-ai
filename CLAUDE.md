# AI Firewall (continue-main)

## What This Is

Open-source AI code agent (built on Continue) with a built-in security proxy. Every LLM request and MCP tool call passes through a local Fastify proxy that scans for secrets, PII, and prompt injection before forwarding to any provider. Ships as a VS Code extension, CLI agent, JetBrains plugin, and standalone web dashboard.

## Architecture

```
continue-main/
├── proxy/                    — Security proxy (Fastify, port 8080)
│   ├── src/scanner/          — Re-exports from @ai-firewall/scanner (backward-compatible)
│   ├── src/policy/           — Policy engine (BLOCK/REDACT/ALLOW decisions) + business logic DSL
│   │   └── businessLogicDsl.ts — Org-specific rule DSL (9 operators, AND/OR/NOT, 5 actions)
│   ├── src/gateway/          — Multi-provider adapters + token intelligence
│   │   ├── adapters/         — OpenAI, Anthropic, Gemini, Ollama format adapters
│   │   ├── tokenCounter.ts   — Real token counting (js-tiktoken, WASM BPE)
│   │   ├── contextWindow.ts  — Advisory context window checks (never truncates)
│   │   └── costEstimator.ts  — Pre-request cost estimation
│   ├── src/schemas/          — Centralized Zod schemas (chatSchemas.ts)
│   ├── src/mcp/              — MCP Security Gateway
│   │   ├── mcpScanPipeline.ts — Scan MCP tool I/O through scanner pipeline
│   │   └── mcpAuditLogger.ts  — Log/query MCP audit trail
│   ├── src/scanner/          — Advanced scanners (multi-turn, RAG, multimodal, grounding, etc.)
│   │   ├── multiTurnTracker.ts — Multi-turn attack memory (session state, escalation detection)
│   │   ├── ragScanner.ts     — RAG injection shield (document/chunk scanning, 17 patterns)
│   │   ├── intentCluster.ts  — Semantic intent clustering (SimHash, coordinated attack detection)
│   │   ├── behaviorFingerprint.ts — Per-user behavioral profiling (z-score anomaly detection)
│   │   ├── promptConfidentiality.ts — Prompt extraction shield (22 patterns)
│   │   ├── crossModelCorrelation.ts — Cross-model attack correlation (incident grouping)
│   │   ├── multiModalScanner.ts — Multi-modal scanning (image OCR, audio, structured files)
│   │   └── groundingEngine.ts — Hallucination grounding (claim extraction, source matching)
│   ├── src/ml/               — ML-based detection
│   │   └── embeddingDetector.ts — Embedding-based injection detector (60-dim features, KNN+centroid)
│   ├── src/intelligence/     — Threat intelligence
│   │   ├── federatedIntel.ts — Privacy-preserving federated threat signatures (LSH, MinHash)
│   │   └── supplyChain.ts    — LLM supply chain integrity (hash verify, backdoor scan, drift)
│   ├── src/compliance/       — Regulatory compliance
│   │   └── complianceMapper.ts — Compliance mapping (GDPR, EU AI Act, HIPAA, NIST, SOC 2, ISO 42001)
│   ├── src/agents/           — Autonomous agents
│   │   └── redTeamAgent.ts   — Continuous red team agent (62 probes, 10 categories)
│   ├── src/network/          — Network security
│   │   └── shadowAiDetector.ts — Shadow AI discovery (32 known LLM endpoints)
│   ├── src/routes/           — 50+ API endpoints
│   ├── src/router/           — Risk-based + cost-aware smart routing
│   ├── src/auth/             — Auth, SSO, RBAC middleware
│   ├── src/vault/            — AES-256-GCM encrypted token vault
│   ├── src/db/               — SQLite (better-sqlite3, WAL mode)
│   ├── src/redactor/         — Sensitive data redaction + reversible PII vault
│   │   └── piiVault.ts       — Zero-knowledge reversible PII tokenization (HMAC-SHA256)
│   ├── src/tasks/            — Task framework (7 types, state machine, progress tracking)
│   │   ├── taskTypes.ts      — Task type definitions + state transitions
│   │   └── taskFramework.ts  — Task lifecycle, validation, progress
│   ├── src/memory/           — Memory system (MEMORY.md index, auto-extraction)
│   │   ├── memoryTypes.ts    — 4 memory types (user/feedback/project/reference)
│   │   ├── memdir.ts         — File-based memory storage + MEMORY.md index
│   │   └── memoryExtractor.ts — Auto-extract memories from conversation text
│   ├── src/commands/         — Command system (10 built-in slash commands)
│   │   ├── commandTypes.ts   — Command type definitions
│   │   ├── commandLoader.ts  — Discover + load commands
│   │   └── builtinCommands.ts — /doctor, /compact, /cost, /stats, /memory, /tasks, /review, /diff, /help, /share, /resume
│   ├── src/skills/           — Skills system (SKILL.md format, bundled skills)
│   │   ├── skillTypes.ts     — Skill type definitions + frontmatter schema
│   │   ├── skillLoader.ts    — Discover + load skills from SKILL.md files
│   │   └── bundled/          — Built-in skills (commit, explain)
│   ├── src/plugins/          — Plugin system (plugin.json manifest)
│   │   ├── pluginTypes.ts    — Plugin manifest + lifecycle types
│   │   └── pluginLoader.ts   — Discover, load, enable/disable plugins
│   └── src/permissions/      — Tool permission enforcement
│       └── toolPermissions.ts — 3-level permission check (config → auto-classify → dialog)
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
│   │   ├── toolPermissions.ts — Permission rules, dangerous file/command detection
│   │   └── toolRegistry.ts   — Tool registry with deduplication and search
│   ├── context/              — Context providers (@file, @diff, @git, @web, @docs, MCP, etc.)
│   ├── context/mcp/          — MCP client (stdio, ws, sse, http transports, OAuth)
│   ├── indexing/             — LanceDB vector + full-text codebase search
│   ├── autocomplete/         — Tab completion engine
│   └── commands/             — Slash commands (/commit, /review, /cmd)
├── gui/                      — React + Vite + Tailwind webview UI (environment-aware)
│   ├── src/pages/            — Chat, Security, Organization, Config, History, Usage, Setup, Tasks, Memory, Plugins, Skills, Privacy
│   ├── src/pages/setup/      — Setup wizard route (OnboardingWizard)
│   ├── src/components/ui/    — Reusable: StatCard, RoleBadge, ConfirmDialog, LoadingSpinner, ErrorBanner
│   ├── src/components/agents/CoordinatorView.tsx — Multi-agent dashboard
│   ├── src/components/agents/AgentWizard.tsx — 4-step agent creation wizard
│   ├── src/components/onboarding/OnboardingWizard.tsx — 5-step setup wizard
│   ├── src/hooks/useCostTracker.ts — Real-time cost tracking hook
│   └── src/components/WebNavSidebar.tsx — Standalone web navigation (hidden in IDE mode)
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
- **SQLite** via better-sqlite3 — WAL mode, parameterized queries, 20+ tables
- **Provider adapters** normalize OpenAI <-> Anthropic <-> Gemini <-> Ollama formats
- **Scanner pipeline** order: unicode normalization -> secret -> PII -> entropy -> context adjustment -> prompt injection -> policy decision
- **Token Intelligence** — real token counting via `js-tiktoken` in `proxy/src/gateway/tokenCounter.ts`, advisory context window checks (never truncates), cost-aware routing (opt-in via `policy.json`)
- **File Scanning** — `proxy/src/scanner/fileScanService.ts` runs full pipeline on files, `fileScanCache.ts` provides content-addressed caching (SHA-256 hash key)
- **File Scan Enforcement** — `core/util/fileScanProxy.ts` calls `POST /api/scan/file` before every file read in CLI and core tools. BLOCK = file never read, REDACT = sanitized content returned, ALLOW = normal read. Fail-open if proxy unreachable.
- **Scan Result Display** — CLI `ScanBanner` and GUI `ScanResultBanner` show scan findings with masked malicious content in red. Findings sent via `X-AF-Findings` header (compact JSON). Masking: keys show first 4 + last 2 chars, emails mask local part, phone/SSN show last 4.
- **MCP Security Gateway** — `proxy/src/mcp/mcpScanPipeline.ts` scans all MCP tool inputs/outputs, `mcpAuditLogger.ts` logs audit trail. No competitor scans MCP tool calls.
- **Unicode Normalization** — `packages/scanner/src/unicodeNormalizer.ts` strips zero-width chars, maps Cyrillic/Greek confusables to Latin, removes bidi overrides. Runs BEFORE all scanners (ASI04 defense).
- **Rules File Scanning** — `proxy/src/scanner/ruleFileScanService.ts` scans .cursorrules, .continuerules, CLAUDE.md for injection/secrets/unicode anomalies. Route: `POST /api/scan/rules`.
- **Response Scanning** — `proxy/src/middleware/responseScanner.ts` scans LLM responses for leaked secrets/PII (LLM05 defense). Opt-in via `response_scanning.enabled` in policy.json. Supports streaming via Transform.
- **Shared Scanner Package** — `@ai-firewall/scanner` (`packages/scanner/`) contains all pure-function scanners. Proxy re-exports for backward compatibility. MCP servers and future services import directly.
- **X-AF-\*** response headers carry scan metadata + token intelligence from proxy to extension
- **AES-256-GCM** encryption for all stored API keys in token vault
- **Redux Toolkit** for GUI state management
- **esbuild** for VS Code extension bundling
- **LanceDB** for vector indexing of codebase
- **MCP Client** (in `core/context/mcp/MCPConnection.ts`) — production-grade, 4 transports (stdio, ws, sse, http), OAuth, tool registry
- **Task Framework** — `proxy/src/tasks/taskFramework.ts` manages 7 task types (`local_agent`, `bash`, `mcp_tool`, `file_edit`, `approval_wait`, `background_agent`, `sub_agent`) with state machine (pending -> running -> completed/failed/killed), progress tracking via WebSocket `task_event`
- **Memory System** — `proxy/src/memory/memdir.ts` provides file-based memory storage with MEMORY.md index (max 200 lines / 25KB). 4 memory types: user, feedback, project, reference. `memoryExtractor.ts` auto-extracts memories from conversation text.
- **Tool Permissions** — 3-level check: config rules (pattern matching) -> auto-classifier (dangerous file/command detection) -> user dialog. `core/tools/toolPermissions.ts` for rules, `proxy/src/permissions/toolPermissions.ts` for proxy-side enforcement.
- **Agent Service** — `proxy/src/services/agentService.ts` manages sub-agent lifecycle: spawn, kill, worktree isolation, inter-agent messaging
- **Compact Service** — `proxy/src/services/compactService.ts` provides 3 conversation compaction strategies: clear old tool results, summarize old messages, drop oldest
- **Command System** — `proxy/src/commands/` provides 10 built-in slash commands (`/doctor`, `/compact`, `/cost`, `/stats`, `/memory`, `/tasks`, `/review`, `/help`, `/share`, `/resume`). Loaded via `commandLoader.ts`, commands reuse existing proxy services.
- **Skills System** — `proxy/src/skills/` supports SKILL.md files with YAML frontmatter. Bundled skills: `commit`, `explain`. Loaded via `skillLoader.ts`.
- **Plugin System** — `proxy/src/plugins/` supports `plugin.json` manifests for discover/load/enable/disable lifecycle
- **Hook Service** — `proxy/src/services/hookService.ts` fires shell commands on 13 event types with variable expansion and safe environment
- **WebSocket Events** — `task_event` WsEventType added for real-time task lifecycle updates (task_created, task_started, task_progress, task_completed, task_killed)
- **Cron Service** — `proxy/src/services/cronService.ts` simple polling (60s interval), schedule format (`Nm`/`Nh`/`Nd` for minutes/hours/days). CRUD + enable/disable per job.
- **Feature Flags** — `proxy/src/services/featureFlagService.ts` hash-based rollout (0-100%), include/exclude user lists, CRUD for flag definitions
- **Cost Tracker** — `proxy/src/gateway/costTracker.ts` in-memory session-level cost tracking with per-model breakdown, format helpers, purge of old sessions
- **Multi-Turn Attack Memory** — `proxy/src/scanner/multiTurnTracker.ts` tracks escalation across conversation turns. Detects escalation (rising risk over 3+ turns), pivot (>60% category change), repetition (same text hash 3+ times). Session TTL 30min.
- **RAG Injection Shield** — `proxy/src/scanner/ragScanner.ts` scans documents/chunks before RAG ingestion. 17 patterns covering instruction override, delimiter injection, encoding tricks, whitespace padding. Paragraph-based chunk splitting (max 2000 chars).
- **Intent Clustering** — `proxy/src/scanner/intentCluster.ts` detects coordinated attacks from multiple users. SimHash fingerprinting with 3-word n-gram shingles, Hamming distance < 5 threshold. Alerts when 3+ distinct users cluster within 5min window.
- **Behavioral Fingerprinting** — `proxy/src/scanner/behaviorFingerprint.ts` builds per-user profiles (prompt length, word count, vocabulary diversity, frequency, time-of-day). Z-score anomaly detection (>2 std deviations), cold start protection (10 samples min).
- **Prompt Confidentiality Shield** — `proxy/src/scanner/promptConfidentiality.ts` detects system prompt extraction attempts. 22 weighted patterns covering direct requests, role-play, translation, encoding, model inversion, training data extraction.
- **Cross-Model Correlation** — `proxy/src/scanner/crossModelCorrelation.ts` correlates attacks across GPT-4/Claude/Gemini into unified incidents. SimHash text similarity + user ID matching. Severity: 2 models = medium, 3+ = high, 3+ models AND 2+ users = critical.
- **Multi-Modal Scanner** — `proxy/src/scanner/multiModalScanner.ts` scans non-text content. Image (11 OCR injection patterns), audio (10 phonetic/SSML patterns), structured files (12 patterns: HTML hidden elements, CSV formula injection, JSON prototype pollution, PDF JS, XML XXE).
- **Hallucination Grounding** — `proxy/src/scanner/groundingEngine.ts` cross-references LLM outputs against source documents. 4-component scoring: Jaccard term overlap (40%), bigram overlap (25%), exact substring (20%), entity overlap (15%). Per-claim and overall grounding scores.
- **Embedding Detector** — `proxy/src/ml/embeddingDetector.ts` lightweight ML injection detection. 60-dimensional feature vectors (character distribution, token stats, structural, injection-specific). KNN (k=5) + centroid distance classification. Pre-seeded with 40 examples.
- **Federated Threat Intelligence** — `proxy/src/intelligence/federatedIntel.ts` privacy-preserving attack signature sharing via LSH (locality-sensitive hashing). MinHash with 64 hash functions, 8 bands. Signatures auto-purge after 24 hours. Tenant IDs SHA-256 hashed.
- **Supply Chain Integrity** — `proxy/src/intelligence/supplyChain.ts` LLM supply chain verification. Model hash verification, backdoor trigger scanning (16 patterns), provenance auditing (provider trust, license, quantization), behavior drift detection (response length, tokens, refusal rate, topics).
- **Compliance Mapper** — `proxy/src/compliance/complianceMapper.ts` maps security events to 6 regulations (GDPR, EU AI Act, HIPAA, NIST AI RMF, SOC 2, ISO 42001) with 31 articles. Auto-generates evidence packages with event-to-regulation mapping and remediation guidance.
- **Business Logic DSL** — `proxy/src/policy/businessLogicDsl.ts` org-specific rule engine. YAML-like syntax, 9 condition operators (contains, matches, startsWith, endsWith, length_gt, length_lt, category_is, role_is, model_is), AND/OR/NOT logic, 5 actions (BLOCK/REDACT/WARN/LOG/ESCALATE), priority ordering.
- **Red Team Agent** — `proxy/src/agents/redTeamAgent.ts` autonomous adversarial testing. 62 probe templates across 10 categories (injection, jailbreak, extraction, hallucination, bias, privacy, toxicity, encoding, roleplay, multilingual). Vulnerability detection + refusal recognition. Auto-generates recommendations.
- **Shadow AI Detector** — `proxy/src/network/shadowAiDetector.ts` discovers unapproved LLM API usage. 32 known endpoints (OpenAI, Anthropic, Google, Cohere, Mistral, HuggingFace, Replicate, etc.). Hostname + path + content-type heuristics. Approved endpoint allowlist.
- **PII Vault** — `proxy/src/redactor/piiVault.ts` reversible PII tokenization. Replace PII with `<PII_{TYPE}_{6-char-hex}>` tokens before LLM, restore after. HMAC-SHA256 deterministic tokens per session. Auto-expire sessions after TTL (default 1 hour). Zero-knowledge: nothing persists.

## Testing

```bash
cd proxy && npm run test:unit  # 662 tests (policy, scanners, token, file scan, MCP, control plane, enterprise, agent core, commands, skills, coordinator, cron, flags, advanced scanners, advanced features)
cd core && npm test            # Core agent engine tests
cd gui && npm test             # GUI component tests
```

Test breakdown (662 proxy tests):

- **14** — Original (policy engine, prompt injection, STRICT_LOCAL, model policy, BlindMI)
- **20** — Phase 1: Token Intelligence (tokenCounter, contextWindow, costEstimator)
- **9** — Phase 2: File Scanning (fileScanService, fileScanCache)
- **9** — Phase 3: MCP Gateway (mcpScanPipeline, mcpAuditLogger)
- **10** — Phase 4: Control Plane (approvals, sessions, notifications, WebSocket)
- **13** — Phase 5: Enterprise (cache, license, webhook queue)
- **16** — Unicode Normalizer (zero-width, confusable, bidi, CJK/emoji safe)
- **7** — Rule File Scanning (injection, secrets, unicode in rule files)
- **10** — Response Scanner (secrets/PII in LLM output, extract/replace)
- **~50** — Agent Core Phase 1: Tasks (CRUD, state machine, progress, kill, lifecycle)
- **~40** — Agent Core Phase 1: Memory (frontmatter, index, CRUD, extraction, truncation)
- **~30** — Agent Core Phase 1: Tool Permissions (deny/allow/ask, plan mode, wildcards, dangerous paths)
- **~25** — Agent Core Phase 1: Agent Service (spawn, kill, worktree, messaging)
- **~20** — Agent Core Phase 1: Compact Service (3 strategies)
- **~30** — Phase 2: Commands (10 built-in, loader, execution)
- **~25** — Phase 2: Skills (SKILL.md, bundled, invoke)
- **~20** — Phase 2: Plugins (manifest, loader, enable/disable)
- **~15** — Phase 2: Hook Service (13 event types, shell exec, variable expansion)
- **~30** — Phase 3: Coordinator + Worker Pool (agent defs, sessions, worker spawning, pool status, formatting)
- **~12** — Phase 3: Cost Tracker (session tracking, per-model breakdown, format, purge)
- **~12** — Phase 3: Feature Flags (CRUD, rollout eval, include/exclude, load settings)
- **~9** — Phase 3: Cron Service (schedule parsing, CRUD, enable/disable)
- **~5** — Phase 3: Hook Service (register, event filtering, unregister, history)
- **55** — Advanced Scanners (multi-turn tracker, RAG scanner, intent clustering, behavior fingerprinting, prompt confidentiality, cross-model correlation, multi-modal scanner, grounding engine)
- **63** — Advanced Features (PII vault, embedding detector, federated intelligence, supply chain integrity, compliance mapper, business logic DSL, red team agent, shadow AI detector)
- **1 pre-existing fail** (known)

## Request Flow (Token-Optimized)

```
Extension/CLI -> localhost:8080/v1/chat/completions
  1. Unicode Normalization (strip zero-width, map confusables, remove bidi)
  2. Token Estimation (js-tiktoken, fallback to length/4)
  3. Scanner Pipeline (secrets, PII, entropy, prompt injection — 23 categories)
  4. Policy Engine (BLOCK/REDACT/ALLOW)
  5. Context Window Check (ADVISORY — sets X-AF-Context-Overflow, never truncates)
  6. Cost Estimation (real tokens x model pricing)
  7. Cost-Aware Routing (opt-in, disabled by default — falls through to risk-based)
  8. Redactor (if REDACT)
  9. Gateway Router (resolve provider + model)
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

| Header                  | Value              | When                                            |
| ----------------------- | ------------------ | ----------------------------------------------- |
| `X-AF-Action`           | ALLOW/BLOCK/REDACT | Always                                          |
| `X-AF-Risk-Score`       | 0-100              | Always                                          |
| `X-AF-Secrets-Count`    | number             | Always                                          |
| `X-AF-PII-Count`        | number             | Always                                          |
| `X-AF-Entropy-Count`    | number             | Always                                          |
| `X-AF-Redacted-Types`   | comma-separated    | When redacted                                   |
| `X-AF-Findings`         | JSON array         | When findings detected (max 20, compact format) |
| `X-AF-Input-Tokens`     | number             | Always (real tiktoken count)                    |
| `X-AF-Estimated-Cost`   | number             | Always (pre-request estimate)                   |
| `X-AF-Token-Method`     | tiktoken/heuristic | Always                                          |
| `X-AF-Context-Overflow` | true               | Only when over model context limit              |
| `X-AF-Context-Tokens`   | number             | Only when overflow                              |
| `X-AF-Context-Max`      | number             | Only when overflow                              |
| `X-AF-Context-Warning`  | string             | Only when overflow (advisory)                   |

### MCP Gateway Headers (on every `/v1/mcp/tools/call` response)

| Header                | Value              | When   |
| --------------------- | ------------------ | ------ |
| `X-AF-MCP-Action`     | ALLOW/BLOCK/REDACT | Always |
| `X-AF-MCP-Risk-Score` | 0-100              | Always |
| `X-AF-MCP-Server`     | server ID          | Always |
| `X-AF-MCP-Tool`       | tool name          | Always |

## API Endpoints

### Core Proxy

| Method | Endpoint               | Description                                                |
| ------ | ---------------------- | ---------------------------------------------------------- |
| POST   | `/v1/chat/completions` | OpenAI-compatible proxy with scanning + token intelligence |
| GET    | `/health`              | Health check                                               |

### Token Intelligence (Phase 1)

| Method | Endpoint        | Description                                                                           |
| ------ | --------------- | ------------------------------------------------------------------------------------- |
| POST   | `/api/estimate` | Pre-flight: real token count, cost estimate, context window utilization, scan preview |

### File Scanning (Phase 2)

| Method | Endpoint                | Description                                                      |
| ------ | ----------------------- | ---------------------------------------------------------------- |
| POST   | `/api/scan/file`        | Scan a single file (with content-addressed cache)                |
| POST   | `/api/scan/batch`       | Scan multiple files (max 50, returns per-file results + summary) |
| DELETE | `/api/scan/cache`       | Clear scan cache (optional `filePath` query filter)              |
| GET    | `/api/scan/cache/stats` | Cache statistics (total entries, total size)                     |

### Rule File Scanning (Phase 6)

| Method | Endpoint                    | Description                                                     |
| ------ | --------------------------- | --------------------------------------------------------------- |
| POST   | `/api/scan/rules`           | Scan provided rule file content (injection + secrets + unicode) |
| POST   | `/api/scan/rules/directory` | Scan all known rule files in a workspace directory              |

### MCP Security Gateway (Phase 3)

| Method | Endpoint              | Description                                           |
| ------ | --------------------- | ----------------------------------------------------- |
| POST   | `/v1/mcp/tools/call`  | Scan tool inputs, forward to MCP server, scan outputs |
| POST   | `/v1/mcp/scan`        | Standalone text scan for MCP context                  |
| GET    | `/v1/mcp/audit`       | Query MCP audit log (filter by server, action, limit) |
| GET    | `/v1/mcp/audit/stats` | Aggregate MCP tool call stats                         |

### Control Plane — Approvals (Phase 4)

| Method | Endpoint                     | Description                                                    |
| ------ | ---------------------------- | -------------------------------------------------------------- |
| GET    | `/api/approvals/pending`     | List pending approvals for user                                |
| POST   | `/api/approvals/:id/resolve` | Respond to approval (allow_once/allow_always/deny/deny_always) |
| GET    | `/api/approvals/history`     | Past approval decisions for audit                              |
| GET    | `/api/approvals/rules`       | Remembered "Allow Always" / "Deny Always" rules                |
| DELETE | `/api/approvals/rules/:id`   | Revoke a remembered rule                                       |

### Control Plane — Sessions (Phase 4)

| Method | Endpoint               | Description                        |
| ------ | ---------------------- | ---------------------------------- |
| GET    | `/api/sessions/active` | Active sessions across all devices |
| GET    | `/api/sessions/:id`    | Get specific session details       |

### Control Plane — Notifications (Phase 4)

| Method | Endpoint                          | Description                                              |
| ------ | --------------------------------- | -------------------------------------------------------- |
| GET    | `/api/notifications/channels`     | List configured notification channels                    |
| POST   | `/api/notifications/channels`     | Configure a new channel (webhook, slack, email, webpush) |
| DELETE | `/api/notifications/channels/:id` | Remove a channel                                         |
| POST   | `/api/notifications/test`         | Send test notification to all channels                   |

### Task Framework (Agent Core Phase 1)

| Method | Endpoint                  | Description                                        |
| ------ | ------------------------- | -------------------------------------------------- |
| GET    | `/api/tasks`              | List tasks (filter by status, type)                |
| POST   | `/api/tasks`              | Create a new task (7 types)                        |
| GET    | `/api/tasks/:id`          | Get task details + progress                        |
| PATCH  | `/api/tasks/:id`          | Update task status (state machine enforced)        |
| DELETE | `/api/tasks/:id`          | Kill a running task                                |
| POST   | `/api/tasks/:id/progress` | Report progress (toolUseCount, tokens, activities) |
| POST   | `/api/tasks/:id/ack`      | Acknowledge a completed/failed task                |
| POST   | `/api/tasks/kill-all`     | Kill all running tasks for user                    |

### Memory System (Agent Core Phase 1)

| Method | Endpoint                | Description                                           |
| ------ | ----------------------- | ----------------------------------------------------- |
| GET    | `/api/memory`           | List memories (filter by type)                        |
| POST   | `/api/memory`           | Create a new memory (user/feedback/project/reference) |
| GET    | `/api/memory/:fileName` | Read a single memory file                             |
| DELETE | `/api/memory/:fileName` | Delete a memory + remove index entry                  |
| GET    | `/api/memory/index`     | Read MEMORY.md index                                  |
| PUT    | `/api/memory/index`     | Update MEMORY.md index                                |
| POST   | `/api/memory/extract`   | Auto-extract memories from conversation text          |

### Agent Service (Agent Core Phase 1)

| Method | Endpoint                      | Description                                          |
| ------ | ----------------------------- | ---------------------------------------------------- |
| POST   | `/api/agents/spawn`           | Spawn a sub-agent (with optional worktree isolation) |
| GET    | `/api/agents`                 | List active agents                                   |
| DELETE | `/api/agents/:taskId`         | Kill a specific agent                                |
| POST   | `/api/agents/:taskId/message` | Send message to an agent                             |

### Command System (Phase 2)

| Method | Endpoint                | Description                                                                                   |
| ------ | ----------------------- | --------------------------------------------------------------------------------------------- |
| GET    | `/api/commands`         | List all available commands (built-in + loaded)                                               |
| POST   | `/api/commands/execute` | Execute a slash command. Body: `{"input": "/doctor", "model?": "...", "projectPath?": "..."}` |

### Skills System (Phase 2)

| Method | Endpoint             | Description                                      |
| ------ | -------------------- | ------------------------------------------------ |
| GET    | `/api/skills`        | List all available skills (bundled + discovered) |
| POST   | `/api/skills/invoke` | Invoke a skill by name with args                 |

### Cron Service (Phase 3)

| Method | Endpoint                | Description          |
| ------ | ----------------------- | -------------------- |
| POST   | `/api/cron`             | Create a cron job    |
| GET    | `/api/cron`             | List cron jobs       |
| GET    | `/api/cron/:id`         | Get cron job details |
| POST   | `/api/cron/:id/enable`  | Enable a cron job    |
| POST   | `/api/cron/:id/disable` | Disable a cron job   |
| DELETE | `/api/cron/:id`         | Delete a cron job    |

### RAG Scanning (Advanced)

| Method | Endpoint                 | Description                                    |
| ------ | ------------------------ | ---------------------------------------------- |
| POST   | `/api/scan/rag/chunk`    | Scan a single RAG chunk for hidden injections  |
| POST   | `/api/scan/rag/document` | Scan a full document (auto-splits into chunks) |

### Hallucination Grounding (Advanced)

| Method | Endpoint                | Description                                     |
| ------ | ----------------------- | ----------------------------------------------- |
| POST   | `/api/grounding/check`  | Check output grounding against source documents |
| POST   | `/api/grounding/claims` | Extract individual claims from text             |

### Multi-Turn Tracking (Advanced)

| Method | Endpoint                          | Description                        |
| ------ | --------------------------------- | ---------------------------------- |
| POST   | `/api/scan/multi-turn`            | Record a turn and get session risk |
| GET    | `/api/scan/multi-turn/:sessionId` | Get current session risk           |
| DELETE | `/api/scan/multi-turn/expired`    | Clean expired sessions             |

### Federated Threat Intelligence (Advanced)

| Method | Endpoint                       | Description                            |
| ------ | ------------------------------ | -------------------------------------- |
| POST   | `/api/intelligence/signatures` | Publish a privacy-preserving signature |
| POST   | `/api/intelligence/query`      | Query matching attack signatures       |
| GET    | `/api/intelligence/stats`      | Get signature store statistics         |

### Compliance (Advanced)

| Method | Endpoint                      | Description                          |
| ------ | ----------------------------- | ------------------------------------ |
| POST   | `/api/compliance/map`         | Map security event to regulations    |
| POST   | `/api/compliance/evidence`    | Generate compliance evidence package |
| GET    | `/api/compliance/regulations` | List supported regulations           |

### Red Team Agent (Advanced)

| Method | Endpoint                | Description                     |
| ------ | ----------------------- | ------------------------------- |
| POST   | `/api/redteam/probes`   | Generate adversarial probes     |
| POST   | `/api/redteam/evaluate` | Evaluate response vulnerability |
| GET    | `/api/redteam/library`  | Get probe library categories    |

### Shadow AI Detection (Advanced)

| Method | Endpoint                 | Description                     |
| ------ | ------------------------ | ------------------------------- |
| POST   | `/api/network/analyze`   | Analyze request for shadow AI   |
| POST   | `/api/network/approved`  | Register approved LLM endpoints |
| GET    | `/api/network/stats`     | Get detection statistics        |
| GET    | `/api/network/endpoints` | List known LLM endpoints        |

### Business Logic DSL (Advanced)

| Method | Endpoint                     | Description                    |
| ------ | ---------------------------- | ------------------------------ |
| POST   | `/api/policy/rules/parse`    | Parse business logic rules     |
| POST   | `/api/policy/rules/evaluate` | Evaluate rules against context |
| POST   | `/api/policy/rules/validate` | Validate a single rule         |

### Embedding ML Detection (Advanced)

| Method | Endpoint         | Description                          |
| ------ | ---------------- | ------------------------------------ |
| POST   | `/api/ml/detect` | Detect injection via embedding model |
| POST   | `/api/ml/train`  | Add training examples                |
| GET    | `/api/ml/stats`  | Get model statistics                 |

### Multi-Modal Scanning (Advanced)

| Method | Endpoint                     | Description                  |
| ------ | ---------------------------- | ---------------------------- |
| POST   | `/api/scan/multimodal/image` | Scan OCR text from image     |
| POST   | `/api/scan/multimodal/audio` | Scan audio transcript        |
| POST   | `/api/scan/multimodal/file`  | Scan structured file content |

### Auth, Policy, Gateway, Org (existing)

| Method   | Endpoint                                  | Description                   |
| -------- | ----------------------------------------- | ----------------------------- |
| POST     | `/api/auth/register`, `/api/auth/login`   | User auth                     |
| GET/PUT  | `/api/policy`                             | Policy CRUD                   |
| POST/GET | `/api/providers`                          | AI provider management (BYOK) |
| POST/GET | `/api/credits`                            | Credit limits                 |
| GET      | `/api/usage/summary`, `/api/usage/recent` | Usage analytics               |
| GET      | `/api/logs`                               | Paginated audit logs          |
| GET      | `/api/stats`                              | Aggregated statistics         |
| POST     | `/api/browser-scan`                       | Browser extension scan        |
| POST     | `/api/permission-check`                   | Interactive permission prompt |
| POST     | `/api/simulate`                           | AI leak simulator             |
| GET/POST | `/api/export/json`, `/api/export/csv`     | Data export                   |

## Database Tables

| Table                   | Phase | Purpose                                                                    |
| ----------------------- | ----- | -------------------------------------------------------------------------- |
| `logs`                  | 1     | Request audit trail (sanitized text, risk scores, actions)                 |
| `organizations`         | 3     | Multi-org support                                                          |
| `users`                 | 3     | Auth + RBAC (4 roles: admin, security_lead, developer, auditor)            |
| `api_tokens`            | 3     | Bearer token auth (SHA-256 hashed, never raw)                              |
| `providers`             | 4     | BYOK AI providers (API keys AES-256-GCM encrypted)                         |
| `models`                | 4     | Model registry per provider (pricing, context window)                      |
| `credits`               | 4     | Credit limits (requests/tokens/dollars, auto-reset)                        |
| `usage_logs`            | 4     | Per-request token + cost tracking                                          |
| `admin_audit`           | —     | Admin action audit trail                                                   |
| `audit_queue`           | —     | Privacy review queue (BlindMI)                                             |
| `sso_sessions`          | 7     | SSO provider sessions (encrypted tokens)                                   |
| `webhooks`              | 7     | Webhook registrations per org                                              |
| `org_model_rules`       | 7     | Model allowlist/denylist per org                                           |
| `rate_limits`           | 7     | Per-user/org rate limits (schema only — enforcement in Phase 5)            |
| `file_scan_cache`       | P2    | Content-addressed file scan cache (UNIQUE on path+hash)                    |
| `mcp_audit`             | P3    | MCP tool call audit log (server, tool, direction, action, risk)            |
| `approval_requests`     | P4    | Human-in-the-loop approval workflow (pending/approved/denied/expired)      |
| `approval_rules`        | P4    | Remembered decisions ("Allow Always" / "Deny Always" per resource pattern) |
| `notification_channels` | P4    | Pluggable notification configs (webpush, slack, email, webhook)            |
| `webpush_subscriptions` | P4    | Web Push API subscription endpoints                                        |
| `active_sessions`       | P4    | Cross-device session tracking (device, model, last activity)               |
| `webhook_deliveries`    | P5    | Stripe-pattern delivery queue (status, attempts, retry, dead letter)       |
| `tasks`                 | AC1   | Agent task tracking (7 types, state machine, progress, WebSocket events)   |

## Shared Packages

### @ai-firewall/scanner (`packages/scanner/`)

Pure-function security scanners extracted for reuse across proxy, MCP servers, CLI tools, and tests.

**Exports:**

- `normalizeUnicode(text)` — Strip zero-width chars, map confusable Cyrillic/Greek to Latin, remove bidi overrides (ASI04 defense)
- `scanSecrets(text)` — 12 secret patterns (AWS, private key, JWT, DB URL, GitHub token, etc.)
- `scanPII(text)` — 7 PII patterns (email, phone, SSN, Aadhaar, PAN, credit card, IP)
- `scanEntropy(text)` — Shannon entropy analysis with context keyword detection
- `scanPromptInjection(text, threshold?)` — 23 injection/jailbreak pattern categories (13 original + 10 indirect injection)
- `adjustSeverity(value, type, severity, filePaths?)` — Path-aware severity adjustment
- Types: `Severity`, `SecretMatch`, `PiiMatch`, `SecretScanResult`, `PiiScanResult`, `PromptInjectionResult`, `ScanPipelineResult`, `UnicodeNormalizerResult`, `UnicodeAnomaly`

**Usage:**

```typescript
import {
  scanSecrets,
  scanPII,
  scanPromptInjection,
} from "@ai-firewall/scanner";

const secrets = scanSecrets("AKIAIOSFODNN7EXAMPLE");
const pii = scanPII("admin@example.com");
const injection = scanPromptInjection("Ignore all previous instructions");
```

All proxy scanner files (`proxy/src/scanner/*.ts`) re-export from this package for backward compatibility.

## Module Responsibilities (SOLID)

| Module                       | SRP (does ONE thing)                                                               | Location                            |
| ---------------------------- | ---------------------------------------------------------------------------------- | ----------------------------------- |
| `tokenCounter.ts`            | Counts tokens via tiktoken with heuristic fallback                                 | `proxy/src/gateway/`                |
| `contextWindow.ts`           | Checks if messages fit context window (advisory only)                              | `proxy/src/gateway/`                |
| `costEstimator.ts`           | Estimates request cost from tokens + model pricing                                 | `proxy/src/gateway/`                |
| `chatSchemas.ts`             | Validates chat input via Zod (strict roles, multimodal)                            | `proxy/src/schemas/`                |
| `unicodeNormalizer.ts`       | Strip zero-width chars, confusable mapping, bidi removal (ASI04)                   | `packages/scanner/src/`             |
| `ruleFileScanService.ts`     | Scans IDE rule files for injection/secrets/unicode anomalies                       | `proxy/src/scanner/`                |
| `responseScanner.ts`         | Scans LLM responses for leaked secrets/PII (LLM05)                                 | `proxy/src/middleware/`             |
| `fileScanService.ts`         | Orchestrates scanner pipeline for files                                            | `proxy/src/scanner/`                |
| `fileScanCache.ts`           | Cache read/write/invalidate for file scans                                         | `proxy/src/scanner/`                |
| `fileScanProxy.ts`           | Calls proxy `/api/scan/file` before reads (fail-open, 5s timeout)                  | `core/util/`                        |
| `ScanBanner.tsx`             | CLI scan result display with red-highlighted findings                              | `extensions/cli/src/ui/`            |
| `ScanResultBanner.tsx`       | GUI scan result display with red-highlighted findings                              | `gui/src/components/security/`      |
| `mcpScanPipeline.ts`         | Scans MCP tool I/O text through scanner pipeline                                   | `proxy/src/mcp/`                    |
| `mcpAuditLogger.ts`          | Writes/reads MCP audit log entries                                                 | `proxy/src/mcp/`                    |
| `mcpGateway.route.ts`        | HTTP route handling for MCP gateway (delegates to pipeline + logger)               | `proxy/src/routes/`                 |
| `smartRouter.ts`             | Risk-based + cost-aware model routing                                              | `proxy/src/router/`                 |
| `wsManager.ts`               | WebSocket connection lifecycle + message delivery (heartbeat, ping/pong)           | `proxy/src/ws/`                     |
| `approvalService.ts`         | Approval workflow (create, wait, resolve, timeout, remembered rules)               | `proxy/src/services/`               |
| `sessionTracker.ts`          | Active session lifecycle (start, end, touch, query, cleanup stale)                 | `proxy/src/services/`               |
| `notificationService.ts`     | Pluggable notification dispatch (fan out to channels via interface)                | `proxy/src/notifications/`          |
| `webhook.ts` (channel)       | Webhook notification channel (POST to any URL with JSON payload)                   | `proxy/src/notifications/channels/` |
| `cacheAdapter.ts`            | Cache interface + factory (ISP: get/set/del/incr only)                             | `proxy/src/cache/`                  |
| `memoryAdapter.ts`           | In-memory cache with TTL (default, zero deps)                                      | `proxy/src/cache/`                  |
| `valkeyAdapter.ts`           | Valkey/Redis cache via ioredis (optional)                                          | `proxy/src/cache/`                  |
| `licenseVerifier.ts`         | Ed25519 offline license key verification                                           | `proxy/src/license/`                |
| `featureGuard.ts`            | Fastify preHandler for license feature gating                                      | `proxy/src/license/`                |
| `webhookQueue.ts`            | Stripe-pattern delivery queue (6 retries, HMAC, idempotency)                       | `proxy/src/services/`               |
| `taskTypes.ts`               | Task type definitions + valid state transitions                                    | `proxy/src/tasks/`                  |
| `taskFramework.ts`           | Task lifecycle management (create, validate, transition, progress)                 | `proxy/src/tasks/`                  |
| `taskService.ts`             | Task CRUD service (DB operations, event emission)                                  | `proxy/src/services/`               |
| `memoryTypes.ts`             | Memory type definitions (user/feedback/project/reference)                          | `proxy/src/memory/`                 |
| `memdir.ts`                  | File-based memory storage + MEMORY.md index management                             | `proxy/src/memory/`                 |
| `memoryExtractor.ts`         | Auto-extract memories from conversation text                                       | `proxy/src/memory/`                 |
| `memoryService.ts`           | Memory CRUD service (delegates to memdir)                                          | `proxy/src/services/`               |
| `toolPermissions.ts` (core)  | Permission rules, pattern matching, dangerous file/command detection               | `core/tools/`                       |
| `toolPermissions.ts` (proxy) | Proxy-side tool permission enforcement                                             | `proxy/src/permissions/`            |
| `toolRegistry.ts`            | Tool registry with deduplication and search                                        | `core/tools/`                       |
| `agentService.ts`            | Sub-agent spawn, kill, worktree isolation, messaging                               | `proxy/src/services/`               |
| `compactService.ts`          | Conversation compaction (3 strategies: clear tool results, summarize, drop oldest) | `proxy/src/services/`               |
| `commandTypes.ts`            | Command type definitions                                                           | `proxy/src/commands/`               |
| `commandLoader.ts`           | Discover + load commands (built-in + external)                                     | `proxy/src/commands/`               |
| `builtinCommands.ts`         | 11 built-in slash commands (/doctor, /compact, /cost, /diff, etc.)                 | `proxy/src/commands/`               |
| `skillTypes.ts`              | Skill type definitions + SKILL.md frontmatter schema                               | `proxy/src/skills/`                 |
| `skillLoader.ts`             | Discover + load skills from SKILL.md files                                         | `proxy/src/skills/`                 |
| `pluginTypes.ts`             | Plugin manifest + lifecycle type definitions                                       | `proxy/src/plugins/`                |
| `pluginLoader.ts`            | Plugin discover, load, enable/disable lifecycle                                    | `proxy/src/plugins/`                |
| `hookService.ts`             | Shell command hooks on 13 event types (variable expansion, safe env)               | `proxy/src/services/`               |
| `CoordinatorView.tsx`        | Multi-agent dashboard with worker pool status                                      | `gui/src/components/agents/`        |
| `AgentWizard.tsx`            | 4-step agent creation wizard (info, model, tools, review+launch)                   | `gui/src/components/agents/`        |
| `OnboardingWizard.tsx`       | 5-step first-run setup wizard                                                      | `gui/src/components/onboarding/`    |
| `useCostTracker.ts`          | Real-time cost polling hook                                                        | `gui/src/hooks/`                    |
| `costTracker.ts`             | In-memory session-level cost tracking with per-model breakdown                     | `proxy/src/gateway/`                |
| `cronService.ts`             | Cron job scheduling (polling, Nm/Nh/Nd format, enable/disable)                     | `proxy/src/services/`               |
| `featureFlagService.ts`      | Feature flags with hash-based rollout + include/exclude lists                      | `proxy/src/services/`               |
| `cronAndFlags.test.ts`       | Tests for cost tracker, feature flags, cron, hooks                                 | `proxy/src/test/`                   |
| `multiTurnTracker.ts`        | Multi-turn attack memory (session state, escalation/pivot/repetition detection)    | `proxy/src/scanner/`                |
| `ragScanner.ts`              | RAG injection shield (17 patterns, document/chunk scanning)                        | `proxy/src/scanner/`                |
| `intentCluster.ts`           | Semantic intent clustering (SimHash, coordinated attack detection)                 | `proxy/src/scanner/`                |
| `behaviorFingerprint.ts`     | Per-user behavioral profiling (z-score anomaly, vocabulary diversity)              | `proxy/src/scanner/`                |
| `promptConfidentiality.ts`   | Prompt extraction shield (22 weighted patterns, system prompt protection)          | `proxy/src/scanner/`                |
| `crossModelCorrelation.ts`   | Cross-model attack correlation (incident grouping, severity escalation)            | `proxy/src/scanner/`                |
| `multiModalScanner.ts`       | Multi-modal threat scanning (image OCR, audio transcript, structured files)        | `proxy/src/scanner/`                |
| `groundingEngine.ts`         | Hallucination grounding (claim extraction, 4-component source matching)            | `proxy/src/scanner/`                |
| `embeddingDetector.ts`       | Embedding-based injection detector (60-dim features, KNN + centroid)               | `proxy/src/ml/`                     |
| `federatedIntel.ts`          | Privacy-preserving federated threat intelligence (LSH, MinHash, 8 bands)           | `proxy/src/intelligence/`           |
| `supplyChain.ts`             | LLM supply chain integrity (hash verify, backdoor scan, drift detection)           | `proxy/src/intelligence/`           |
| `complianceMapper.ts`        | Regulatory compliance mapping (6 regulations, 31 articles, evidence packages)      | `proxy/src/compliance/`             |
| `businessLogicDsl.ts`        | Business logic policy DSL (9 operators, AND/OR/NOT, 5 actions, priority ordering)  | `proxy/src/policy/`                 |
| `redTeamAgent.ts`            | Continuous red team agent (62 probes, 10 categories, vulnerability detection)      | `proxy/src/agents/`                 |
| `shadowAiDetector.ts`        | Shadow AI discovery (32 known LLM endpoints, heuristic detection)                  | `proxy/src/network/`                |
| `piiVault.ts`                | Reversible PII tokenization (HMAC-SHA256, session-scoped, zero-knowledge)          | `proxy/src/redactor/`               |
| `advancedScanners.test.ts`   | Tests for 8 advanced scanner modules (55 tests)                                    | `proxy/src/test/`                   |
| `advancedFeatures.test.ts`   | Tests for 8 advanced feature modules (63 tests)                                    | `proxy/src/test/`                   |

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
- New slash commands go in `proxy/src/commands/builtinCommands.ts` (or as external command files)
- New skills go in `proxy/src/skills/bundled/` as SKILL.md files with YAML frontmatter
- New plugins go in `proxy/src/plugins/bundled/` with a `plugin.json` manifest
- Hook event types defined in `proxy/src/services/hookService.ts` — add new types there
- Memory files stored in `proxy/data/projects/<project>/memory/` — never write to arbitrary paths
- Task state transitions enforced by state machine in `taskFramework.ts` — do not bypass
- `proxy/data/` contains runtime data (memory files, SQLite DB) — always in `.gitignore`
- New advanced scanners go in `proxy/src/scanner/` (multi-turn, RAG, intent, behavior, grounding, etc.)
- ML-based detectors go in `proxy/src/ml/` — must work without external model dependencies
- Threat intelligence modules go in `proxy/src/intelligence/` — always privacy-preserving (hash/LSH, never raw data)
- Compliance modules go in `proxy/src/compliance/` — map events to specific regulatory articles
- Red team probes go in `proxy/src/agents/redTeamAgent.ts` — add new categories/templates there
- Network detection patterns go in `proxy/src/network/shadowAiDetector.ts` — add new LLM endpoints there
- Business logic rules use `proxy/src/policy/businessLogicDsl.ts` — 9 condition operators, 5 actions
- PII vault sessions are ephemeral — never persist token mappings to disk or DB

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
- Write memory files outside `proxy/data/projects/` — all memory is scoped to project directories
- Bypass task state machine — always use `taskFramework.ts` for state transitions
- Skip tool permission checks — all tool calls must pass through the 3-level permission chain
- Run hook commands without safe environment — always use `hookService.ts` which sanitizes env vars
- Commit `proxy/data/` — it contains runtime state (SQLite DB, memory files) and is gitignored
