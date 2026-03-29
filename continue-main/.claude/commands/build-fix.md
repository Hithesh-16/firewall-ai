# Build and Fix — AI Firewall Monorepo

Incrementally fix build and type errors with minimal, safe changes.

## Step 1: Identify Build Order

This monorepo must build in order:
1. `packages/` (shared types, utilities)
2. `core/` (agent engine, depends on packages/)
3. `proxy/` (security proxy, independent)
4. `gui/` (React UI, depends on types)
5. `extensions/vscode/` (depends on core/)
6. `extensions/cli/` (depends on core/)

## Step 2: Run Build and Parse Errors

```bash
# Check each package
cd packages/config-types && npx tsc --noEmit
cd core && npx tsc --noEmit
cd proxy && npx tsc --noEmit --pretty
cd gui && npx tsc --noEmit
cd extensions/vscode && npx tsc --noEmit
```

## Step 3: Fix Loop (One Error at a Time)

1. Read the file with error context
2. Diagnose root cause (missing import, wrong type, syntax)
3. Fix minimally with Edit tool
4. Re-run build to verify
5. Move to next error

## Step 4: Guardrails

Stop and ask if:
- A fix introduces more errors than it resolves
- Same error persists after 3 attempts
- Fix requires architectural changes
- Errors stem from missing dependencies

## Recovery

```bash
# Rebuild everything from scratch
npm run build -w packages && cd core && npm run build && cd ../proxy && npm run build
```

Fix one error at a time for safety. Prefer minimal diffs over refactoring.
