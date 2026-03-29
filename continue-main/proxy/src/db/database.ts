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
  last_used_at INTEGER,
  created_at INTEGER NOT NULL,
  expires_at INTEGER
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
`);

// Migration: add entropy_found column to logs if it doesn't exist
try {
  db.prepare("SELECT entropy_found FROM logs LIMIT 1").get();
} catch {
  db.exec("ALTER TABLE logs ADD COLUMN entropy_found INTEGER DEFAULT 0");
}

export default db;
