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
    model: (id: string) => `/api/me/models/${encodeURIComponent(id)}`,
    provider: (slug: string) => `/api/me/providers/${encodeURIComponent(slug)}`,
    onboardingComplete: "/api/users/me/onboarding/complete",
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
  },

  // ── Providers & models ────────────────────────────────────────────
  // `root` is the collection URL (GET = list, POST = create).
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
