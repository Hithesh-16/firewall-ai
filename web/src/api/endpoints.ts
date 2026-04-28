/**
 * Canonical API endpoint map.
 *
 * Rule: NEVER hardcode a `/api/...` path at a call site. Import the
 * constant (or path-builder) from here and pass it to `apiClient.get/
 * post/put/del`. Adding a new backend route means adding an entry here
 * first, then using it at the call site.
 *
 * Parameterized endpoints are exposed as functions so TypeScript can
 * enforce the shape of the ids at the call site:
 *
 *   apiClient.del(ENDPOINTS.rbac.role(roleId))
 *
 * Grouped by domain to keep the file navigable as the API grows.
 */

export const ENDPOINTS = {
  // ── Health ────────────────────────────────────────────────────────
  health: "/health",

  // ── Auth ──────────────────────────────────────────────────────────
  auth: {
    login: "/api/auth/login",
    register: "/api/auth/register",
    logout: "/api/auth/logout",
    me: "/api/auth/me",
    ssoConfig: "/api/auth/sso/config",
    handoff: "/api/auth/handoff",
  },

  // ── Current user (self) ───────────────────────────────────────────
  me: {
    permissions: "/api/me/permissions",
    profile: "/api/users/me",
    assistant: "/api/me/assistant",
    defaultAssistant: "/api/me/assistants/default",
    models: "/api/me/models",
    modelsList: "/api/me/models/list",
    modelsAdd: "/api/me/models/add",
    modelsDetect: "/api/me/models/detect",
    model: (id: string) => `/api/me/models/${encodeURIComponent(id)}`,
    provider: (slug: string) => `/api/me/providers/${encodeURIComponent(slug)}`,
    /** List of the caller's personal + their org's providers. Use
     *  this (not `providers.root`) in user-facing surfaces so data
     *  is properly scoped — /api/providers returns the global table
     *  unscoped and leaks across orgs. */
    providers: "/api/me/providers",
    onboardingComplete: "/api/users/me/onboarding/complete",
    // Org rules + skills the caller can browse + install. The
    // `installRule`/`installSkill` builders take the numeric row id
    // returned by the list endpoint (NOT the slug) because that's
    // the stable reference across renames.
    rules: "/api/me/rules",
    rule: (slug: string) => `/api/me/rules/${encodeURIComponent(slug)}`,
    installRule: (id: string | number) => `/api/me/rules/${id}/install`,
    toggleRule: (id: string | number) => `/api/me/rules/${id}`,
    skills: "/api/me/skills",
    skill: (slug: string) => `/api/me/skills/${encodeURIComponent(slug)}`,
    installSkill: (id: string | number) => `/api/me/skills/${id}/install`,
    toggleSkill: (id: string | number) => `/api/me/skills/${id}`,
  },

  // ── Organizations ─────────────────────────────────────────────────
  orgs: {
    root: "/api/orgs",
    one: (orgId: string) => `/api/orgs/${encodeURIComponent(orgId)}`,
    members: (orgId: string) => `/api/orgs/${encodeURIComponent(orgId)}/members`,
    invites: (orgId: string) => `/api/orgs/${encodeURIComponent(orgId)}/invites`,
    defaultAssistant: (orgId: string) =>
      `/api/orgs/${encodeURIComponent(orgId)}/assistants/default`,
    modelGrants: (orgId: string) => `/api/orgs/${encodeURIComponent(orgId)}/model-grants`,
    modelGrantsBulk: (orgId: string) => `/api/orgs/${encodeURIComponent(orgId)}/model-grants/bulk`,
    modelGrant: (orgId: string, grantId: string) =>
      `/api/orgs/${encodeURIComponent(orgId)}/model-grants/${encodeURIComponent(grantId)}`,
    // Grants filtered to a single user — used by the Model Access tab so
    // an admin can see what a specific user can already call before
    // assigning more.
    modelGrantsByUser: (orgId: string, userId: string) =>
      `/api/orgs/${encodeURIComponent(orgId)}/model-grants/by-user/${encodeURIComponent(userId)}`,
    // Org-curated rule + skill catalogues. Admins only — the matching
    // user-facing subscription endpoints live under `ENDPOINTS.me`.
    rules: (orgId: string) => `/api/orgs/${encodeURIComponent(orgId)}/rules`,
    rule: (orgId: string, slug: string) =>
      `/api/orgs/${encodeURIComponent(orgId)}/rules/${encodeURIComponent(slug)}`,
    skills: (orgId: string) => `/api/orgs/${encodeURIComponent(orgId)}/skills`,
    skill: (orgId: string, slug: string) =>
      `/api/orgs/${encodeURIComponent(orgId)}/skills/${encodeURIComponent(slug)}`,
  },

  // ── Providers & models ────────────────────────────────────────────
  // `root` is the collection URL (GET = list, POST = create).
  // `models` lists the model catalogue configured for an org provider —
  // the Model Access tab uses it to populate the "Assign" dropdown so
  // an admin can only grant models the org has actually set up.
  providers: {
    root: "/api/providers",
    one: (id: string) => `/api/providers/${encodeURIComponent(id)}`,
    models: (providerId: string) => `/api/providers/${encodeURIComponent(providerId)}/models`,
  },

  // ── RBAC & policies ───────────────────────────────────────────────
  rbac: {
    roles: "/api/roles",
    role: (id: string) => `/api/roles/${encodeURIComponent(id)}`,
    roleUsersCount: (id: string) => `/api/roles/${encodeURIComponent(id)}/users-count`,
  },
  policy: {
    global: "/api/policy",
    wizard: "/api/policy/wizard",
    roles: "/api/policies/roles",
    roleTemplate: "/api/policies/role-template",
    role: (roleName: string) => `/api/policies/role/${encodeURIComponent(roleName)}`,
  },

  // ── Admin ─────────────────────────────────────────────────────────
  admin: {
    users: "/api/admin/users",
    user: (userId: string) => `/api/admin/users/${encodeURIComponent(userId)}`,
    userRole: (userId: string) => `/api/admin/users/${encodeURIComponent(userId)}/role`,
    // Per-user model assignment (org admin only — requires
    // `policies.edit` capability on the proxy side).
    userModels: (userId: string) => `/api/admin/users/${encodeURIComponent(userId)}/models`,
    userModel: (userId: string, modelId: string) =>
      `/api/admin/users/${encodeURIComponent(userId)}/models/${encodeURIComponent(modelId)}`,
  },

  // ── Users ─────────────────────────────────────────────────────────
  users: {
    list: "/api/users",
  },

  // ── Tasks ─────────────────────────────────────────────────────────
  tasks: {
    list: "/api/tasks",
    one: (id: string) => `/api/tasks/${encodeURIComponent(id)}`,
    ack: (id: string) => `/api/tasks/${encodeURIComponent(id)}/ack`,
  },

  // ── Memory ────────────────────────────────────────────────────────
  memory: {
    list: "/api/memory",
    one: (fileName: string) => `/api/memory/${encodeURIComponent(fileName)}`,
  },

  // ── Privacy & data export ─────────────────────────────────────────
  privacy: {
    settings: "/api/privacy/settings",
    data: "/api/privacy/data",
    export: (format: "json" | "csv") => `/api/export/${encodeURIComponent(format)}`,
  },

  // ── Security & stats ──────────────────────────────────────────────
  stats: "/api/stats",
  statsPerUser: "/api/stats/per-user",
  logs: "/api/logs",
  credits: "/api/credits",
  usageSummary: "/api/usage/summary",
  usageByUser: "/api/usage/by-user",
  teams: "/api/teams",
  securityAudit: "/api/security-audit",

  // ── Plugins ───────────────────────────────────────────────────────
  plugins: {
    list: "/api/plugins",
    enable: (id: string) => `/api/plugins/${encodeURIComponent(id)}/enable`,
    disable: (id: string) => `/api/plugins/${encodeURIComponent(id)}/disable`,
  },

  // ── Skills ────────────────────────────────────────────────────────
  skills: {
    list: "/api/skills",
    invoke: "/api/skills/invoke",
  },

  // ── Slash commands ────────────────────────────────────────────────
  commands: {
    list: "/api/commands",
    execute: "/api/commands/execute",
  },

  // ── Cron ──────────────────────────────────────────────────────────
  cron: {
    list: "/api/cron",
    one: (id: string) => `/api/cron/${encodeURIComponent(id)}`,
    enable: (id: string) => `/api/cron/${encodeURIComponent(id)}/enable`,
    disable: (id: string) => `/api/cron/${encodeURIComponent(id)}/disable`,
  },

  // ── Notifications ─────────────────────────────────────────────────
  notifications: {
    channels: "/api/notifications/channels",
    channel: (id: string) => `/api/notifications/channels/${encodeURIComponent(id)}`,
    test: "/api/notifications/test",
  },

  // ── Sub-agents (autonomous coordinator) ───────────────────────────
  agents: {
    list: "/api/agents",
    spawn: "/api/agents/spawn",
    one: (id: string) => `/api/agents/${encodeURIComponent(id)}`,
    message: (id: string) => `/api/agents/${encodeURIComponent(id)}/message`,
  },

  // ── Approvals (human-in-the-loop) ─────────────────────────────────
  approvals: {
    pending: "/api/approvals/pending",
    history: "/api/approvals/history",
    resolve: (id: string) => `/api/approvals/${encodeURIComponent(id)}/resolve`,
  },

  // ── LLM chat (proxied) ────────────────────────────────────────────
  chat: {
    completions: "/v1/chat/completions",
  },
} as const;
