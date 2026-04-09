import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { env } from "../config";

const dbPath = path.resolve(process.cwd(), env.DB_PATH);
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);

db.pragma("journal_mode = WAL");

db.exec(`
-- Phase 1: request logs
CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL,
  model TEXT NOT NULL,
  provider TEXT NOT NULL,
  original_hash TEXT NOT NULL,
  sanitized_text TEXT NOT NULL,
  secrets_found INTEGER DEFAULT 0,
  pii_found INTEGER DEFAULT 0,
  entropy_found INTEGER DEFAULT 0,
  files_blocked INTEGER DEFAULT 0,
  risk_score INTEGER DEFAULT 0,
  action TEXT NOT NULL,
  reasons TEXT,
  response_time_ms INTEGER,
  user_id INTEGER
);

CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_logs_action ON logs(action);
CREATE INDEX IF NOT EXISTS idx_logs_provider ON logs(provider);

-- Phase 3: organizations
CREATE TABLE IF NOT EXISTS organizations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

-- Phase 3: users
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'developer',
  org_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_org ON users(org_id);

-- Phase 3: API tokens
CREATE TABLE IF NOT EXISTS api_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  scopes TEXT,
  org_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
  team_id INTEGER,
  last_used_at INTEGER,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  rotated_from_id INTEGER
);

CREATE INDEX IF NOT EXISTS idx_tokens_hash ON api_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_tokens_user ON api_tokens(user_id);

-- Phase 4: AI providers
CREATE TABLE IF NOT EXISTS providers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  base_url TEXT NOT NULL,
  api_key_encrypted TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Phase 4: models per provider
CREATE TABLE IF NOT EXISTS models (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id INTEGER NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  model_name TEXT NOT NULL,
  display_name TEXT,
  input_cost_per_1k REAL DEFAULT 0,
  output_cost_per_1k REAL DEFAULT 0,
  max_context_tokens INTEGER DEFAULT 0,
  enabled INTEGER DEFAULT 1,
  UNIQUE(provider_id, model_name)
);

CREATE INDEX IF NOT EXISTS idx_models_provider ON models(provider_id);

-- Phase 4: credit limits
CREATE TABLE IF NOT EXISTS credits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id INTEGER REFERENCES providers(id) ON DELETE CASCADE,
  model_id INTEGER REFERENCES models(id) ON DELETE CASCADE,
  limit_type TEXT NOT NULL,
  total_limit REAL NOT NULL,
  used_amount REAL DEFAULT 0,
  reset_period TEXT NOT NULL,
  reset_date INTEGER NOT NULL,
  hard_limit INTEGER DEFAULT 1,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_credits_provider ON credits(provider_id);

-- Phase 4: usage tracking
CREATE TABLE IF NOT EXISTS usage_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  log_id INTEGER REFERENCES logs(id),
  provider_id INTEGER NOT NULL REFERENCES providers(id),
  model_name TEXT NOT NULL,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  cost REAL DEFAULT 0,
  timestamp INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_usage_provider ON usage_logs(provider_id);
CREATE INDEX IF NOT EXISTS idx_usage_timestamp ON usage_logs(timestamp);
 
-- Admin audit actions (resolves, purges, admin interventions)
CREATE TABLE IF NOT EXISTS admin_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL,
  user_id INTEGER,
  action TEXT NOT NULL,
  details TEXT
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_user ON admin_audit(user_id);

-- Audit queue for privacy review (Phase X)
CREATE TABLE IF NOT EXISTS audit_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  submitter_id INTEGER,
  snippet_masked TEXT NOT NULL,
  metadata TEXT,
  blindmi_score REAL DEFAULT 0,
  github_hits INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending',
  reviewer_id INTEGER,
  reviewed_at INTEGER,
  action TEXT,
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_queue_status ON audit_queue(status);

-- Phase 7: SSO sessions
CREATE TABLE IF NOT EXISTS sso_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  external_id TEXT NOT NULL,
  access_token_encrypted TEXT,
  refresh_token_encrypted TEXT,
  expires_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sso_sessions_user ON sso_sessions(user_id);

-- Phase 7: webhooks
CREATE TABLE IF NOT EXISTS webhooks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  events TEXT NOT NULL,
  secret TEXT,
  enabled INTEGER DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_webhooks_org ON webhooks(org_id);

-- Phase 7: model allowlist/denylist per org
CREATE TABLE IF NOT EXISTS org_model_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  model_pattern TEXT NOT NULL,
  rule_type TEXT NOT NULL CHECK(rule_type IN ('allow', 'deny')),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_org_model_rules_org ON org_model_rules(org_id);

-- Phase 7: rate limits per user
CREATE TABLE IF NOT EXISTS rate_limits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  org_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
  max_requests_per_minute INTEGER DEFAULT 30,
  max_tokens_per_minute INTEGER DEFAULT 100000,
  created_at INTEGER NOT NULL
);

-- Phase 3 (MCP Gateway): audit log for MCP tool calls
CREATE TABLE IF NOT EXISTS mcp_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp INTEGER NOT NULL,
  server_name TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  direction TEXT NOT NULL,
  action TEXT NOT NULL,
  risk_score INTEGER DEFAULT 0,
  secrets_found INTEGER DEFAULT 0,
  pii_found INTEGER DEFAULT 0,
  injection_score INTEGER DEFAULT 0,
  reasons TEXT,
  scan_time_ms INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_mcp_audit_ts ON mcp_audit(timestamp);
CREATE INDEX IF NOT EXISTS idx_mcp_audit_server ON mcp_audit(server_name);
CREATE INDEX IF NOT EXISTS idx_mcp_audit_action ON mcp_audit(action);

-- Phase 4 (Control Plane): approval requests
CREATE TABLE IF NOT EXISTS approval_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL,
  resource TEXT NOT NULL,
  context_json TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','denied','expired')),
  resolved_by_device TEXT,
  resolved_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_approval_status ON approval_requests(status);
CREATE INDEX IF NOT EXISTS idx_approval_user ON approval_requests(user_id);

-- Phase 4 (Control Plane): remembered approval rules ("Allow Always" / "Deny Always")
CREATE TABLE IF NOT EXISTS approval_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  resource_pattern TEXT NOT NULL,
  action_type TEXT NOT NULL,
  decision TEXT NOT NULL CHECK(decision IN ('allow_always','deny_always')),
  created_at INTEGER NOT NULL,
  UNIQUE(user_id, resource_pattern, action_type)
);
CREATE INDEX IF NOT EXISTS idx_approval_rules_user ON approval_rules(user_id);

-- Phase 4 (Control Plane): notification channel configurations
CREATE TABLE IF NOT EXISTS notification_channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  channel_type TEXT NOT NULL CHECK(channel_type IN ('webpush','slack','email','webhook')),
  config_json TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notif_channels_user ON notification_channels(user_id);

-- Phase 4 (Control Plane): Web Push subscriptions
CREATE TABLE IF NOT EXISTS webpush_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  keys_json TEXT NOT NULL,
  device_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_webpush_user ON webpush_subscriptions(user_id);

-- Phase 4 (Control Plane): active sessions tracking
CREATE TABLE IF NOT EXISTS active_sessions (
  id TEXT PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  device_type TEXT NOT NULL,
  model TEXT,
  started_at INTEGER NOT NULL,
  last_activity_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON active_sessions(user_id);

-- Phase 5: webhook delivery queue (Stripe/GitHub pattern)
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  webhook_id INTEGER NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  event TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','delivered','failed','dead')),
  attempts INTEGER DEFAULT 0,
  next_retry_at INTEGER,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  delivered_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_wh_del_status ON webhook_deliveries(status);
CREATE INDEX IF NOT EXISTS idx_wh_del_retry ON webhook_deliveries(next_retry_at);

-- Phase 2 (File Scan): content-addressed scan cache
CREATE TABLE IF NOT EXISTS file_scan_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  action TEXT NOT NULL,
  risk_score INTEGER DEFAULT 0,
  secrets_found INTEGER DEFAULT 0,
  pii_found INTEGER DEFAULT 0,
  entropy_found INTEGER DEFAULT 0,
  scan_result TEXT NOT NULL,
  scanned_at INTEGER NOT NULL,
  UNIQUE(file_path, file_hash)
);
CREATE INDEX IF NOT EXISTS idx_fsc_path ON file_scan_cache(file_path);
CREATE INDEX IF NOT EXISTS idx_fsc_hash ON file_scan_cache(file_hash);

-- Phase 1 (Agent Core): task state machine
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('local_agent','background_agent','bash','scan','dream','cron','workflow')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','completed','failed','killed','expired')),
  description TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  agent_id TEXT,
  parent_task_id TEXT,
  model TEXT,
  prompt TEXT,
  worktree_path TEXT,
  progress_json TEXT,
  error TEXT,
  result_summary TEXT,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  notified INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_task_id);
CREATE INDEX IF NOT EXISTS idx_tasks_started ON tasks(started_at);
`);

