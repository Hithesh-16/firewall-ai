<p align="center">
  <strong>AI Firewall</strong><br/>
  The open-source AI code agent with built-in security scanning, policy enforcement, and enterprise controls.
</p>

<p align="center">
  <a href="#quickstart">Quickstart</a> &middot;
  <a href="#features">Features</a> &middot;
  <a href="#architecture">Architecture</a> &middot;
  <a href="LOCAL_SETUP.md">Local Setup</a> &middot;
  <a href="CONTRIBUTING.md">Contributing</a>
</p>

---

## What is AI Firewall?

AI Firewall is an AI-powered code assistant that scans every request for secrets, PII, and prompt injection attacks before it reaches any AI provider. It combines the full capabilities of an AI coding agent (chat, autocomplete, inline edit, terminal, codebase indexing) with an enterprise-grade security proxy that enforces organization policies in real time.

**Every token is scanned. Every risk is scored. Every decision is logged.**

---

## Quickstart

### Prerequisites

- **Node.js** >= 20.19.0 (`node --version`)
- **npm** >= 10.x
- **Python** 3.9 - 3.11 (for native modules; macOS users: `/usr/bin/python3`)
- **VS Code** >= 1.70.0
- **Git**

### Install & Run

```bash
# 1. Clone
git clone https://github.com/ai-firewall/ai-firewall.git
cd ai-firewall

# 2. Install root dependencies
npm install

# 3. Build shared packages
node scripts/build-packages.js

# 4. Install core + link
cd core && PUPPETEER_SKIP_DOWNLOAD=true npm install && npm link && cd ..

# 5. Install GUI + build
cd gui && npm install && npm link @continuedev/core
NODE_OPTIONS="--max-old-space-size=4096" npm run build && cd ..

# 6. Install + package VS Code extension
cd extensions/vscode && npm install && npm link @continuedev/core
npm run package && cd ../..

# 7. Install the extension
code --install-extension extensions/vscode/build/ai-firewall-*.vsix

# 8. Install + start the security proxy
cd proxy && npm install && npm run build
node dist/server.js  # Runs on http://localhost:8080
```

Reload VS Code (`Cmd+Shift+P` > "Developer: Reload Window"). The AI Firewall panel appears in the sidebar.

> **macOS Python fix**: If `sqlite3` fails to build, set `npm_config_python=/usr/bin/python3` before `npm install` commands.

---

## Features

### AI Code Agent
| Feature | Description |
|---|---|
| **Chat** | Conversational AI with full tool use (read/write files, terminal, search) |
| **Tab Autocomplete** | Ghost text inline completions as you type |
| **Inline Edit** | Modify code in-place without leaving the editor |
| **Next Edit Prediction** | Predicts your next edit based on context |
| **Codebase Indexing** | Vector + full-text search over your entire codebase (LanceDB) |
| **30+ Context Providers** | @file, @diff, @git, @web, @docs, @terminal, @codebase, and more |
| **26 Built-in Tools** | read_file, edit_file, grep_search, run_terminal_command, create_plan, save_memory, etc. |
| **60+ LLM Providers** | OpenAI, Anthropic, Gemini, Ollama, Azure, AWS Bedrock, Groq, Mistral, and 50+ more |
| **MCP Support** | Connect to any Model Context Protocol server (stdio, ws, sse, http) |
| **Slash Commands** | /commit, /review, /cmd, /share, custom commands |
| **Config Profiles** | YAML/JSON config with per-project and per-org profiles |
| **CLI Agent** | Full TUI terminal agent (`cn` command) |

### Security Proxy (Port 8080)
| Feature | Description |
|---|---|
| **Secret Scanning** | 13 pattern types: AWS keys, private keys, JWTs, database URLs, GitHub tokens, etc. |
| **PII Detection** | 7 types: email, phone, SSN, credit card, IP address, Aadhaar, PAN |
| **Prompt Injection Detection** | 13 attack patterns with weighted scoring |
| **Entropy Analysis** | Detects high-entropy strings (likely encoded secrets) |
| **Policy Engine** | BLOCK / REDACT / ALLOW decisions with configurable severity thresholds |
| **Risk Scoring** | 0-100 risk score per request |
| **Redaction** | Replace sensitive values with `[REDACTED_TYPE]` tokens before sending |
| **File Scope** | Block/allow specific file paths from being sent to AI |
| **Token Vault** | AES-256-GCM encrypted API key storage |
| **Multi-Provider Gateway** | Route to OpenAI, Anthropic, Gemini, Ollama with auto format conversion |
| **Credit/Budget Limits** | Per-provider token/cost/request caps with daily/weekly/monthly reset |
| **Usage Tracking** | Per-model, per-user token and cost tracking |
| **Audit Trail** | Every request logged with scan results, risk score, and decision |
| **Compliance Export** | JSON, CSV, and compliance summary report generation |

