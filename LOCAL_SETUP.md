# AI Firewall — Local Setup Guide

## What is AI Firewall?

AI Firewall is a security-first AI code agent that combines a full-featured coding assistant (chat, autocomplete, inline edit, agent mode, 60+ LLM providers) with an enterprise-grade security proxy that scans every request for secrets, PII, and prompt injection attacks.

## Prerequisites

| Requirement | Version    | Check               |
| ----------- | ---------- | ------------------- |
| Node.js     | >= 20.19.0 | `node --version`    |
| npm         | >= 10.x    | `npm --version`     |
| Python      | 3.9 - 3.11 | `python3 --version` |
| VS Code     | >= 1.70.0  | `code --version`    |
| Git         | any        | `git --version`     |

> **macOS users**: If you have Python 3.12+, use `/usr/bin/python3` (system Python 3.9) for native module builds: `npm_config_python=/usr/bin/python3`

## Step-by-Step Installation

### 1. Install root dependencies

```bash
cd ai-firewall   # or wherever you cloned the repo
npm install
```

### 2. Build shared packages

```bash
node scripts/build-packages.js
```

This builds in 3 phases: `config-types` + `terminal-security` → `fetch` + `config-yaml` + `llm-info` → `openai-adapters` + `continue-sdk`

### 3. Install core engine

```bash
cd core
PUPPETEER_SKIP_DOWNLOAD=true npm install
npm link
cd ..
```

### 4. Build the GUI

```bash
cd gui
npm install
npm link @ai-firewall/core
NODE_OPTIONS="--max-old-space-size=4096" npm run build
cd ..
```

### 5. Package the VS Code extension

```bash
cd extensions/vscode
npm install
npm link @ai-firewall/core
npm run package
cd ../..
```

The VSIX will be at `extensions/vscode/build/ai-firewall-{VERSION}.vsix`

### 6. Install into VS Code

```bash
code --install-extension extensions/vscode/build/ai-firewall-*.vsix
```

Then reload VS Code: `Cmd+Shift+P` > "Developer: Reload Window"

### 7. Start the security proxy

```bash
cd proxy
npm install
npm run build
node dist/server.js
```

The proxy starts on `http://localhost:8080`. The VS Code extension will automatically route requests through it.

## Running Options

### Option A: Installed VSIX (Recommended)

After steps 1-7 above, the extension is installed and the proxy is running. Open any project in VS Code and click the AI Firewall icon in the sidebar.

### Option B: Debug Mode (Development)

1. Open the repo in VS Code
2. `Cmd+Shift+P` > `Tasks: Run Task` > `install-all-dependencies`
3. Switch to `Run and Debug` view > Select `Launch extension` > Press Play
4. A new VS Code window opens with the extension in debug mode
5. In a separate terminal: `cd proxy && npm run dev`

### Option C: CLI Agent

```bash
cd extensions/cli
npm install
npm run build
node dist/index.js
```

## Configuring an LLM Provider

After installation, configure a model in your AI Firewall config (YAML):

```yaml
# ~/.ai-firewall/config.yaml
models:
  - name: GPT-4o
    provider: openai
    model: gpt-4o
    apiKey: sk-...
```

Or register a provider via the proxy API (stores key encrypted in vault):

```bash
curl -X POST http://localhost:8080/api/providers \
  -H "Content-Type: application/json" \
  -d '{"name": "OpenAI", "baseUrl": "https://api.openai.com/v1/chat/completions", "apiKey": "sk-..."}'
```

## Proxy Configuration

Copy and edit the environment file:

```bash
cp proxy/.env.example proxy/.env
```

Key settings:

```bash
PORT=8080                     # Proxy port
DB_PATH=./data/firewall.db    # SQLite database
MASTER_KEY=your-secret-key    # Vault encryption key (required for provider key storage)
STRICT_LOCAL=false             # Set true to block all cloud providers
```

## Troubleshooting

### `sqlite3` build fails on macOS

The `node-gyp` build uses Python, and Python 3.12+ removed `distutils`. Fix:

```bash
npm_config_python=/usr/bin/python3 npm install
```

### Extension shows "Error activating"

1. Check the proxy is running: `curl http://localhost:8080/health`
2. Check the output channel: `View` > `Output` > Select "AI Firewall Proxy"
3. Rebuild: `cd extensions/vscode && npm run package`

### Port 8080 already in use

Change the proxy port:

```bash
PORT=9090 node dist/server.js
```

Then update VS Code settings: `aiFirewall.proxyPort: 9090`

## Useful Scripts

```bash
# Type check everything
cd gui && npx tsc --noEmit
npx tsc --project extensions/vscode/tsconfig.json --noEmit
cd proxy && npx tsc --noEmit

# Proxy dev mode (auto-restart on changes)
cd proxy && npm run dev

# Format code
npm run format

# Watch for TypeScript errors
npm run tsc:watch
```
