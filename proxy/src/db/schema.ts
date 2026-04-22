import { sqliteTable, integer, text, real } from "drizzle-orm/sqlite-core";

export const logs = sqliteTable("logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  timestamp: integer("timestamp").notNull(),
  model: text("model").notNull(),
  provider: text("provider").notNull(),
  originalHash: text("original_hash").notNull(),
  sanitizedText: text("sanitized_text").notNull(),
  secretsFound: integer("secrets_found").default(0),
  piiFound: integer("pii_found").default(0),
  entropyFound: integer("entropy_found").default(0),
  filesBlocked: integer("files_blocked").default(0),
  riskScore: integer("risk_score").default(0),
  action: text("action").notNull(),
  reasons: text("reasons"),
  responseTimeMs: integer("response_time_ms"),
  userId: integer("user_id"),
  teamId: integer("team_id"),
  prevHash: text("prev_hash"),
});

export const organizations = sqliteTable("organizations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  /**
   * Free-text industry label captured in the onboarding wizard's Step 2.
   * Purely metadata — never used for policy decisions.
   */
  industry: text("industry"),
  createdAt: integer("created_at").notNull(),
});

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").default("developer").notNull(),
  orgId: integer("org_id").references(() => organizations.id, {
    onDelete: "set null",
  }),
  /**
   * 0 until the user has finished the post-signup onboarding wizard
   * (workspace type, policy config, providers, etc.). The web dashboard
   * gates access to /dashboard on this flag and redirects to /onboarding
   * when 0.
   */
  onboardingComplete: integer("onboarding_complete").notNull().default(0),
  /**
   * IANA timezone (e.g. "America/Los_Angeles") captured in the
   * onboarding wizard's Step 2. Nullable — SSO users may not have
   * set it.
   */
  timezone: text("timezone"),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const apiTokens = sqliteTable("api_tokens", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  name: text("name").notNull(),
  scopes: text("scopes"),
  orgId: integer("org_id").references(() => organizations.id, {
    onDelete: "cascade",
  }),
  teamId: integer("team_id").references(() => teams.id, {
    onDelete: "cascade",
  }),
  lastUsedAt: integer("last_used_at"),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at"),
  rotatedFromId: integer("rotated_from_id"),
});

export const providers = sqliteTable("providers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  /**
   * `slug` was `.unique()` pre-multitenancy. Dropped here because two
   * orgs can legitimately configure a provider with the same slug
   * (e.g. both hold "openai"). Uniqueness is now `(org_id, slug)`,
   * enforced by a composite index created in the inline migration in
   * `database.ts`.
   */
  slug: text("slug").notNull(),
  baseUrl: text("base_url").notNull(),
  apiKeyEncrypted: text("api_key_encrypted").notNull(),
  enabled: integer("enabled").default(1),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  /**
   * Multi-tenancy scoping column (added post-launch). Nullable only
   * to keep the backfill migration idempotent; after the inline
   * backfill in `database.ts` every row has a non-null value and
   * new inserts always pass one. Routes filter by this column so a
   * provider registered for org A can never leak into org B's view.
   */
  orgId: integer("org_id").references(() => organizations.id, {
    onDelete: "cascade",
  }),
});

export const models = sqliteTable("models", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  providerId: integer("provider_id")
    .notNull()
    .references(() => providers.id, { onDelete: "cascade" }),
  modelName: text("model_name").notNull(),
  displayName: text("display_name"),
  inputCostPer1k: real("input_cost_per_1k").default(0),
  outputCostPer1k: real("output_cost_per_1k").default(0),
  maxContextTokens: integer("max_context_tokens").default(0),
  enabled: integer("enabled").default(1),
});

export const credits = sqliteTable("credits", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  providerId: integer("provider_id").references(() => providers.id, {
    onDelete: "cascade",
  }),
  modelId: integer("model_id").references(() => models.id, {
    onDelete: "cascade",
  }),
  limitType: text("limit_type").notNull(),
  totalLimit: real("total_limit").notNull(),
  usedAmount: real("used_amount").default(0),
  resetPeriod: text("reset_period").notNull(),
  resetDate: integer("reset_date").notNull(),
  hardLimit: integer("hard_limit").default(1),
  createdAt: integer("created_at").notNull(),
});

