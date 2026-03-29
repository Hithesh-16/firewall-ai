---
paths:
  - "**/*.ts"
  - "**/*.tsx"
---
# Build Phases — Secure AI OS

## Implementation Order

### Phase 1: Token Intelligence + Firewall Hardening (CURRENT)
- Real token estimation (replace naive `length/4` in proxy with tiktoken)
- Context reduction pipeline (`proxy/src/reducer/` — grep + window + comment strip)
- Cost-aware routing (extend `proxy/src/router/smartRouter.ts`)
- Rate limit enforcement middleware
- Permission enforcement middleware
- Prompt optimizer (intent classification + templates)
- Benchmark system (token savings metrics)
- Token usage dashboard in GUI

### Phase 2: File Service + Secure Reader + CLI
- Secure file reader with per-line scanning
- File service routes (upload/list/read/summarize)
- Tool input/output scanning routes
- CLI agent completion
- Browser extension re-implementation
- Pre-commit hook re-implementation

### Phase 3: MCP Tool Servers
- Firewall-wrapped MCP server base class
- Filesystem, Gmail, WhatsApp, Terminal, API MCP servers
- MCP server registry in proxy
- KEY: MCP CLIENT already exists in `core/context/mcp/MCPConnection.ts` — only build SERVERS

### Phase 4: Mobile + Cross-Device
- React Native mobile app (control/approval only)
- WebSocket approval system
- Cross-device session sync
- Smartwatch companion

### Phase 5: Enterprise Infrastructure
- PostgreSQL migration (adapter pattern, keep SQLite for local)
- Redis caching (rate limits, token validation, SSO state)
- Docker + docker-compose + K8s
- Observability (Prometheus, OpenTelemetry, Grafana)
- Webhook retry, compliance reports, policy inheritance

## Build Order Rule
`packages/ -> core/ -> proxy/ -> gui/ -> extensions/`

## Key Files for Each Phase
- Token counting: `core/llm/countTokens.ts` (reuse, don't rewrite)
- Proxy estimation: `proxy/src/routes/estimate.route.ts` (modify)
- Smart routing: `proxy/src/router/smartRouter.ts` (extend)
- Credit service: `proxy/src/gateway/creditService.ts` (reuse)
- MCP client: `core/context/mcp/MCPConnection.ts` (reuse as-is)
- File scope: `proxy/src/scope/fileScope.ts` (reuse)
- Scanner pipeline: `proxy/src/scanner/` (reuse)
- Database: `proxy/src/db/database.ts` (extend)
