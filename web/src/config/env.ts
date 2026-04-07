/**
 * Environment Configuration
 *
 * Single source of truth for all environment-specific values.
 * NEVER access import.meta.env or hardcode URLs outside this file.
 */

function getEnv(key: string, fallback?: string): string {
  const value = import.meta.env[key] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export const config = {
  proxyBaseUrl: getEnv("VITE_PROXY_BASE_URL", "http://localhost:8080"),
  appName: getEnv("VITE_APP_NAME", "AI Firewall"),
} as const;
