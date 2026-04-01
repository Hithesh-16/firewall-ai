# AI Firewall — VS Code Extension

The AI-powered code agent with built-in security scanning. Every prompt is scanned for secrets, PII, and prompt injection attacks before reaching any AI provider.

## Features

### Agent Mode
Work on complex development tasks with an autonomous AI agent that can read files, write code, run terminal commands, search your codebase, and iterate until the task is complete — all while the security proxy scans every interaction.

### Chat
Ask questions about your code, get explanations, debug issues, and brainstorm solutions. Supports 60+ LLM providers including OpenAI, Anthropic, Gemini, Ollama, and more.

### Inline Edit
Select code and describe changes. The AI modifies your code in-place with a diff view for review.

### Tab Autocomplete
Get intelligent code completions as you type, powered by your configured model.

### Security Dashboard
View real-time scan results, risk scores, and policy decisions directly in the sidebar. Every request shows secrets detected, PII found, risk score (0-100), and action taken (BLOCK / REDACT / ALLOW).

### Organization Settings
Configure providers, manage users and roles, set credit limits, and view audit logs — all from within VS Code.

## Quick Start

1. Install the extension from a `.vsix` file or the marketplace
2. Open the AI Firewall panel in the sidebar (shield icon)
3. Configure your AI provider (Settings > Providers)
4. Start chatting — every request is automatically scanned

## Security Proxy

The extension automatically starts the AI Firewall proxy on port 8080. All LLM requests are routed through it for scanning.

The proxy detects:
- **13 secret types**: AWS keys, private keys, JWTs, database URLs, GitHub tokens, etc.
- **7 PII types**: email, phone, SSN, credit card, IP address
- **13 prompt injection patterns**: instruction override, jailbreak, data exfiltration

## Configuration

Press `Cmd+Shift+P` and search for "AI Firewall" to see all available commands.

Extension settings:
- `aiFirewall.enableTabAutocomplete` — Toggle tab completions
- `aiFirewall.enableNextEdit` — Toggle next edit prediction
- `aiFirewall.enableConsole` — Show console panel for model I/O
- `aiFirewall.proxyPort` — Security proxy port (default: 8080)

## License

Apache 2.0