// Migration: add onboarding_complete to users.
//   Default 0 for new accounts so the wizard runs.
//   Backfill 1 for any existing user that already belongs to an org —
//   they're effectively onboarded and shouldn't be forced through the
//   wizard on next login.
try {
  db.prepare("SELECT onboarding_complete FROM users LIMIT 1").get();
} catch {
  db.exec(
    "ALTER TABLE users ADD COLUMN onboarding_complete INTEGER NOT NULL DEFAULT 0",
  );
  db.exec(
    "UPDATE users SET onboarding_complete = 1 WHERE org_id IS NOT NULL",
  );
}

// Migration: add timezone to users (per-user display preference,
// captured in the onboarding wizard's Step 2). IANA zone string
// like "America/Los_Angeles", nullable so SSO users get NULL.
try {
  db.prepare("SELECT timezone FROM users LIMIT 1").get();
} catch {
  db.exec("ALTER TABLE users ADD COLUMN timezone TEXT");
}

// Migration: add industry to organizations (workspace metadata from
// the onboarding wizard's Step 2). Free-text, nullable.
try {
  db.prepare("SELECT industry FROM organizations LIMIT 1").get();
} catch {
  db.exec("ALTER TABLE organizations ADD COLUMN industry TEXT");
}

// Migrations: add missing columns to api_tokens if they don't exist
try {
  db.prepare("SELECT scopes FROM api_tokens LIMIT 1").get();
} catch {
  db.exec("ALTER TABLE api_tokens ADD COLUMN scopes TEXT");
}
try {
  db.prepare("SELECT org_id FROM api_tokens LIMIT 1").get();
} catch {
  db.exec(
    "ALTER TABLE api_tokens ADD COLUMN org_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE",
  );
}
try {
  db.prepare("SELECT team_id FROM api_tokens LIMIT 1").get();
} catch {
  db.exec("ALTER TABLE api_tokens ADD COLUMN team_id INTEGER");
}
try {
  db.prepare("SELECT rotated_from_id FROM api_tokens LIMIT 1").get();
} catch {
  db.exec("ALTER TABLE api_tokens ADD COLUMN rotated_from_id INTEGER");
}

