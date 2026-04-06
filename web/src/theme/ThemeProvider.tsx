import React, { createContext, useCallback, useEffect, useState } from "react";
import { THEME_TOKENS } from "./tokens";
import { PRESETS, type ThemeName } from "./presets";
import { getThemePreference, setThemePreference } from "../utils/storage";

export interface ThemeContextValue {
  theme: ThemeName;
  setTheme: (name: ThemeName) => void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);

function applyPreset(name: ThemeName): void {
  const preset = PRESETS[name];
  const root = document.documentElement.style;
  for (const [tokenName, token] of Object.entries(THEME_TOKENS)) {
    const value = preset[tokenName] ?? token.defaultValue;
    root.setProperty(token.cssVar, value);
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeName>(
    () => getThemePreference() as ThemeName,
  );

  const setTheme = useCallback((name: ThemeName) => {
    setThemeState(name);
    setThemePreference(name);
  }, []);

  useEffect(() => {
    applyPreset(theme);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
