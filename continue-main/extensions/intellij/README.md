# AI Firewall — JetBrains Plugin

AI-powered code agent for IntelliJ-based IDEs with built-in security scanning.

## Features

- Chat with AI models directly in your IDE
- Tab autocomplete with inline suggestions
- Inline code editing
- 60+ LLM provider support
- Automatic security scanning through the AI Firewall proxy
- Secret and PII detection on every request

## Installation

Build the plugin from source:

```bash
cd extensions/intellij
./gradlew buildPlugin
```

The plugin ZIP will be in `build/distributions/`.

Install in IntelliJ: `Settings` > `Plugins` > `Install Plugin from Disk`

## Configuration

The plugin uses the same configuration as the VS Code extension. Configure models in your AI Firewall config file or register providers through the proxy API.

## Security Proxy

Ensure the AI Firewall proxy is running on `localhost:8080` for security scanning. All requests are automatically routed through it.

## License

Apache 2.0
