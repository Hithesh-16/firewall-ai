export interface ThemeToken {
  readonly cssVar: string;
  readonly defaultValue: string;
}

export const THEME_TOKENS: Record<string, ThemeToken> = {
  background: { cssVar: "--afw-background", defaultValue: "#1e1e1e" },
  foreground: { cssVar: "--afw-foreground", defaultValue: "#e6e6e6" },
  "editor-bg": { cssVar: "--afw-editor-bg", defaultValue: "#1e1e1e" },
  "editor-fg": { cssVar: "--afw-editor-fg", defaultValue: "#e6e6e6" },
  primary: { cssVar: "--afw-primary", defaultValue: "#059669" },
  "primary-fg": { cssVar: "--afw-primary-fg", defaultValue: "#ffffff" },
  "primary-hover": { cssVar: "--afw-primary-hover", defaultValue: "#10b981" },
  secondary: { cssVar: "--afw-secondary", defaultValue: "#303030" },
  "secondary-fg": { cssVar: "--afw-secondary-fg", defaultValue: "#e6e6e6" },
  "secondary-hover": {
    cssVar: "--afw-secondary-hover",
    defaultValue: "#3a3a3a",
  },
  border: { cssVar: "--afw-border", defaultValue: "#2a2a2a" },
  "border-focus": { cssVar: "--afw-border-focus", defaultValue: "#10b981" },
  command: { cssVar: "--afw-command", defaultValue: "#252525" },
  "command-fg": { cssVar: "--afw-command-fg", defaultValue: "#e6e6e6" },
  "command-border": { cssVar: "--afw-command-border", defaultValue: "#555555" },
  "command-border-focus": {
    cssVar: "--afw-command-border-focus",
    defaultValue: "#06b6d4",
  },
  description: { cssVar: "--afw-description", defaultValue: "#b3b3b3" },
  "description-muted": {
    cssVar: "--afw-description-muted",
    defaultValue: "#8c8c8c",
  },
  input: { cssVar: "--afw-input", defaultValue: "#2d2d2d" },
  "input-fg": { cssVar: "--afw-input-fg", defaultValue: "#e6e6e6" },
  "input-border": { cssVar: "--afw-input-border", defaultValue: "#555555" },
  "input-placeholder": {
    cssVar: "--afw-input-placeholder",
    defaultValue: "#9e9e9e",
  },
  "table-odd": { cssVar: "--afw-table-odd", defaultValue: "#2d2d2d" },
  badge: { cssVar: "--afw-badge", defaultValue: "#4d4d4d" },
  "badge-fg": { cssVar: "--afw-badge-fg", defaultValue: "#ffffff" },
  info: { cssVar: "--afw-info", defaultValue: "#2196f3" },
  success: { cssVar: "--afw-success", defaultValue: "#4caf50" },
  warning: { cssVar: "--afw-warning", defaultValue: "#ffb74d" },
  error: { cssVar: "--afw-error", defaultValue: "#f44336" },
  link: { cssVar: "--afw-link", defaultValue: "#06b6d4" },
  accent: { cssVar: "--afw-accent", defaultValue: "#10b981" },
  terminal: { cssVar: "--afw-terminal", defaultValue: "#0dbc79" },
  "list-hover": { cssVar: "--afw-list-hover", defaultValue: "#383838" },
  "list-active": { cssVar: "--afw-list-active", defaultValue: "#05966950" },
  "list-active-fg": { cssVar: "--afw-list-active-fg", defaultValue: "#ffffff" },
};