// Migration: add entropy_found column to logs if it doesn't exist
try {
  db.prepare("SELECT entropy_found FROM logs LIMIT 1").get();
} catch {
  db.exec("ALTER TABLE logs ADD COLUMN entropy_found INTEGER DEFAULT 0");
}

// Migration: add prev_hash to logs for tamper-evident hash chain
try {
  db.prepare("SELECT prev_hash FROM logs LIMIT 1").get();
} catch {
  db.exec("ALTER TABLE logs ADD COLUMN prev_hash TEXT");
}

// Migration: add user_id to usage_logs for cost attribution
try {
  db.prepare("SELECT user_id FROM usage_logs LIMIT 1").get();
} catch {
  db.exec(
    "ALTER TABLE usage_logs ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE SET NULL",
  );
  db.exec("CREATE INDEX IF NOT EXISTS idx_usage_user ON usage_logs(user_id)");
}

// Phase 1: teams + team_members
db.exec(`
CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(org_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_teams_org ON teams(org_id);

CREATE TABLE IF NOT EXISTS team_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('lead','member')),
  joined_at INTEGER NOT NULL,
  UNIQUE(team_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_tm_team ON team_members(team_id);
CREATE INDEX IF NOT EXISTS idx_tm_user ON team_members(user_id);
`);

// Migration: add team_id FK to attribution tables
try {
  db.prepare("SELECT team_id FROM usage_logs LIMIT 1").get();
} catch {
  db.exec(
    "ALTER TABLE usage_logs ADD COLUMN team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL",
  );
}
try {
  db.prepare("SELECT team_id FROM logs LIMIT 1").get();
} catch {
  db.exec(
    "ALTER TABLE logs ADD COLUMN team_id INTEGER REFERENCES teams(id) ON DELETE SET NULL",
  );
}

// ── Configurable RBAC ─────────────────────────────────────────────────

db.exec(`
-- Roles: 4 built-in system roles + org-defined custom roles
CREATE TABLE IF NOT EXISTS roles (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id      INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT,
  is_system   INTEGER NOT NULL DEFAULT 0,
  is_custom   INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  UNIQUE(org_id, name)
);

-- Granular permission atoms: resource:action
CREATE TABLE IF NOT EXISTS capabilities (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  resource    TEXT NOT NULL,
  action      TEXT NOT NULL,
  description TEXT,
  category    TEXT NOT NULL,
  risk_level  TEXT NOT NULL DEFAULT 'low'
              CHECK(risk_level IN ('low','medium','high','critical')),
  created_at  INTEGER NOT NULL
);

-- Maps roles to capabilities with scope control
CREATE TABLE IF NOT EXISTS role_capabilities (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  role_id         INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  capability_name TEXT NOT NULL REFERENCES capabilities(name) ON DELETE CASCADE,
  scope           TEXT NOT NULL DEFAULT 'org'
                  CHECK(scope IN ('org','team','project','own')),
  granted         INTEGER NOT NULL DEFAULT 1,
  created_at      INTEGER NOT NULL,
  UNIQUE(role_id, capability_name)
);

-- Assigns a role to a user at org level
CREATE TABLE IF NOT EXISTS user_org_roles (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id      INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role_id     INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  granted_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  expires_at  INTEGER,
  created_at  INTEGER NOT NULL,
  UNIQUE(user_id, org_id)
);
CREATE INDEX IF NOT EXISTS idx_uor_user ON user_org_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_uor_org ON user_org_roles(org_id);

-- Per-team role overrides
CREATE TABLE IF NOT EXISTS user_team_roles (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  team_id     INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  role_id     INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  granted_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  expires_at  INTEGER,
  created_at  INTEGER NOT NULL,
  UNIQUE(user_id, team_id)
);
CREATE INDEX IF NOT EXISTS idx_utr_user ON user_team_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_utr_team ON user_team_roles(team_id);

-- Per-user capability overrides (exceptions without changing role)
CREATE TABLE IF NOT EXISTS user_capability_overrides (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id          INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  capability_name TEXT NOT NULL REFERENCES capabilities(name) ON DELETE CASCADE,
  granted         INTEGER NOT NULL DEFAULT 1,
  reason          TEXT NOT NULL,
  granted_by      INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  expires_at      INTEGER,
  created_at      INTEGER NOT NULL,
  UNIQUE(user_id, org_id, capability_name)
);
CREATE INDEX IF NOT EXISTS idx_uco_user ON user_capability_overrides(user_id, org_id);

-- Permission audit log (append-only, hash-chained)
CREATE TABLE IF NOT EXISTS permission_audit_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL,
  org_id          INTEGER NOT NULL,
  team_id         INTEGER,
  capability_name TEXT NOT NULL,
  action          TEXT NOT NULL,
  result          TEXT NOT NULL CHECK(result IN ('allowed','denied')),
  reason          TEXT,
  role_id_used    INTEGER,
  token_id        INTEGER,
  ip_address      TEXT,
  request_id      TEXT,
  prev_hash       TEXT,
  row_hash        TEXT,
  ts              INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pal_user ON permission_audit_log(user_id, org_id, ts);
CREATE INDEX IF NOT EXISTS idx_pal_cap ON permission_audit_log(capability_name, ts);
`);

