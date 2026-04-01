---
paths:
  - "gui/**/*.tsx"
  - "gui/**/*.ts"
  - "gui/**/*.css"
  - "extensions/**/*.ts"
  - "extensions/**/*.tsx"
---
# UX Design System — AI Firewall

## Core Principles

1. **Security-First UX** — Users must always see what data is accessed, scanned, sent, or blocked. Never silently access files, send data, or use high-risk MCPs.
2. **Token Transparency** — Every AI interaction shows: estimated tokens, actual tokens used, cost, optimization applied.
3. **Minimal Cognitive Load** — Progressive disclosure. Default = simple, expand = advanced.
4. **Cross-Platform Consistency** — Same colors, icons, actions, states across all platforms.
5. **Human-in-Control** — High-risk actions require approval. Clear undo. Explainable decisions.

## Color System (MANDATORY)

| Meaning | Color | Tailwind | Hex |
|---------|-------|----------|-----|
| Safe / Allowed | Green | `emerald-400/500` | `#34D399` |
| Warning / Redacted | Yellow | `amber-400/500` | `#FBBF24` |
| Blocked / Risk | Red | `red-400/500` | `#F87171` |
| Info / Neutral | Blue | `blue-400/500` | `#60A5FA` |
| Approval Required | Blue | `blue-400/500` | `#60A5FA` |
| Background (dark) | Dark | `slate-900/950` | `#0B0F14` |

## AI Request Lifecycle UI

Every LLM request MUST show these states:
```
[User Action] → Scanning... → Policy Decision → LLM Call → Response
```

## Status Indicators

| State | UI Element |
|-------|-----------|
| Scanning | Spinner + "Scanning for sensitive data" |
| Redacted | Yellow badge + redacted count |
| Blocked | Red banner + reason + risk score |
| Allowed | Green check (subtle, non-intrusive) |
| Approval Required | Blue card with Allow/Deny buttons |

## Token Meter (SHOW ON EVERY RESPONSE)

```
Tokens: 320 → 90 (optimized)
Savings: 72%
Cost: $0.002
```

## Permission UX Pattern

```
⚠️ Access Request
AI wants to access: /Documents/payments/
Risk: HIGH
[Allow Once] [Always Allow] [Deny]
```

## Performance Targets

| Metric | Target |
|--------|--------|
| UI response | <100ms |
| AI request start | <300ms |
| Full response | <3s |

## Platform-Specific Rules

### VS Code / JetBrains
- Adapt to user's active theme (light/dark/custom)
- No duplicate provider UI — use Continue's built-in
- No blocking typing experience
- Fast feedback (<300ms)

### CLI
- No long paragraphs — use icons + colors
- Always show progress
- Use emojis for status (✅ ⚠️ 🔴 🔍)

### Web Dashboard
- No page > 2 scrolls
- All data filterable
- No hidden critical info
- Every detail view has back button or breadcrumb

### Mobile
- Swipe to approve/deny
- Push notifications for approvals
- Minimal typing
- 3 screens max: Approvals, Sessions, Alerts

## Component Standards

- Buttons: primary (emerald), secondary (gray border), danger (red)
- Toast notifications: error (red), warning (yellow), info (blue), success (green)
- Tables: sortable headers, filterable, expandable rows
- Code blocks: JetBrains Mono font, syntax highlighted
- Diff viewers: red/green inline diff

## DON'T

- Don't show raw JSON errors to users
- Don't use different colors for the same concept across platforms
- Don't hide security-critical information behind clicks
- Don't auto-dismiss block/redact notifications (user must acknowledge)
- Don't use loading spinners > 3s without progress text