### Enterprise Features
| Feature | Description |
|---|---|
| **Organization Management** | Create orgs, assign users, manage teams |
| **Role-Based Access** | 4 roles: admin, security_lead, developer, auditor |
| **SSO/OIDC** | Google, GitHub, Microsoft, generic OIDC authentication |
| **Webhook Notifications** | Alerts on policy violations, credit exhaustion |
| **Model Allow/Denylist** | Per-org control over which models developers can use |
| **Rate Limiting** | Per-user requests/minute and tokens/minute caps |
| **Scheduled Reports** | Auto-generated weekly security compliance reports |
| **Team Dashboard** | Org-wide usage, risks, and security score |
| **Project Instructions** | `.aifirewall.md` file auto-loaded as agent context |
| **Persistent Memory** | Agent remembers user preferences, project context across sessions |
| **Hooks System** | Pre/post tool call hooks (auto-format, approval workflows) |
| **Worktree Isolation** | Run agent experiments in isolated git worktrees |

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                VS Code Extension / CLI                   │
│  Chat | Autocomplete | Inline Edit | Terminal | MCP      │
│                    | apiBase                              │
├─────────────────────────────────────────────────────────┤
│              AI Firewall Proxy (:8080)                   │
│  Secret Scanner -> PII Scanner -> Injection Scanner      │
│  -> Policy Engine (BLOCK/REDACT/ALLOW)                   │
│  -> Gateway Router -> Provider Adapters                  │
│  -> Usage Tracking -> Audit Log -> Token Vault           │
├─────────────────────────────────────────────────────────┤
│           AI Providers (OpenAI / Anthropic / ...)        │
└─────────────────────────────────────────────────────────┘
```

### Directory Structure

```
ai-firewall/
├── proxy/                  # Security proxy (Fastify, SQLite)
│   ├── src/routes/         # 20 REST API route files
│   ├── src/scanner/        # Secret, PII, entropy, injection scanners
│   ├── src/policy/         # Policy engine, model policies, org policies
│   ├── src/gateway/        # Multi-provider router + adapters
│   ├── src/auth/           # Auth service, SSO, middleware
│   ├── src/vault/          # AES-256-GCM token vault
│   └── src/db/             # SQLite schema (12 tables)
├── gui/                    # React webview UI (Vite + Tailwind)
│   └── src/pages/          # Chat, Security, Org, Team, Config, History
├── core/                   # Agent engine
│   ├── llm/                # 60+ LLM provider implementations
│   ├── tools/              # 26 built-in tools
│   ├── context/            # 30+ context providers
│   ├── indexing/           # Codebase indexing (LanceDB)
│   └── hooks/              # Pre/post tool call hooks
├── extensions/
│   ├── vscode/             # VS Code extension
│   ├── intellij/           # JetBrains plugin
│   └── cli/                # Terminal agent (TUI)
└── packages/               # Shared packages
```

---

## Configuration

### Policy (`proxy/policy.json`)

```json
{
  "version": "1.2",
  "rules": {
    "block_private_keys": true,
    "block_aws_keys": true,
    "block_db_urls": true,
    "redact_emails": true,
    "redact_phone": true,
    "redact_jwt": true,
    "redact_generic_api_keys": true,
    "log_all_requests": true
  },
  "severity_threshold": "medium",
  "prompt_injection": { "enabled": true, "threshold": 60 }
}
```

### Project Instructions (`.aifirewall.md`)

Create at your project root. Auto-loaded as system context every session:

```markdown
# Project Instructions
- This is a TypeScript monorepo using pnpm workspaces
- Always run tests before committing
- Never modify files in migrations/
```

### Hooks (`.ai-firewall/settings.json`)

```json
{
  "hooks": [
    {
      "event": "post-tool-call",
      "tools": ["edit_existing_file", "create_new_file"],
      "command": "npx prettier --write $TOOL_ARG_FILEPATH",
      "blocking": true
    }
  ]
}
```

### Environment Variables (Proxy)

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8080` | Proxy port |
| `DB_PATH` | `./data/firewall.db` | SQLite database path |
| `MASTER_KEY` | (required) | Vault encryption key |
| `STRICT_LOCAL` | `false` | Block all cloud providers |
| `SSO_PROVIDER` | (none) | `google`, `github`, `microsoft`, or `oidc` |
| `SSO_CLIENT_ID` | (none) | OAuth client ID |
| `SSO_CLIENT_SECRET` | (none) | OAuth client secret |
| `REPORT_INTERVAL_HOURS` | `168` | Weekly compliance reports (0 to disable) |