// ── Seed system roles (fully idempotent) ────────────────────────────
//
// SQLite treats NULL as distinct in UNIQUE constraints, so `INSERT OR
// IGNORE` on a row with org_id=NULL happily inserts duplicates on every
// restart. We guard with an explicit existence check, and also clean
// up any duplicates left behind by the previous (buggy) seed runs.
const now = Date.now();

// One-time cleanup: dedupe system roles by name, keeping only the
// lowest id. Does NOTHING on a fresh DB.
//
// Safety: before deleting duplicate role rows, we:
//   1. Repoint every user_org_roles / user_team_roles row from a
//      duplicate role_id to the canonical (lowest-id) row. The
//      capabilities are identical so the user's permissions are
//      unchanged.
//   2. Delete role_capabilities rows for the duplicates (the
//      FK CASCADE handles this but doing it explicitly makes the
//      transaction order obvious).
//   3. Delete the duplicate role rows themselves.
//
// Wrapped in a transaction so a partial failure doesn't orphan users.
try {
  const dupes = db
    .prepare(
      `SELECT name, MIN(id) AS canonical_id, COUNT(*) AS cnt
         FROM roles
        WHERE is_system = 1 AND org_id IS NULL
        GROUP BY name
       HAVING COUNT(*) > 1`,
    )
    .all() as Array<{ name: string; canonical_id: number; cnt: number }>;

  if (dupes.length > 0) {
    const txn = db.transaction(() => {
      for (const { name, canonical_id } of dupes) {
        // Every duplicate id for this role name.
        const duplicateIds = (
          db
            .prepare(
              "SELECT id FROM roles WHERE is_system = 1 AND org_id IS NULL AND name = ? AND id != ?",
            )
            .all(name, canonical_id) as Array<{ id: number }>
        ).map((r) => r.id);
        if (duplicateIds.length === 0) continue;

        const placeholders = duplicateIds.map(() => "?").join(",");

        db.prepare(
          `UPDATE user_org_roles SET role_id = ? WHERE role_id IN (${placeholders})`,
        ).run(canonical_id, ...duplicateIds);
        db.prepare(
          `UPDATE user_team_roles SET role_id = ? WHERE role_id IN (${placeholders})`,
        ).run(canonical_id, ...duplicateIds);
        db.prepare(
          `DELETE FROM role_capabilities WHERE role_id IN (${placeholders})`,
        ).run(...duplicateIds);
        db.prepare(
          `DELETE FROM roles WHERE id IN (${placeholders})`,
        ).run(...duplicateIds);
      }
    });
    txn();
  }
} catch (err) {
  // eslint-disable-next-line no-console
  console.error("[db] system role dedup failed:", err);
}

function ensureSystemRole(
  name: string,
  displayName: string,
  description: string,
): void {
  const existing = db
    .prepare(
      "SELECT id FROM roles WHERE org_id IS NULL AND name = ? AND is_system = 1",
    )
    .get(name) as { id: number } | undefined;
  if (existing) return;
  db.prepare(
    "INSERT INTO roles (org_id, name, display_name, description, is_system, created_at, updated_at) VALUES (NULL, ?, ?, ?, 1, ?, ?)",
  ).run(name, displayName, description, now, now);
}

