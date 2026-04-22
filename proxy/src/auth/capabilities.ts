/**
 * Central capability-name constants (P13).
 *
 * Every capability the RBAC layer understands has its canonical name
 * registered here. Route files MUST pass one of these constants to
 * `requireCapability`, not a raw string — this turns spelling drift
 * (e.g. `policies.edit` vs the seeded `policies:edit`) from a silent
 * 403 into a compile-time error.
 *
 * Kept in lockstep with the seed block in `proxy/src/db/database.ts`
 * (search for `const caps: Array<[string, string, ...`). When adding
 * a new capability to that seed, add a matching entry here — the TS
 * union type will then surface every usage site that needs updating.
 */

export const CAP = {
  // ── Organisation & billing ─────────────────────────────────────────
  org_read: "org:read",
  org_write: "org:write",
  org_settings_view: "org_settings:view",
  org_settings_edit: "org_settings:edit",
  billing_read: "billing:read",
  billing_write: "billing:write",
  billing_view: "billing:view",
  billing_edit: "billing:edit",
  billing_export: "billing:export",
  credit_read: "credit:read",

  // ── Teams ──────────────────────────────────────────────────────────
  team_read: "team:read",
  team_create: "teams:create",
  team_write: "team:write",
  team_delete: "team:delete",
  teams_view: "teams:view",
  teams_edit: "teams:edit",
  teams_delete: "teams:delete",
  teams_export: "teams:export",

  // ── Identity: users, roles, tokens ─────────────────────────────────
  user_invite: "user:invite",
  user_remove: "user:remove",
  user_read: "user:read",
  users_create: "users:create",
  users_edit: "users:edit",
  users_delete: "users:delete",
  users_view: "users:view",
  users_export: "users:export",
  role_assign: "role:assign",
  role_manage: "role:manage",
  roles_create: "roles:create",
  roles_edit: "roles:edit",
  roles_delete: "roles:delete",
  roles_view: "roles:view",
  token_create: "token:create",
  token_revoke: "token:revoke",
  token_read: "token:read",

  // ── Policies & file restrictions ───────────────────────────────────
  policy_read: "policy:read",
  policy_write: "policy:write",
  policies_view: "policies:view",
  policies_edit: "policies:edit",
  policies_export: "policies:export",
  file_restrictions_view: "file_restrictions:view",
  file_restrictions_edit: "file_restrictions:edit",
  file_restrictions_manage: "file_restrictions:manage",

  // ── Providers & models ─────────────────────────────────────────────
  provider_manage: "provider:manage",
  provider_read: "provider:read",
  providers_view: "providers:view",
  providers_create: "providers:create",
  providers_edit: "providers:edit",
  providers_delete: "providers:delete",

  // ── Scanning / security ────────────────────────────────────────────
  scanner_read: "scanner:read",
  scanner_configure: "scanner:configure",
  audit_read: "audit:read",
  audit_logs_view: "audit_logs:view",
  audit_logs_export: "audit_logs:export",
  log_read_own: "log:read_own",
  stats_read: "stats:read",

  // ── Approvals ──────────────────────────────────────────────────────
  approval_read: "approval:read",
  approval_resolve: "approval:resolve",
  approvals_view: "approvals:view",
  approvals_edit: "approvals:edit",

  // ── Agents, tools & chat ───────────────────────────────────────────
  agents_view: "agents:view",
  agents_create: "agents:create",
  agent_use: "agent:use",
  autocomplete_use: "autocomplete:use",
  chat_create: "chat:create",
  chat_view: "chat:view",
  mcp_use: "mcp:use",
  mcp_tools_view: "mcp_tools:view",
  mcp_tools_create: "mcp_tools:create",
  mcp_tools_delete: "mcp_tools:delete",
  subagent_spawn: "subagent:spawn",
  terminal_execute: "terminal:execute",
  web_search_use: "web_search:use",
} as const;

/**
 * Union of every canonical capability name.
 *
 * Use this as the parameter type in `requireCapability` so passing a
 * misspelled string is a compile error instead of a silent 403.
 */
export type CapabilityName = (typeof CAP)[keyof typeof CAP];
