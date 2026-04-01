---
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.js"
  - "**/*.jsx"
---
# Security Rules — AI Firewall

## Mandatory Checks Before ANY Commit

- [ ] No hardcoded secrets (API keys, passwords, tokens)
- [ ] All user inputs validated with Zod
- [ ] SQL uses parameterized queries (never string concatenation)
- [ ] No raw secrets/PII stored in SQLite (hashes only)
- [ ] Auth middleware on all protected proxy routes
- [ ] Error messages don't leak sensitive data
- [ ] Scanner patterns tested for both true positives and false positives

## Secret Management

```typescript
// NEVER: Hardcoded secrets
const apiKey = "sk-proj-xxxxx"

// ALWAYS: Environment variables with validation
const apiKey = process.env.OPENAI_API_KEY
if (!apiKey) throw new Error('OPENAI_API_KEY not configured')
```

## This Project IS Security Software

Extra vigilance required because:
- Scanner regex bugs = secrets slip through to AI providers
- Policy engine bugs = wrong BLOCK/REDACT/ALLOW decisions
- Vault bugs = API keys exposed
- Auth bugs = unauthorized access to scan data

## Security Response Protocol

If a CRITICAL vulnerability is found:
1. STOP immediately
2. Use **security-reviewer** agent
3. Fix CRITICAL issues before continuing
4. Rotate any exposed secrets
5. Review entire codebase for similar issues
