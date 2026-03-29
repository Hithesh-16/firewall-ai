---
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.test.ts"
  - "**/*.spec.ts"
---
# Testing Rules — AI Firewall

## Test Requirements by Package

| Package | Test Type | Framework | Must Test |
|---------|-----------|-----------|-----------|
| proxy/src/scanner/ | Unit | vitest/jest | Every regex pattern (positive + negative) |
| proxy/src/policy/ | Unit | vitest/jest | BLOCK, REDACT, ALLOW paths + edge cases |
| proxy/src/routes/ | Integration | Fastify inject | Auth, validation, error responses |
| proxy/src/gateway/ | Unit | vitest/jest | Format conversion accuracy |
| core/tools/ | Unit | vitest/jest | Tool execution + error handling |
| gui/src/ | Component | React Testing Library | User interactions, state changes |

## Scanner-Specific Testing

Every scanner pattern MUST have:
1. **True positive** test — pattern correctly detects the secret/PII
2. **True negative** test — pattern doesn't flag innocuous text
3. **Context test** — pattern respects file context (e.g., .example files)
4. **Edge case** test — boundary values, unicode, partial matches

## E2E Testing

Use Playwright for critical user journeys:
- Security pipeline: secret -> BLOCK, PII -> REDACT, clean -> ALLOW
- Multi-provider routing: OpenAI, Anthropic, Gemini, Ollama adapters
- Dashboard: security page, logs, config, usage

## Coverage Target

- 80% minimum for all packages
- 100% for scanner patterns, policy engine, and vault encryption
