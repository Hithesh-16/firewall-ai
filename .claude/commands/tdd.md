---
description: Enforce test-driven development in the AI Firewall monorepo. Scaffold interfaces, generate tests FIRST, then implement minimal code. Ensure 80%+ coverage.
---

# TDD Command

Invokes the **tdd-guide** agent to enforce test-first methodology.

## Workflow

1. **Scaffold Interfaces** — Define types/interfaces first
2. **Generate Tests First** — Write failing tests (RED)
3. **Implement Minimal Code** — Just enough to pass (GREEN)
4. **Refactor** — Improve while keeping tests green
5. **Verify Coverage** — Ensure 80%+ (100% for scanners/policy/vault)

## Test Commands by Package

```bash
cd proxy && npm test          # Scanner, policy, route tests
cd core && npm test           # Tool, context provider tests
cd gui && npm test            # Component tests
npx playwright test           # E2E tests
```

## Coverage Requirements

- **80% minimum** for all code
- **100% required** for:
  - Scanner regex patterns (proxy/src/scanner/)
  - Policy engine logic (proxy/src/policy/)
  - Vault encryption (proxy/src/vault/)
  - Auth middleware (proxy/src/auth/)

## After TDD

- Use `/build-fix` if build errors occur
- Use `/code-review` to review implementation
- Use `/e2e` for integration tests