export const usageLogs = sqliteTable("usage_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  logId: integer("log_id").references(() => logs.id),
  providerId: integer("provider_id")
    .notNull()
    .references(() => providers.id),
  modelName: text("model_name").notNull(),
  inputTokens: integer("input_tokens").default(0),
  outputTokens: integer("output_tokens").default(0),
  totalTokens: integer("total_tokens").default(0),
  cost: real("cost").default(0),
  timestamp: integer("timestamp").notNull(),
  userId: integer("user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  teamId: integer("team_id"),
});

export const adminAudit = sqliteTable("admin_audit", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  timestamp: integer("timestamp").notNull(),
  userId: integer("user_id"),
  action: text("action").notNull(),
  details: text("details"),
});

export const auditQueue = sqliteTable("audit_queue", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  createdAt: integer("created_at").notNull(),
  submitterId: integer("submitter_id"),
  snippetMasked: text("snippet_masked").notNull(),
  metadata: text("metadata"),
  blindmiScore: real("blindmi_score").default(0),
  githubHits: integer("github_hits").default(0),
  status: text("status").default("pending"),
  reviewerId: integer("reviewer_id"),
  reviewedAt: integer("reviewed_at"),
  action: text("action"),
  notes: text("notes"),
});

export const ssoSessions = sqliteTable("sso_sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  externalId: text("external_id").notNull(),
  accessTokenEncrypted: text("access_token_encrypted"),
  refreshTokenEncrypted: text("refresh_token_encrypted"),
  expiresAt: integer("expires_at"),
  createdAt: integer("created_at").notNull(),
});

export const webhooks = sqliteTable("webhooks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orgId: integer("org_id").references(() => organizations.id, {
    onDelete: "cascade",
  }),
  url: text("url").notNull(),
  events: text("events").notNull(),
  secret: text("secret"),
  enabled: integer("enabled").default(1),
  createdAt: integer("created_at").notNull(),
});

export const orgModelRules = sqliteTable("org_model_rules", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orgId: integer("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  modelPattern: text("model_pattern").notNull(),
  ruleType: text("rule_type").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const rateLimits = sqliteTable("rate_limits", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").references(() => users.id, {
    onDelete: "cascade",
  }),
  orgId: integer("org_id").references(() => organizations.id, {
    onDelete: "cascade",
  }),
  maxRequestsPerMinute: integer("max_requests_per_minute").default(30),
  maxTokensPerMinute: integer("max_tokens_per_minute").default(100000),
  createdAt: integer("created_at").notNull(),
});

export const mcpAudit = sqliteTable("mcp_audit", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  timestamp: integer("timestamp").notNull(),
  serverName: text("server_name").notNull(),
  toolName: text("tool_name").notNull(),
  direction: text("direction").notNull(),
  action: text("action").notNull(),
  riskScore: integer("risk_score").default(0),
  secretsFound: integer("secrets_found").default(0),
  piiFound: integer("pii_found").default(0),
  injectionScore: integer("injection_score").default(0),
  reasons: text("reasons"),
  scanTimeMs: integer("scan_time_ms").default(0),
});

export const approvalRequests = sqliteTable("approval_requests", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").references(() => users.id, {
    onDelete: "cascade",
  }),
  actionType: text("action_type").notNull(),
  resource: text("resource").notNull(),
  contextJson: text("context_json"),
  status: text("status").notNull().default("pending"),
  resolvedByDevice: text("resolved_by_device"),
  resolvedAt: integer("resolved_at"),
  createdAt: integer("created_at").notNull(),
});

export const approvalRules = sqliteTable("approval_rules", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").references(() => users.id, {
    onDelete: "cascade",
  }),
  resourcePattern: text("resource_pattern").notNull(),
  actionType: text("action_type").notNull(),
  decision: text("decision").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const notificationChannels = sqliteTable("notification_channels", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").references(() => users.id, {
    onDelete: "cascade",
  }),
  channelType: text("channel_type").notNull(),
  configJson: text("config_json").notNull(),
  enabled: integer("enabled").default(1),
  createdAt: integer("created_at").notNull(),
});

