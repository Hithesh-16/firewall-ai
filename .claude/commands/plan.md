---
description: Analyze requirements, identify risks, and create step-by-step implementation plan across the AI Firewall monorepo. WAIT for user CONFIRM before writing code.
---

# Plan Command

1. **Restate Requirements** — Clarify what needs to be built
2. **Identify Affected Packages** — Which of proxy/, core/, gui/, extensions/, packages/ are involved?
3. **Map the Security Impact** — Does this change affect the scanner pipeline, policy engine, or vault?
4. **Create Step Plan** — Break down into phases with specific files and packages
5. **Assess Risks** — Surface potential issues (security, breaking changes, cross-package deps)
6. **Wait for Confirmation** — MUST receive user approval before proceeding

## AI Firewall-Specific Planning

When planning, always consider:
- Does the feature need proxy-side scanning? (new scanner pattern, policy rule)
- Does it need a new API endpoint? (proxy/src/routes/)
- Does it need GUI changes? (gui/src/pages/)
- Does it need core agent changes? (core/tools/, core/context/)
- Does it affect the extension? (extensions/vscode/)
- What's the build order? (packages -> core -> proxy -> gui -> extensions)

## After Planning

- Use `/tdd` to implement with test-driven development
- Use `/build-fix` if build errors occur
- Use `/code-review` to review completed implementation