ensureSystemRole("admin", "Admin", "Full org control");
ensureSystemRole(
  "security_lead",
  "Security Lead",
  "Policy, approvals, scanner config",
);
ensureSystemRole("developer", "Developer", "AI coding tools, own logs");
ensureSystemRole(
  "auditor",
  "Auditor",
  "Read-everything, write-nothing, no tools",
);

// Seed capabilities (idempotent)
const seedCap = db.prepare(
  "INSERT OR IGNORE INTO capabilities (name, resource, action, description, category, risk_level, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
);
const caps: Array<[string, string, string, string, string, string]> = [
  // Org & billing
  ["org:read", "org", "read", "View org settings", "Organisation", "low"],
  [
    "org:write",
    "org",
    "write",
    "Modify org settings",
    "Organisation",
    "critical",
  ],
  [
    "billing:read",
    "billing",
    "read",
    "View billing and credit usage",
    "Organisation",
    "low",
  ],
  [
    "billing:write",
    "billing",
    "write",
    "Manage billing, adjust credits",
    "Organisation",
    "critical",
  ],
  // Teams
  ["team:create", "team", "create", "Create teams", "Teams", "high"],
  ["team:read", "team", "read", "View team details", "Teams", "low"],
  ["team:write", "team", "write", "Edit team settings", "Teams", "medium"],
  ["team:delete", "team", "delete", "Delete teams", "Teams", "high"],
  // User & access
  ["user:invite", "user", "invite", "Invite users to org", "Identity", "high"],
  [
    "user:remove",
    "user",
    "remove",
    "Remove users from org",
    "Identity",
    "high",
  ],
  [
    "user:read",
    "user",
    "read",
    "View user list and profiles",
    "Identity",
    "low",
  ],
  [
    "role:assign",
    "role",
    "assign",
    "Assign and change user roles",
    "Identity",
    "critical",
  ],
  [
    "role:manage",
    "role",
    "manage",
    "Create and edit custom roles",
    "Identity",
    "critical",
  ],
  // Tokens
  ["token:create", "token", "create", "Create API tokens", "Identity", "high"],
  [
    "token:revoke",
    "token",
    "revoke",
    "Revoke any API token",
    "Identity",
    "high",
  ],
  [
    "token:read",
    "token",
    "read",
    "View token list (masked)",
    "Identity",
    "low",
  ],
  // Policy & scanner
  ["policy:read", "policy", "read", "Read global policy", "Security", "low"],
  [
    "policy:write",
    "policy",
    "write",
    "Modify global policy",
    "Security",
    "critical",
  ],
  [
    "scanner:configure",
    "scanner",
    "configure",
    "Configure scanner thresholds",
    "Security",
    "critical",
  ],
  ["scanner:read", "scanner", "read", "View scanner config", "Security", "low"],
  [
    "file_restrictions:manage",
    "file_restrictions",
    "manage",
    "Manage file restrictions",
    "Security",
    "high",
  ],
  // Approvals
  [
    "approval:resolve",
    "approval",
    "approve",
    "Resolve approval requests",
    "Security",
    "high",
  ],
  [
    "approval:read",
    "approval",
    "read",
    "View approval history",
    "Security",
    "low",
  ],
  // Providers & vault
  [
    "provider:manage",
    "provider",
    "manage",
    "Add and remove BYOK providers",
    "Vault",
    "critical",
  ],
  [
    "provider:read",
    "provider",
    "read",
    "View available providers (masked)",
    "Vault",
    "low",
  ],
  // Logs & audit
  ["log:read_all", "log", "read", "View all request logs", "Audit", "medium"],
  ["log:read_own", "log", "read", "View own request logs only", "Audit", "low"],
  ["log:export", "log", "export", "Export logs as JSON/CSV", "Audit", "high"],
  [
    "audit:read",
    "admin_audit",
    "read",
    "View admin audit log",
    "Audit",
    "high",
  ],
  // Developer tools
  [
    "agent:use",
    "agent",
    "execute",
    "Use chat and agent in IDE",
    "Developer",
    "low",
  ],
  [
    "terminal:execute",
    "terminal",
    "execute",
    "Run terminal commands",
    "Developer",
    "high",
  ],
  [
    "subagent:spawn",
    "subagent",
    "execute",
    "Spawn sub-agents",
    "Developer",
    "high",
  ],
  ["mcp:use", "mcp", "execute", "Use MCP servers", "Developer", "medium"],
  [
    "web_search:use",
    "web_search",
    "execute",
    "Use web search tool",
    "Developer",
    "low",
  ],
  [
    "autocomplete:use",
    "autocomplete",
    "execute",
    "Use autocomplete",
    "Developer",
    "low",
  ],
  // Stats
  [
    "credit:read",
    "credit",
    "read",
    "View credit usage and limits",
    "Organisation",
    "low",
  ],
  [
    "stats:read",
    "stats",
    "read",
    "View usage analytics",
    "Organisation",
    "low",
  ],

  // ─── Uniform action model (view/create/edit/delete/export) ─────────
  //
  // These atoms match the spec for the role-matrix UI. They sit
  // alongside the legacy atoms above (unchanged to avoid breaking
  // existing `requireCapability("org:write")` checks) so the matrix
  // UI has a clean permission space to display while routes continue
  // to work. Over time, routes should migrate to the uniform atoms.
  //
  // Resource groupings (matches the UI's category sections):
  //   Organisation : workspace settings, billing
  //   Identity     : users, roles, tokens
  //   Security     : policies, scanners, file restrictions, approvals
  //   Vault        : providers
  //   Audit        : logs, audit trail
  //   Developer    : chat, agents, tools, MCP

  // Users
  ["users:view", "users", "view", "View user list and profiles", "Identity", "low"],
  ["users:create", "users", "create", "Invite new users", "Identity", "high"],
  ["users:edit", "users", "edit", "Edit user profiles and role assignments", "Identity", "high"],
  ["users:delete", "users", "delete", "Remove users from the org", "Identity", "high"],
  ["users:export", "users", "export", "Export the user directory", "Identity", "medium"],

  // Roles
  ["roles:view", "roles", "view", "View roles and permissions", "Identity", "low"],
  ["roles:create", "roles", "create", "Create custom roles", "Identity", "critical"],
  ["roles:edit", "roles", "edit", "Edit custom roles + assign to users", "Identity", "critical"],
  ["roles:delete", "roles", "delete", "Delete custom roles", "Identity", "critical"],

  // Teams (uniform re-expression)
  ["teams:view", "teams", "view", "View team list and membership", "Organisation", "low"],
  ["teams:create", "teams", "create", "Create new teams", "Organisation", "high"],
  ["teams:edit", "teams", "edit", "Edit team name and members", "Organisation", "medium"],
  ["teams:delete", "teams", "delete", "Delete teams", "Organisation", "high"],
  ["teams:export", "teams", "export", "Export team roster", "Organisation", "low"],

  // Organisation settings
  ["org_settings:view", "org_settings", "view", "View org name, slug, settings", "Organisation", "low"],
  ["org_settings:edit", "org_settings", "edit", "Edit org name, slug, industry, etc.", "Organisation", "critical"],

  // Billing
  ["billing:view", "billing", "view", "View billing + credit usage", "Organisation", "low"],
  ["billing:edit", "billing", "edit", "Change billing details, top up credits", "Organisation", "critical"],
  ["billing:export", "billing", "export", "Export billing history", "Organisation", "medium"],

  // Policies
  ["policies:view", "policies", "view", "View the active policy", "Security", "low"],
  ["policies:edit", "policies", "edit", "Edit scanner rules and thresholds", "Security", "critical"],
  ["policies:export", "policies", "export", "Export policy snapshots", "Security", "medium"],

  // Providers (BYOK)
  ["providers:view", "providers", "view", "View configured providers (masked)", "Vault", "low"],
  ["providers:create", "providers", "create", "Add new BYOK providers", "Vault", "critical"],
  ["providers:edit", "providers", "edit", "Edit provider keys and base URLs", "Vault", "critical"],
  ["providers:delete", "providers", "delete", "Remove providers", "Vault", "critical"],

  // Audit logs
  ["audit_logs:view", "audit_logs", "view", "View the request + admin audit log", "Audit", "medium"],
  ["audit_logs:export", "audit_logs", "export", "Export audit logs (CSV/JSON)", "Audit", "high"],

  // Approvals
  ["approvals:view", "approvals", "view", "View pending + resolved approvals", "Security", "low"],
  ["approvals:edit", "approvals", "edit", "Resolve approval requests", "Security", "high"],

  // File restrictions
  ["file_restrictions:view", "file_restrictions", "view", "View file scope rules", "Security", "low"],
  ["file_restrictions:edit", "file_restrictions", "edit", "Edit org/team/user file scope", "Security", "high"],

  // Agents + chat + MCP (developer capabilities)
  ["chat:view", "chat", "view", "Read chat history", "Developer", "low"],
  ["chat:create", "chat", "create", "Send prompts to the agent", "Developer", "low"],
  ["agents:view", "agents", "view", "View agent runs", "Developer", "low"],
  ["agents:create", "agents", "create", "Spawn agents / sub-agents", "Developer", "high"],
  ["mcp_tools:view", "mcp_tools", "view", "List configured MCP tools", "Developer", "low"],
  ["mcp_tools:create", "mcp_tools", "create", "Register new MCP tools", "Developer", "high"],
  ["mcp_tools:delete", "mcp_tools", "delete", "Remove MCP tools", "Developer", "high"],
];
for (const [name, resource, action, desc, category, risk] of caps) {
  seedCap.run(name, resource, action, desc, category, risk, now);
}