export const webpushSubscriptions = sqliteTable("webpush_subscriptions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").references(() => users.id, {
    onDelete: "cascade",
  }),
  endpoint: text("endpoint").notNull().unique(),
  keysJson: text("keys_json").notNull(),
  deviceId: text("device_id"),
  createdAt: integer("created_at").notNull(),
});

export const activeSessions = sqliteTable("active_sessions", {
  id: text("id").primaryKey(),
  userId: integer("user_id").references(() => users.id, {
    onDelete: "cascade",
  }),
  deviceId: text("device_id").notNull(),
  deviceType: text("device_type").notNull(),
  model: text("model"),
  startedAt: integer("started_at").notNull(),
  lastActivityAt: integer("last_activity_at").notNull(),
});

export const webhookDeliveries = sqliteTable("webhook_deliveries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  webhookId: integer("webhook_id")
    .notNull()
    .references(() => webhooks.id, { onDelete: "cascade" }),
  event: text("event").notNull(),
  payloadHash: text("payload_hash").notNull(),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").default(0),
  nextRetryAt: integer("next_retry_at"),
  lastError: text("last_error"),
  createdAt: integer("created_at").notNull(),
  deliveredAt: integer("delivered_at"),
});

export const fileScanCache = sqliteTable("file_scan_cache", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  filePath: text("file_path").notNull(),
  fileHash: text("file_hash").notNull(),
  fileSize: integer("file_size").notNull(),
  action: text("action").notNull(),
  riskScore: integer("risk_score").default(0),
  secretsFound: integer("secrets_found").default(0),
  piiFound: integer("pii_found").default(0),
  entropyFound: integer("entropy_found").default(0),
  scanResult: text("scan_result").notNull(),
  scannedAt: integer("scanned_at").notNull(),
});

// ── Policy Inheritance ────────────────────────────────────────────────

export const policies = sqliteTable("policies", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  scopeType: text("scope_type").notNull(),
  scopeId: integer("scope_id"),
  policyJson: text("policy_json").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

// ── SSO Pending States ────────────────────────────────────────────────

export const ssoPendingStates = sqliteTable("sso_pending_states", {
  state: text("state").primaryKey(),
  provider: text("provider"),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
});

// ── RBAC ──────────────────────────────────────────────────────────────

export const roles = sqliteTable("roles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orgId: integer("org_id").references(() => organizations.id, {
    onDelete: "cascade",
  }),
  name: text("name").notNull(),
  displayName: text("display_name").notNull(),
  description: text("description"),
  isSystem: integer("is_system").notNull().default(0),
  isCustom: integer("is_custom").notNull().default(0),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const capabilities = sqliteTable("capabilities", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  resource: text("resource").notNull(),
  action: text("action").notNull(),
  description: text("description"),
  category: text("category").notNull(),
  riskLevel: text("risk_level").notNull().default("low"),
  createdAt: integer("created_at").notNull(),
});

export const roleCapabilities = sqliteTable("role_capabilities", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  roleId: integer("role_id")
    .notNull()
    .references(() => roles.id, { onDelete: "cascade" }),
  capabilityName: text("capability_name").notNull(),
  scope: text("scope").notNull().default("org"),
  granted: integer("granted").notNull().default(1),
  createdAt: integer("created_at").notNull(),
});

export const userOrgRoles = sqliteTable("user_org_roles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  orgId: integer("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  roleId: integer("role_id")
    .notNull()
    .references(() => roles.id, { onDelete: "cascade" }),
  grantedBy: integer("granted_by").references(() => users.id, {
    onDelete: "set null",
  }),
  expiresAt: integer("expires_at"),
  createdAt: integer("created_at").notNull(),
});

export const userTeamRoles = sqliteTable("user_team_roles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  teamId: integer("team_id").notNull(),
  roleId: integer("role_id")
    .notNull()
    .references(() => roles.id, { onDelete: "cascade" }),
  grantedBy: integer("granted_by").references(() => users.id, {
    onDelete: "set null",
  }),
  expiresAt: integer("expires_at"),
  createdAt: integer("created_at").notNull(),
});

