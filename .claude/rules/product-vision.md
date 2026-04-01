---
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.json"
---
# Product Vision — Secure AI OS

## What We're Building

AI Firewall is evolving from a security proxy into a **Secure AI OS** — a multi-device AI runtime with built-in firewall, token intelligence, MCP tool ecosystem, and controlled automation.

**One-liner:** "A multi-device AI runtime with built-in security firewall, tool ecosystem, and controlled automation."

## Core Principles (NON-NEGOTIABLE)

1. **Everything goes through firewall** — No direct LLM calls, no tool execution without scan, no file access without permission
2. **Local-first + permission-first** — Default: block sensitive data. Always ask user for restricted files, mask PII, log all actions
3. **Continue.dev remains intact** — We ONLY add: `Continue.dev -> Firewall Adapter Layer -> Proxy`
4. **Token optimization before spend** — Every byte scanned BEFORE considered for LLM context, every token justified before spent
5. **Tool-first AI** — If a tool can solve it, DO NOT call LLM. Prefer grep over full read, summary over raw data

## Evolution History

1. **v2.0.0 (Standalone)** — Custom proxy + dashboard + browser ext + CLI + Docker (4 LLM providers)
2. **v2.5 (Continue White-Label)** — Merged into Continue.dev monorepo (gained 60+ providers, 26 tools, MCP client)
3. **v3.0 (Secure AI OS)** — Current target: token intelligence, MCP servers, context reduction, multi-device

## What EXISTS (Don't Rebuild)

- Proxy: 20 routes, 6 scanners, policy engine, vault, auth+SSO, SQLite (19 tables)
- Core: 60+ LLM providers, 26 tools, 40+ context providers, MCP CLIENT (production-grade)
- GUI: React+Redux, 8 pages, 44+ components
- Extensions: VS Code (production), CLI (beta), JetBrains (alpha)
- Token counting: tiktoken + llama tokenizer in `core/llm/countTokens.ts`
- Cost tracking: usage logs, credit limits in proxy gateway services
- Plan/Memory/Worktree tools in `core/tools/implementations/`

## What NEEDS Building

- Token Intelligence Engine (proxy estimate is naive `length/4`)
- Context Reduction Pipeline (grep + AST + window reducer)
- Cost-aware model routing (currently risk-only)
- Custom MCP Servers (Gmail, WhatsApp, Filesystem, Terminal, API)
- File Service (upload/index/summarize)
- Rate limit + permission ENFORCEMENT (schemas exist, middleware doesn't)
- Docker/K8s, PostgreSQL migration, Redis caching (enterprise)
- Mobile app + smartwatch (control/approval layer)

## Competitive Moat

1. Firewall-first: scan BEFORE send (no competitor does this)
2. Token optimization: reduce BEFORE spending (Cursor/Copilot send full files)
3. 60+ providers vs locked ecosystems
4. Local-first with Ollama (full offline capability)
5. Cost transparency with credit limits
6. Open source + extensible via MCP
