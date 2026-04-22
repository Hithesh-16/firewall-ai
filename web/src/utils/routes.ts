/**
 * Canonical path constants for every route in the web dashboard.
 *
 * Rule: NEVER hardcode a route path at a call site. Import from here.
 * Call sites that navigate (`useNavigate`, `<Navigate to>`, `<Link to>`)
 * or match (`<Route path>`) must reference these constants.
 *
 * Routes are split into two groups so the router can decide at boot
 * which subtree to mount based on the auth token.
 */

export const ROUTES = {
  // ── Public (no auth required) ─────────────────────────────────────
  LANDING: "/",
  LOGIN: "/login",
  REGISTER: "/register",
  FORBIDDEN: "/403",

  // ── Onboarding / gated (auth required but outside main shell) ────
  ONBOARDING: "/onboarding",
  SETUP_MODEL: "/setup-model",

  // ── Authenticated dashboard (inside AppShell) ────────────────────
  DASHBOARD: "/dashboard",
  CHAT: "/dashboard",
  DOCS: "/docs",
  SECURITY: "/security",
  SECURITY_AUDIT: "/security/audit",
  POLICY: "/policy",
  POLICY_ROLES: "/policy/roles",
  RBAC: "/rbac",
  ORG: "/org",
  TEAM: "/team",
  AGENTS: "/agents",
  TASKS: "/tasks",
  MEMORY: "/memory",
  SKILLS: "/skills",
  COMMANDS: "/commands",
  PLUGINS: "/plugins",
  PRIVACY: "/privacy",
  NOTIFICATIONS: "/notifications",
  CRON: "/cron",
  USAGE: "/usage",
  SETTINGS: "/settings",
  SETTINGS_MODELS: "/settings/models",
  SETTINGS_ASSISTANT: "/settings/assistant",
  SETTINGS_MODEL_ACCESS: "/settings/model-access",
  SETTINGS_RULES: "/settings/rules",
  SETTINGS_SKILLS: "/settings/skills",
  ADD_PROVIDER: "/providers/add",
} as const;

export type RoutePath = (typeof ROUTES)[keyof typeof ROUTES];

/**
 * Paths that render WITHOUT authentication.
 * Unauthenticated users land here; authenticated users get bounced
 * to `DASHBOARD` by the `<PublicOnly>` guard.
 */
export const PUBLIC_PATHS: readonly RoutePath[] = [
  ROUTES.LANDING,
  ROUTES.LOGIN,
  ROUTES.REGISTER,
  ROUTES.FORBIDDEN,
] as const;

/**
 * Paths that require an auth token. Everything under the AppShell,
 * plus the onboarding and setup-model standalone flows.
 *
 * Used by `<RequireAuth>` — if no token, user is redirected to LOGIN
 * with a `?next=` param preserving their intended destination.
 */
export const PRIVATE_PATHS: readonly RoutePath[] = [
  ROUTES.ONBOARDING,
  ROUTES.SETUP_MODEL,
  ROUTES.DASHBOARD,
  ROUTES.SECURITY,
  ROUTES.SECURITY_AUDIT,
  ROUTES.POLICY,
  ROUTES.POLICY_ROLES,
  ROUTES.RBAC,
  ROUTES.ORG,
  ROUTES.TEAM,
  ROUTES.AGENTS,
  ROUTES.TASKS,
  ROUTES.MEMORY,
  ROUTES.SKILLS,
  ROUTES.COMMANDS,
  ROUTES.PLUGINS,
  ROUTES.PRIVACY,
  ROUTES.NOTIFICATIONS,
  ROUTES.CRON,
  ROUTES.USAGE,
  ROUTES.SETTINGS_MODELS,
  ROUTES.SETTINGS_ASSISTANT,
  ROUTES.SETTINGS_MODEL_ACCESS,
  ROUTES.SETTINGS_RULES,
  ROUTES.SETTINGS_SKILLS,
  ROUTES.ADD_PROVIDER,
] as const;

export const isPublicPath = (path: string): boolean =>
  (PUBLIC_PATHS as readonly string[]).includes(path);

export const isPrivatePath = (path: string): boolean =>
  (PRIVATE_PATHS as readonly string[]).includes(path);