export const userCapabilityOverrides = sqliteTable(
  "user_capability_overrides",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    orgId: integer("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    capabilityName: text("capability_name").notNull(),
    granted: integer("granted").notNull().default(1),
    reason: text("reason").notNull(),
    grantedBy: integer("granted_by").notNull(),
    expiresAt: integer("expires_at"),
    createdAt: integer("created_at").notNull(),
  },
);

export const permissionAuditLog = sqliteTable("permission_audit_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(),
  orgId: integer("org_id").notNull(),
  teamId: integer("team_id"),
  capabilityName: text("capability_name").notNull(),
  action: text("action").notNull(),
  result: text("result").notNull(),
  reason: text("reason"),
  roleIdUsed: integer("role_id_used"),
  tokenId: integer("token_id"),
  ipAddress: text("ip_address"),
  requestId: text("request_id"),
  prevHash: text("prev_hash"),
  rowHash: text("row_hash"),
  ts: integer("ts").notNull(),
});

// ── Teams ─────────────────────────────────────────────────────────────

export const teams = sqliteTable("teams", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orgId: integer("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  slug: text("slug").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const teamMembers = sqliteTable("team_members", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  teamId: integer("team_id")
    .notNull()
    .references(() => teams.id, { onDelete: "cascade" }),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  role: text("role").notNull().default("member"),
  joinedAt: integer("joined_at").notNull(),
});

// ── File Restrictions ─────────────────────────────────────────────────

export const fileRestrictions = sqliteTable("file_restrictions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orgId: integer("org_id")
    .notNull()
    .references(() => organizations.id, { onDelete: "cascade" }),
  teamId: integer("team_id"),
  userId: integer("user_id"),
  mode: text("mode").notNull().default("blocklist"),
  patterns: text("patterns").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

// ── Vault ─────────────────────────────────────────────────────────────

export const tokenVault = sqliteTable("token_vault", {
  tokenId: text("token_id").primaryKey(),
  encrypted: text("encrypted").notNull(),
  iv: text("iv").notNull(),
  tag: text("tag").notNull(),
  type: text("type").notNull(),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at"),
});

// ── Tasks (Agent Core) ────────────────────────────────────────────────

export const tasks = sqliteTable("tasks", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  status: text("status").notNull().default("pending"),
  description: text("description").notNull(),
  userId: integer("user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  agentId: text("agent_id"),
  parentTaskId: text("parent_task_id"),
  model: text("model"),
  prompt: text("prompt"),
  worktreePath: text("worktree_path"),
  progressJson: text("progress_json"),
  error: text("error"),
  resultSummary: text("result_summary"),
  startedAt: integer("started_at").notNull(),
  completedAt: integer("completed_at"),
  notified: integer("notified").default(0),
});

// Phase J.J2 (SECURITY_HARDENING_PLAN.md): MCP project trust store.
// Tracks user trust decisions for each `.mcp.json` fingerprint so a
// changed config invalidates the prior approval and re-prompts.
export const mcpTrust = sqliteTable("mcp_trust", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectPath: text("project_path").notNull(),
  sourcePath: text("source_path").notNull(),
  fingerprint: text("fingerprint").notNull(),
  decision: text("decision").notNull().default("pending"),
  decidedAt: integer("decided_at").notNull(),
  decidedByUserId: integer("decided_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
});

// Phase I.I3 (SECURITY_HARDENING_PLAN.md): async subagent state channel.
// Lives outside the message log so entries survive compaction + proxy restart.
export const asyncTasks = sqliteTable("async_tasks", {
  id: text("id").primaryKey(),
  parentSession: text("parent_session").notNull(),
  name: text("name"),
  prompt: text("prompt").notNull(),
  model: text("model"),
  status: text("status").notNull().default("pending"),
  progress: integer("progress").default(0),
  resultJson: text("result_json"),
  error: text("error"),
  createdAt: integer("created_at").notNull(),
  startedAt: integer("started_at"),
  completedAt: integer("completed_at"),
  lastCheckedAt: integer("last_checked_at"),
});
