const TOKEN_KEY = "afw_token";
const THEME_KEY = "afw_theme";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export type ThemePreference = "dark" | "light" | "high-contrast";

export function getThemePreference(): ThemePreference {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === "dark" || stored === "light" || stored === "high-contrast") {
    return stored;
  }
  return "dark";
}

export function setThemePreference(theme: string): void {
  localStorage.setItem(THEME_KEY, theme);
}
