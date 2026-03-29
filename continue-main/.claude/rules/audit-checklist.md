---
paths:
  - "**/*.ts"
  - "**/*.tsx"
---
# Technical Audit Checklist — AI Firewall

## Before Every PR (Quick Check)
- [ ] No hardcoded colors (`text-white`, `#ffffff`, `bg-gray-*` → use theme classes)
- [ ] No silent `catch {}` blocks → always log or handle
- [ ] No `any` types → use `unknown` and narrow
- [ ] Unicode in JSX uses `{"\u23CE"}` not `\u23CE`
- [ ] No duplicate Continue functionality
- [ ] Theme tested in dark + light mode
- [ ] Existing flows not broken
- [ ] New commands registered in commands.ts if referenced

## Security (Every Change)
- [ ] All prompts pass through firewall
- [ ] No raw secrets stored
- [ ] Permission system enforced
- [ ] Error handling logs failures (never silent in security code)

## Architecture (New Features)
- [ ] Single Responsibility — one reason to change per module
- [ ] Open/Closed — new features added without modifying existing code
- [ ] Interfaces defined for cross-module dependencies
- [ ] No god classes (max 400 lines per file, 800 absolute max)

## UI/UX (Every Component)
- [ ] Uses theme-mapped colors: `bg-editor`, `text-foreground`, `text-error`
- [ ] Loading state for async operations
- [ ] Error state with user-friendly message
- [ ] Empty state for lists with no data
- [ ] Back navigation on detail pages
- [ ] Accessible: aria-labels on icon buttons, focus states

## Known Gaps (Reference)
- `aiFirewall.openPolicy`, `aiFirewall.approveAction`, `aiFirewall.denyAction` commands NOT registered
- JetBrains missing: security dashboard, policy editor, risk display, scanning indicator
- CostBadge exists but not wired into StepContainer
- 0 integration tests for ai.route.ts
- core.ts (1556L) and VsCodeExtension.ts (755L) are god classes