---

## API Reference (Proxy)

### Core
| Method | Path | Description |
|---|---|---|
| POST | `/v1/chat/completions` | Main AI proxy (scans + routes) |
| GET | `/health` | Health check |

### Security Scanning
| Method | Path | Description |
|---|---|---|
| POST | `/api/browser-scan` | Scan text from browser extension |
| POST | `/api/permission-check` | Pre-flight permission check |
| POST | `/api/estimate` | Cost estimation without sending |
| POST | `/api/simulate` | Scan directory for leaks |

### Auth & SSO
| Method | Path | Description |
|---|---|---|
| POST | `/api/auth/register` | Create user |
| POST | `/api/auth/login` | Authenticate |
| GET | `/api/auth/sso/login` | SSO redirect |
| GET | `/api/auth/sso/callback` | SSO callback |

### Organization & Users
| Method | Path | Description |
|---|---|---|
| POST | `/api/orgs` | Create organization |
| GET | `/api/admin/users` | List all users |
| PUT | `/api/admin/users/:id/role` | Change user role |

### Providers & Models
| Method | Path | Description |
|---|---|---|
| POST | `/api/providers` | Register AI provider |
| GET | `/api/providers` | List providers |
| POST | `/api/providers/:id/models` | Add model to provider |

### Credits & Usage
| Method | Path | Description |
|---|---|---|
| POST | `/api/credits` | Set credit limit |
| GET | `/api/credits/status/:providerId` | Check usage vs limit |
| GET | `/api/usage/summary` | Aggregated usage stats |

### Audit & Compliance
| Method | Path | Description |
|---|---|---|
| GET | `/api/logs` | Paginated audit logs |
| GET | `/api/stats` | Dashboard statistics |
| GET | `/api/export/json` | Export logs as JSON |
| GET | `/api/export/csv` | Export logs as CSV |
| GET | `/api/export/compliance` | Compliance summary report |

### Policy & Webhooks
| Method | Path | Description |
|---|---|---|
| GET | `/api/policy` | Get current policy |
| PUT | `/api/policy` | Update policy |
| POST | `/api/webhooks` | Register webhook |

---

## Scan Response Headers

Every proxied request includes these headers:

| Header | Example | Description |
|---|---|---|
| `X-AF-Action` | `ALLOW` | BLOCK, REDACT, or ALLOW |
| `X-AF-Risk-Score` | `45` | 0-100 risk score |
| `X-AF-Secrets-Count` | `2` | Secrets detected |
| `X-AF-PII-Count` | `1` | PII items detected |
| `X-AF-Redacted-Types` | `EMAIL,API_KEY` | Types that were redacted |
| `X-AF-Tokens-Used` | `1250` | Tokens consumed |
| `X-AF-Cost` | `0.003` | Estimated cost (USD) |

---

## Development

```bash
# Debug mode (VS Code)
# 1. Cmd+Shift+P > Tasks: Run Task > install-all-dependencies
# 2. Run and Debug > Launch extension

# Proxy dev mode (auto-restart)
cd proxy && npm run dev

# Type checks
cd gui && npx tsc --noEmit
npx tsc --project extensions/vscode/tsconfig.json --noEmit
cd proxy && npx tsc --noEmit

# Production builds
cd proxy && npm run build
cd gui && NODE_OPTIONS="--max-old-space-size=4096" npm run build
cd extensions/vscode && npm run package
```

---

## License

Apache 2.0
