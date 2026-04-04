/**
 * @ai-firewall/brand — Single source of truth for all brand strings.
 *
 * To rename the product, change values here. Every package imports from this file.
 * Zero dependencies — safe to import from any layer.
 */

export const BRAND = {
  // ── Identity ────────────────────────────────────────────────────────
  /** Display name (title case) */
  name: "AI Firewall",
  /** Lowercase with hyphen (for file paths, package names) */
  nameLower: "ai-firewall",
  /** No separator (for env var prefixes, identifiers) */
  nameSlug: "aifirewall",
  /** Uppercase with underscore (for env vars) */
  nameEnv: "AI_FIREWALL",

  // ── Config Paths ────────────────────────────────────────────────────
  /** Global config directory name (e.g., ~/.ai-firewall/) */
  globalDir: ".ai-firewall",
  /** Default config file name */
  configFile: "config.yaml",
  /** Subdirectory names inside globalDir */
  rulesDir: "rules",
  agentsDir: "agents",
  assistantsDir: "assistants",
  skillsDir: "skills",
  memoryDir: "memory",
  /** Alternative config directories to also check (backward compat) */
  altDirs: [".claude"] as readonly string[],

  // ── Environment Variables ───────────────────────────────────────────
  /** Prefix for all env vars */
  envPrefix: "AI_FIREWALL",
  /** Key env var names */
  envVars: {
    globalDir: "AI_FIREWALL_GLOBAL_DIR",
    apiBase: "AI_FIREWALL_API_BASE",
    apiKey: "AI_FIREWALL_API_KEY",
    proxyUrl: "AF_PROXY_URL",
  },

  // ── URLs ────────────────────────────────────────────────────────────
  /** Production app URL */
  appUrl: "https://ai-firewall.dev",
  /** API base URL */
  apiUrl: "https://api.ai-firewall.dev",
  /** Documentation URL */
  docsUrl: "https://docs.ai-firewall.dev",
  /** GitHub repository */
  repoUrl: "https://github.com/ai-firewall/ai-firewall",
  /** Issues URL */
  issuesUrl: "https://github.com/ai-firewall/ai-firewall/issues",
  /** Discussions URL */
  discussionsUrl: "https://github.com/ai-firewall/ai-firewall/discussions",

  // ── Package ─────────────────────────────────────────────────────────
  /** npm scope */
  npmScope: "@ai-firewall",
  /** CLI binary name */
  cliBin: "afw",
  /** CLI package name */
  cliPackage: "@ai-firewall/cli",

  // ── Display ─────────────────────────────────────────────────────────
  /** One-line tagline */
  tagline: "Secure AI code agent",
  /** Longer description */
  description: "Every request scanned for secrets, PII & prompt injection",
  /** Security contact */
  securityEmail: "security@ai-firewall.dev",

  // ── Proxy ───────────────────────────────────────────────────────────
  /** Default proxy base URL */
  defaultProxyUrl: "http://localhost:8080",
  /** Response header prefix */
  headerPrefix: "X-AF",
  /** Token vault prefix */
  tokenPrefix: "afw_",
} as const;

export type Brand = typeof BRAND;
