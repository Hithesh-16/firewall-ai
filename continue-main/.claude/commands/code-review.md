# Code Review

Comprehensive security and quality review of uncommitted changes in the AI Firewall monorepo:

1. Get changed files: `git diff --name-only HEAD`

2. Identify affected packages (proxy, core, gui, extensions, packages)

3. For each changed file, check for:

**Security Issues (CRITICAL):**
- Hardcoded credentials, API keys, tokens
- SQL injection in proxy/ (must use parameterized queries)
- XSS in gui/ (unsanitized user input)
- Missing auth on proxy routes
- Raw secrets/PII stored in SQLite (hashes only!)
- Scanner bypass — LLM request not going through proxy
- Vault encryption issues
- Missing Zod validation on proxy route inputs

**Code Quality (HIGH):**
- Functions > 50 lines
- Files > 800 lines
- Nesting depth > 4 levels
- Missing error handling / empty catch blocks
- `console.log` statements (use structured logger)
- `any` types without justification
- Provider-specific logic in core/ (belongs in proxy/src/gateway/adapters/)

**Best Practices (MEDIUM):**
- Mutation patterns (use immutable spread instead)
- Missing tests for new scanner patterns or policy rules
- Missing useEffect deps in gui/
- N+1 database queries in proxy/

4. Generate report with severity, file:line, issue, and fix

5. Block if CRITICAL or HIGH issues found
