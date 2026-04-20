# AI Firewall CLI

The AI Firewall CLI (`cn`) is a terminal-based AI coding agent with built-in security scanning. Every request passes through the security proxy for secret detection, PII scanning, and policy enforcement.

## Installation

### npm (Node.js 20+)

```bash
npm i -g @ai-firewall/cli
```

### From source

```bash
cd extensions/cli
npm install
npm run build
node dist/index.js
```

## Usage

```bash
# Start interactive chat
cn

# One-shot prompt
cn -p "Explain the auth module"

# With specific model
cn --model gpt-4o

# Print mode (non-interactive)
cn --print "List all TODO comments in src/"
```

## Commands

| Command     | Description                    |
| ----------- | ------------------------------ |
| `cn`        | Start interactive chat session |
| `cn login`  | Authenticate with AI Firewall  |
| `cn logout` | Log out                        |
| `cn config` | Open configuration             |

## Features

- Full agentic mode with tool use (file read/write, terminal, search)
- 60+ LLM provider support
- Streaming responses with syntax highlighting
- Session history and persistence
- MCP server integration
- Automatic security scanning through the proxy
- Configurable permission modes

## Security

When the AI Firewall proxy is running on `localhost:8080`, the CLI automatically routes all requests through it. Every prompt is scanned for:

- Secrets (AWS keys, private keys, JWTs, database URLs)
- PII (emails, phone numbers, SSNs, credit cards)
- Prompt injection attacks

## License

Apache 2.0
