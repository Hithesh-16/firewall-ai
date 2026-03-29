// Valid config tab names
export type ConfigTab =
  | "models"
  | "rules"
  | "tools"
  | "configs"
  | "organizations"
  | "indexing"
  | "settings"
  | "help";

// TODO: Move all the routes here
export const ROUTES = {
  HOME: "/",
  HOME_INDEX: "/index.html",
  LOGIN: "/login",
  CONFIG: "/config",
  THEME: "/theme",
  STATS: "/stats",
  SECURITY: "/security",
  FIRST_LOOK: "/first-look",
  ORG: "/org",
  TEAM: "/team",
};

// Helper function to build config URLs with tabs
export const buildConfigRoute = (tab?: ConfigTab): string => {
  return tab ? `${ROUTES.CONFIG}?tab=${tab}` : ROUTES.CONFIG;
};

// Typed config route builders for common tabs
export const CONFIG_ROUTES = {
  MODELS: buildConfigRoute("models"),
  RULES: buildConfigRoute("rules"),
  TOOLS: buildConfigRoute("tools"),
  CONFIGS: buildConfigRoute("configs"),
  ORGANIZATIONS: buildConfigRoute("organizations"),
  INDEXING: buildConfigRoute("indexing"),
  SETTINGS: buildConfigRoute("settings"),
  HELP: buildConfigRoute("help"),
} as const;
