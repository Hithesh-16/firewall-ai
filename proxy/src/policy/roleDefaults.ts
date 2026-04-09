/**
 * Default per-role policy overlays.
 *
 * When a user first opens the Policy tab for a system role, the backend
 * lazy-seeds the corresponding entry from this file into the
 * `role_policies` table. From that point on the value is fully editable
 * — clicking "Remove override" truly deletes the row and the role falls
 * back to the org baseline.
 *
 * The four system roles use the following philosophy:
 *
 *   admin         — no tightening. Admins live at the org baseline.
 *   security_lead — enable response scanning + audit, lower the prompt
 *                   injection threshold, always log requests.
 *   developer     — block the common credential patterns explicitly,
 *                   tighter prompt injection, always log.
 *   auditor       — strictest possible: block every credential pattern,
 *                   redact every PII pattern, response scanning on,
 *                   severity threshold at "medium" (strictest).
 *
 * The shape is the proxy's `PartialPolicy` — i.e. any subset of
 * `PolicyConfig`. Strictest-wins merging is applied by
 * `resolveEffectivePolicy()` so these values can only ADD restrictions.
 *
 * Custom roles have NO default — when a user creates one, the UI shows
 * the commented template below (see `ROLE_POLICY_TEMPLATE_JSONC`) so
 * they can pick which fields to tighten.
 */

import type { PartialPolicy } from "./policyChain";

export const SYSTEM_ROLE_NAMES = [
  "admin",
  "security_lead",
  "developer",
  "auditor",
] as const;

export type SystemRoleName = (typeof SYSTEM_ROLE_NAMES)[number];

export function isSystemRoleName(name: string): name is SystemRoleName {
  return (SYSTEM_ROLE_NAMES as readonly string[]).includes(name);
}

export const ROLE_DEFAULT_POLICIES: Record<SystemRoleName, PartialPolicy> = {
  // Admin — inherit everything from the org baseline. An explicit
  // empty override row is still written so the UI can show "Override:
  // default (click to customise)" instead of an empty text field.
  admin: {},

  // Security lead — the role that watches the firewall. Force-enables
  // response scanning (so model output is scrutinised too), requires
  // audit logs, lowers prompt-injection threshold to 50 (stricter),
  // and forces every request to be logged.
  security_lead: {
    rules: {
      log_all_requests: true,
    },
    prompt_injection: {
      enabled: true,
      threshold: 50,
    },
    response_scanning: {
      enabled: true,
    },
  },

  // Developer — the day-to-day coder. Prompt injection threshold 40
  // (stricter than security_lead's 50 because devs paste more third-
  // party content into prompts). Also hard-blocks the usual
  // credential patterns regardless of the org baseline.
  developer: {
    rules: {
      block_private_keys: true,
      block_aws_keys: true,
      block_db_urls: true,
      block_github_tokens: true,
      redact_jwt: true,
      redact_generic_api_keys: true,
      log_all_requests: true,
    },
    prompt_injection: {
      enabled: true,
      threshold: 40,
    },
  },

  // Auditor — maximum paranoia. Auditors are read-only humans so they
  // shouldn't be sending prompts often, but when they do, EVERYTHING
  // gets scanned + blocked + redacted.
  auditor: {
    rules: {
      block_private_keys: true,
      block_aws_keys: true,
      block_db_urls: true,
      block_github_tokens: true,
      redact_emails: true,
      redact_phone: true,
      redact_jwt: true,
      redact_generic_api_keys: true,
      log_all_requests: true,
    },
    severity_threshold: "medium",
    prompt_injection: {
      enabled: true,
      threshold: 30,
    },
    response_scanning: {
      enabled: true,
    },
  },
};

/**
 * JSONC template (JSON with `//` line comments) returned by the
 * `GET /api/policies/role-template` endpoint. The frontend renders
 * it verbatim in the Policy tab textarea so users see every field
 * they can override, with an explanation next to each one.
 *
 * On save the frontend strips the comments with `stripJsonComments`
 * before POSTing.
 *
 * Keep this in sync with `PartialPolicy` in policyChain.ts.
 */
