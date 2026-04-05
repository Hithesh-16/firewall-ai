---
name: security-audit
description: Full-repo security audit — secrets, vulnerabilities, weak code, attack surface
trigger: /security-audit
context: inline
---

Perform a comprehensive security audit of this repository. Use `read_file` and `grep_search` to scan the codebase systematically. If `{{args}}` includes `--path <dir>`, scope the audit to that directory only; otherwise scan the entire repo.

Follow this process in order:

1. **Hardcoded Secrets & Credentials** — grep for API keys, passwords, tokens, private keys, database connection strings, `.env` files checked into source. Look for patterns like `AKIA`, `sk-`, `ghp_`, `BEGIN RSA PRIVATE KEY`, `password\s*=`, `secret\s*=`, `token\s*=`.

2. **OWASP Top 10 Patterns** — check for SQL injection (string concatenation in queries), XSS (unsanitized user input rendered in HTML), SSRF (user-controlled URLs in fetch/request calls), broken access control (missing auth checks on routes), security misconfiguration (debug mode, default credentials, permissive CORS), insecure deserialization (`eval`, `pickle.loads`, `JSON.parse` on untrusted input), and injection flaws (shell command construction from user input).

3. **Weak Cryptography** — find uses of MD5, SHA1 for security purposes, ECB mode, hardcoded IVs/salts, weak key sizes (RSA < 2048, AES < 128), `Math.random()` or `random` for security-sensitive operations, and missing certificate validation.

4. **Insecure Configuration** — check for overly permissive file permissions, disabled TLS verification, `*` CORS origins in production, debug/verbose logging of sensitive data, default ports exposed without auth, and missing security headers (CSP, HSTS, X-Frame-Options).

5. **Dependency Analysis** — read `package.json`, `requirements.txt`, `go.mod`, `Cargo.toml`, `pom.xml`, or equivalent. Flag dependencies with known CVE patterns, outdated major versions, and unnecessary broad permissions.

6. **Attack Surface Mapping** — find all exposed HTTP/WebSocket endpoints, admin panels, health checks without auth, file upload handlers, and publicly accessible API routes. Note any endpoints missing rate limiting or authentication middleware.

7. **Technology Stack Detection** — identify the languages, frameworks, and infrastructure in use (Node.js, Python, Go, React, Docker, Kubernetes, etc.) and apply language-specific checks:

   - **Node.js**: prototype pollution, `child_process` with user input, missing `helmet`, insecure `jsonwebtoken` options
   - **Python**: `pickle`, `eval`, `subprocess` with `shell=True`, Jinja2 without autoescape
   - **Go**: `fmt.Sprintf` in SQL, unchecked errors, `net/http` without timeouts
   - **Java**: XML external entity (XXE), insecure `ObjectInputStream`, log injection
   - **React/Frontend**: `dangerouslySetInnerHTML`, inline event handlers with user data, exposed API keys in client bundles

8. **Authentication & Authorization** — check for weak password policies, missing MFA references, JWT without expiration or with `none` algorithm, session tokens in URLs, and privilege escalation paths.

9. **Data Exposure** — look for PII logged without redaction, stack traces returned to clients, verbose error messages exposing internals, and sensitive data in URL query parameters.

10. **Infrastructure** — review Dockerfiles for `latest` tags, running as root, and exposed secrets in build args. Check CI/CD configs for secret leaks in logs, and review any Terraform/CloudFormation for public S3 buckets or open security groups.

Format the output as:

## Security Audit Report

### Risk Score: X/100 (Grade: A/B/C/D/F)

Assign the score based on finding severity and count:

- 0-20 (A): No critical/high findings
- 21-40 (B): Minor issues only
- 41-60 (C): Some high-severity findings
- 61-80 (D): Critical findings present
- 81-100 (F): Multiple critical findings or active credential exposure

### Critical Findings (X)

For each finding:

- **[C-N] Title** — file:line
  - Description of the vulnerability
  - Impact if exploited
  - Remediation: specific fix

### High Findings (X)

Same format as critical.

### Medium/Low Findings (X)

Group by category, list file paths and brief description.

### Technology Stack Detected

List languages, frameworks, package managers, infrastructure found.

### Recommendations

Numbered list of prioritized actions, most urgent first. Include quick wins separately.

{{args}}