// Seed role_capabilities for built-in roles
const adminRole = db
  .prepare("SELECT id FROM roles WHERE name = 'admin' AND org_id IS NULL")
  .get() as { id: number } | undefined;
const secLeadRole = db
  .prepare(
    "SELECT id FROM roles WHERE name = 'security_lead' AND org_id IS NULL",
  )
  .get() as { id: number } | undefined;
const devRole = db
  .prepare("SELECT id FROM roles WHERE name = 'developer' AND org_id IS NULL")
  .get() as { id: number } | undefined;
const auditorRole = db
  .prepare("SELECT id FROM roles WHERE name = 'auditor' AND org_id IS NULL")
  .get() as { id: number } | undefined;

const seedRoleCap = db.prepare(
  "INSERT OR IGNORE INTO role_capabilities (role_id, capability_name, scope, granted, created_at) VALUES (?, ?, ?, 1, ?)",
);

// Admin gets everything
if (adminRole) {
  for (const [capName] of caps) {
    seedRoleCap.run(adminRole.id, capName, "org", now);
  }
}

/**
 * For the 3 non-admin system roles we compute their capability set
 * from two inputs:
 *   - A per-role exclude list of specific cap names
 *   - A per-role include list of ADDITIONAL cap names
 *
 * The base is `caps.filter(not in excludes)` + explicit includes.
 * Uses the uniform-action atoms from the spec so the matrix UI
 * renders sensible defaults for every system role.
 */
