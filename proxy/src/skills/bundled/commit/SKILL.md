---
name: commit
description: Generate a git commit message from staged changes
trigger: /commit
context: inline
---

Look at the staged git changes (use `git diff --staged`) and write a concise commit message following conventional commits format.

Rules:

- First line: type(scope): description (max 72 chars)
- Types: feat, fix, refactor, docs, test, chore, style, perf
- Body: explain WHY, not WHAT (the diff shows what)
- Keep it under 3 lines total

{{args}}