export const ROLE_POLICY_TEMPLATE_JSONC = `{
  // ─── RULES ────────────────────────────────────────────────────────
  // Per-category hard blocks and redactions. Each one is a boolean.
  // Setting \`true\` here FORCES the rule ON for anyone in this role,
  // regardless of the org default. Setting \`false\` means "inherit".
  "rules": {
    "block_private_keys":      true,   // Block PEM/RSA/EC private keys
    "block_aws_keys":          true,   // Block AWS access key IDs / secret keys
    "block_db_urls":           true,   // Block DB connection strings with creds
    "block_github_tokens":     true,   // Block GitHub personal access tokens
    "redact_emails":           true,   // Replace email addresses with placeholders
    "redact_phone":            true,   // Replace phone numbers with placeholders
    "redact_jwt":              true,   // Replace JWTs with placeholders
    "redact_generic_api_keys": true,   // Replace high-entropy secrets
    "log_all_requests":        true    // Force full request logging
  },

  // ─── SEVERITY THRESHOLD ───────────────────────────────────────────
  // The minimum severity the policy engine treats as "actionable".
  //   "medium"   — strictest, blocks on borderline matches
  //   "high"     — blocks only high-confidence matches
  //   "critical" — only blocks on rock-solid matches (most permissive)
  "severity_threshold": "medium",

  // ─── PROMPT INJECTION ────────────────────────────────────────────
  // \`enabled\` — run the prompt-injection scanner at all.
  // \`threshold\` — integer 0-100. LOWER is stricter.
  //    0  = flag any match
  //    60 = org default
  //    100 = essentially disabled
  "prompt_injection": {
    "enabled":   true,
    "threshold": 50
  },

  // ─── RESPONSE SCANNING ───────────────────────────────────────────
  // Force-enable scanning of LLM OUTPUT (not just input). Catches
  // cases where the model echoes back a secret or PII even though
  // the prompt was clean.
  "response_scanning": {
    "enabled": true
  },

  // ─── FILE SCOPE OVERRIDES ────────────────────────────────────────
  // Add patterns to the blocklist (union'd with the org baseline).
  // Remove from the allowlist by listing stricter glob patterns.
  "file_scope": {
    "blocklist": [
      // "**/*.secrets.*",
      // "**/infra/production/**"
    ],
    "allowlist": []
  },

  // ─── BLOCKED PATH PREFIXES ───────────────────────────────────────
  // Requests whose content references any of these URL paths are
  // blocked outright. Good for never-send-to-LLM directories.
  "blocked_paths": [
    // "/auth/",
    // "/payments/",
    // "/.env"
  ]
}
`;

/**
 * Strip "//" line comments from a JSONC string so `JSON.parse` can
 * read it. Used server-side when the frontend round-trips a template
 * that still contains comments.
 *
 * Handles strings correctly — comments inside a string literal are
 * preserved. Does NOT handle block comments (slash-star) because the
 * template above only uses line comments.
 */
export function stripLineComments(jsonc: string): string {
  let out = "";
  let inString = false;
  let stringQuote: string | null = null;
  let escape = false;

  for (let i = 0; i < jsonc.length; i++) {
    const c = jsonc[i];
    const next = jsonc[i + 1];
    if (inString) {
      out += c;
      if (escape) {
        escape = false;
        continue;
      }
      if (c === "\\") {
        escape = true;
        continue;
      }
      if (c === stringQuote) {
        inString = false;
        stringQuote = null;
      }
      continue;
    }

    if (c === '"' || c === "'") {
      inString = true;
      stringQuote = c;
      out += c;
      continue;
    }

    if (c === "/" && next === "/") {
      // skip until newline
      while (i < jsonc.length && jsonc[i] !== "\n") i++;
      if (i < jsonc.length) out += "\n";
      continue;
    }

    out += c;
  }
  return out;
}