function seedRoleWithCaps(
  roleId: number,
  opts: {
    excludeLegacy?: string[];
    allowAllLegacyRead?: boolean;
    allowAllLegacyReadExport?: boolean;
    uniformGrants?: string[];
  },
): void {
  if (opts.allowAllLegacyReadExport) {
    // Auditor-style: every legacy read/export atom + every uniform view
    for (const [n, , action] of caps) {
      if (["read", "export"].includes(action)) {
        seedRoleCap.run(roleId, n, "org", now);
      }
    }
  } else if (opts.allowAllLegacyRead) {
    // Read-mostly: every legacy read atom
    for (const [n, , action] of caps) {
      if (action === "read") {
        seedRoleCap.run(roleId, n, "org", now);
      }
    }
  } else if (opts.excludeLegacy) {
    const excl = new Set(opts.excludeLegacy);
    for (const [n] of caps) {
      if (!excl.has(n)) seedRoleCap.run(roleId, n, "org", now);
    }
  }
  if (opts.uniformGrants) {
    for (const capName of opts.uniformGrants) {
      seedRoleCap.run(roleId, capName, "org", now);
    }
  }
}

// Security lead — everything EXCEPT user/role/provider management
// (those stay admin-only). Gets full policy, audit, approvals, and
// developer tools.
if (secLeadRole) {
  seedRoleWithCaps(secLeadRole.id, {
    excludeLegacy: [
      // legacy atoms to keep out
      "org:write",
      "billing:write",
      "user:invite",
      "user:remove",
      "role:assign",
      "role:manage",
      "provider:manage",
    ],
    uniformGrants: [
      // explicit uniform grants
      "users:view",
      "roles:view",
      "teams:view",
      "teams:edit",
      "org_settings:view",
      "billing:view",
      "policies:view",
      "policies:edit",
      "policies:export",
      "providers:view",
      "audit_logs:view",
      "audit_logs:export",
      "approvals:view",
      "approvals:edit",
      "file_restrictions:view",
      "file_restrictions:edit",
      "chat:view",
      "chat:create",
      "agents:view",
      "agents:create",
      "mcp_tools:view",
    ],
  });
  // Remove the uniform write atoms we DON'T want the filter to grant.
  const blockedUniform = [
    "users:create",
    "users:edit",
    "users:delete",
    "users:export",
    "roles:create",
    "roles:edit",
    "roles:delete",
    "teams:create",
    "teams:delete",
    "teams:export",
    "org_settings:edit",
    "billing:edit",
    "billing:export",
    "providers:create",
    "providers:edit",
    "providers:delete",
    "mcp_tools:create",
    "mcp_tools:delete",
  ];
  const del = db.prepare(
    "DELETE FROM role_capabilities WHERE role_id = ? AND capability_name = ?",
  );
  for (const c of blockedUniform) del.run(secLeadRole.id, c);
}

// Developer — limited to chat, agents, MCP. View-only on everything
// else. Cannot edit policy, cannot invite users.
if (devRole) {
  seedRoleWithCaps(devRole.id, {
    uniformGrants: [
      "chat:view",
      "chat:create",
      "agents:view",
      "agents:create",
      "mcp_tools:view",
      "users:view",
      "roles:view",
      "teams:view",
      "policies:view",
      "providers:view",
      "audit_logs:view",
      "org_settings:view",
      "billing:view",
    ],
  });
  // Also keep the legacy developer atoms so existing route checks
  // for `requireCapability("agent:use")`, `terminal:execute`, etc.
  // continue working.
  const legacyDev = [
    "org:read",
    "team:read",
    "user:read",
    "token:create",
    "token:read",
    "policy:read",
    "scanner:read",
    "provider:read",
    "approval:read",
    "log:read_own",
    "agent:use",
    "terminal:execute",
    "subagent:spawn",
    "mcp:use",
    "web_search:use",
    "autocomplete:use",
    "credit:read",
    "stats:read",
  ];
  for (const capName of legacyDev) {
    seedRoleCap.run(
      devRole.id,
      capName,
      capName.endsWith("_own") ? "own" : "org",
      now,
    );
  }
}

