---
description: Generate and run end-to-end tests for AI Firewall. Tests the full pipeline: extension -> proxy scanning -> provider routing -> GUI display.
---

# E2E Command

Invokes the **e2e-runner** agent to create and execute Playwright E2E tests.

## Critical Test Journeys

**Security Pipeline (MUST PASS):**
1. Message with AWS key -> proxy BLOCKS
2. Message with email -> proxy REDACTS
3. Clean message -> proxy ALLOWS, routes to provider
4. Blocked request shows warning in GUI

**Multi-Provider Routing:**
1. OpenAI model -> routes correctly
2. Claude model -> routes correctly
3. Local Ollama model -> routes correctly
4. Missing API key -> clear error

**Dashboard:**
1. Security page shows risk scores
2. Logs page shows audit trail
3. Config page allows policy editing

## Running Tests

```bash
npx playwright test                              # All E2E tests
npx playwright test tests/e2e/security.spec.ts   # Security pipeline
npx playwright test --headed                     # See browser
npx playwright test --debug                      # Debug mode
npx playwright show-report                       # View report
```

## After E2E

- Use `/code-review` to verify test quality
- Use `/build-fix` if tests reveal build issues
