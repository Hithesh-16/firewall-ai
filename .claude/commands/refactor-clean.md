# Refactor Clean — AI Firewall Monorepo

Safely identify and remove dead code with test verification at every step.

## Step 1: Detect Dead Code

```bash
npx knip                    # Unused files, exports, dependencies
npx depcheck                # Unused npm dependencies
npx ts-prune                # Unused TypeScript exports
```

## Step 2: Categorize by Safety

| Tier | Examples | Action |
|------|----------|--------|
| **SAFE** | Unused internal utils, dead imports | Delete with confidence |
| **CAUTION** | Cross-package exports, dynamic imports | Verify ALL consumers |
| **DANGER** | Config schemas, public APIs, core types | Investigate thoroughly |

## Step 3: Safe Deletion Loop

For each SAFE item:
1. Run full test suite (all packages)
2. Delete the dead code
3. Re-run tests
4. If tests fail — immediately revert and skip
5. If tests pass — build ALL packages to verify
6. Commit after each batch

## Step 4: Cross-Package Verification

Before removing ANY export, check all packages:
```bash
grep -r "exportName" proxy/ core/ gui/ extensions/ packages/
```

## Rules

- Never delete without running tests first
- One deletion at a time for easy rollback
- Check cross-package references before removing
- When in doubt, don't remove
