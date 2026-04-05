# Security Policy

## AI Firewall Security Architecture

AI Firewall is itself a security product. Extra vigilance is required because:

- **Scanner regex bugs** = secrets slip through to AI providers
- **Policy engine bugs** = wrong BLOCK/REDACT/ALLOW decisions
- **Vault bugs** = API keys exposed
- **Auth bugs** = unauthorized access to scan data

### Security Guarantees

| Guarantee                   | How                                                                                |
| --------------------------- | ---------------------------------------------------------------------------------- |
| No raw secrets stored in DB | Only SHA-256 hashes, never plaintext                                               |
| API keys encrypted at rest  | AES-256-GCM via `proxy/src/vault/encryption.ts`                                    |
| Local-first scanning        | Scanner pipeline runs offline, zero external calls                                 |
| Request body never logged   | Pino configured to exclude bodies (they contain the secrets we scan for)           |
| STRICT_LOCAL mode           | Runtime flag blocks all cloud providers — local LLM only                           |
| Prompt injection detection  | 13 pattern categories, configurable threshold                                      |
| OWASP-compliant approvals   | Agent chat interface cannot grant permissions — separate approval channel required |

### Scanner Coverage

6 scanners run on every request:

1. **Secret Scanner** — 12 patterns (AWS keys, private keys, JWTs, DB URLs, GitHub tokens, etc.)
2. **PII Scanner** — 7 patterns (email, phone, SSN, credit card with Luhn check, etc.)
3. **Entropy Scanner** — Shannon entropy for high-entropy tokens near context keywords
4. **Context Scanner** — Path-aware severity (test files downgraded, auth files upgraded)
5. **Prompt Injection Scanner** — 13 jailbreak/injection categories
6. **Policy Engine** — Weighted risk scoring → BLOCK / REDACT / ALLOW

## Reporting a Vulnerability

If you discover a security vulnerability in AI Firewall:

1. **Do NOT open a public issue**
2. Email **security@ai-firewall.dev** with:
   - Description of the vulnerability
   - Steps to reproduce
   - Your assessment of potential impact
   - Any possible mitigations
3. We will respond within 48 hours
4. Please allow sufficient time to investigate before public disclosure

### What Qualifies as Critical

| Severity     | Example                                                                         |
| ------------ | ------------------------------------------------------------------------------- |
| **Critical** | Scanner bypass (secret reaches LLM undetected), vault key exposure, auth bypass |
| **High**     | Policy engine incorrect decision, redaction failure, injection pattern evasion  |
| **Medium**   | Information disclosure via error messages, rate limit bypass                    |
| **Low**      | Non-security-impacting bugs in scanner patterns (false positive/negative)       |

## Security Response Protocol

When a critical vulnerability is reported:

1. Acknowledge within 48 hours
2. Investigate and reproduce
3. Develop fix in private branch
4. Release patch
5. Disclose after fix is deployed (coordinated disclosure)
6. Review entire codebase for similar issues

## Contact

For any security questions or concerns: security@ai-firewall.dev