// Auditor — read everything + export audit logs, no edits or tools.
if (auditorRole) {
  seedRoleWithCaps(auditorRole.id, {
    allowAllLegacyReadExport: true,
    uniformGrants: [
      "users:view",
      "roles:view",
      "teams:view",
      "teams:export",
      "policies:view",
      "policies:export",
      "providers:view",
      "audit_logs:view",
      "audit_logs:export",
      "approvals:view",
      "file_restrictions:view",
      "chat:view",
      "agents:view",
      "mcp_tools:view",
      "org_settings:view",
      "billing:view",
      "billing:export",
      "users:export",
    ],
  });
}

// Migration: seed user_org_roles from existing users.role
const usersWithRoles = db
  .prepare(
    "SELECT u.id, u.org_id, u.role FROM users u WHERE u.org_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM user_org_roles uor WHERE uor.user_id = u.id AND uor.org_id = u.org_id)",
  )
  .all() as Array<{ id: number; org_id: number; role: string }>;

for (const u of usersWithRoles) {
  const role = db
    .prepare("SELECT id FROM roles WHERE name = ? AND org_id IS NULL")
    .get(u.role) as { id: number } | undefined;
  if (role) {
    db.prepare(
      "INSERT OR IGNORE INTO user_org_roles (user_id, org_id, role_id, created_at) VALUES (?, ?, ?, ?)",
    ).run(u.id, u.org_id, role.id, now);
  }
}

// Policy inheritance chain (org → team → project)
db.exec(`
CREATE TABLE IF NOT EXISTS policies (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  scope_type  TEXT NOT NULL CHECK(scope_type IN ('global','org','team','project')),
  scope_id    INTEGER,
  policy_json TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  UNIQUE(scope_type, scope_id)
);
`);

// Role-scoped policies.
//
// Separate table because:
//   1. The `policies` table's scope_id is INTEGER (FK to org/team); role
//      is identified by its name (unique per org) — not a DB row id.
//   2. Role policies are always nested under an org (a "developer" in
//      org A is a different scope from "developer" in org B).
//   3. The existing CHECK constraint on policies.scope_type would need
//      a table rebuild to extend — a separate table is cheaper.
//
// Semantics: merged AFTER the org override and BEFORE team/project
// overrides. Strictest-wins, so a role policy can only tighten the
// org baseline, never relax it.
//
// The `role` column stores the role NAME (not a FK) so this table
// works for both system roles (`admin`, `developer`, etc.) and custom
// roles created via the RBAC UI — role names are unique per org via
// the `roles.UNIQUE(org_id, name)` constraint.
db.exec(`
CREATE TABLE IF NOT EXISTS role_policies (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id      INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  role        TEXT NOT NULL,
  policy_json TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  UNIQUE(org_id, role)
);
CREATE INDEX IF NOT EXISTS idx_role_policies_org ON role_policies(org_id);
`);

// Migration: drop the legacy CHECK constraint that restricted `role`
// to the 4 system role names. SQLite doesn't support DROP CHECK, so
// we rebuild the table if the old constraint is still in place.
try {
  const meta = db
    .prepare(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='role_policies'",
    )
    .get() as { sql: string } | undefined;
  if (meta?.sql && meta.sql.includes("CHECK(role IN (")) {
    db.exec(`
      CREATE TABLE role_policies_new (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        org_id      INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        role        TEXT NOT NULL,
        policy_json TEXT NOT NULL,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL,
        UNIQUE(org_id, role)
      );
      INSERT INTO role_policies_new (id, org_id, role, policy_json, created_at, updated_at)
        SELECT id, org_id, role, policy_json, created_at, updated_at FROM role_policies;
      DROP TABLE role_policies;
      ALTER TABLE role_policies_new RENAME TO role_policies;
      CREATE INDEX IF NOT EXISTS idx_role_policies_org ON role_policies(org_id);
    `);
  }
} catch {
  /* fresh DB — the block above created it without the constraint */
}

// SSO pending states (moved from in-memory Map)
db.exec(`
CREATE TABLE IF NOT EXISTS sso_pending_states (
  state       TEXT PRIMARY KEY,
  provider    TEXT,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL
);
`);

// Per-org/team/user file restrictions
db.exec(`
CREATE TABLE IF NOT EXISTS file_restrictions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  team_id INTEGER REFERENCES teams(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'blocklist' CHECK(mode IN ('blocklist','allowlist')),
  patterns TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_fr_org ON file_restrictions(org_id);
CREATE INDEX IF NOT EXISTS idx_fr_team ON file_restrictions(team_id);
CREATE INDEX IF NOT EXISTS idx_fr_user ON file_restrictions(user_id);
`);

// ── Settings KV table (privacy settings, feature config) ──────
db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
`);

export default db;
