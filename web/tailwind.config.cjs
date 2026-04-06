/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    screens: {
      sm: "640px",
      md: "768px",
      lg: "1024px",
      xl: "1280px",
      "2xl": "1440px",
    },
    extend: {
      colors: {
        background: "var(--afw-background, #1e1e1e)",
        foreground: "var(--afw-foreground, #e6e6e6)",
        editor: {
          DEFAULT: "var(--afw-editor-bg, #1e1e1e)",
          foreground: "var(--afw-editor-fg, #e6e6e6)",
        },
        primary: {
          DEFAULT: "var(--afw-primary, #059669)",
          foreground: "var(--afw-primary-fg, #ffffff)",
          hover: "var(--afw-primary-hover, #10b981)",
        },
        secondary: {
          DEFAULT: "var(--afw-secondary, #303030)",
          foreground: "var(--afw-secondary-fg, #e6e6e6)",
          hover: "var(--afw-secondary-hover, #3a3a3a)",
        },
        border: {
          DEFAULT: "var(--afw-border, #2a2a2a)",
          focus: "var(--afw-border-focus, #10b981)",
        },
        command: {
          DEFAULT: "var(--afw-command, #252525)",
          foreground: "var(--afw-command-fg, #e6e6e6)",
          border: {
            DEFAULT: "var(--afw-command-border, #555555)",
            focus: "var(--afw-command-border-focus, #06b6d4)",
          },
        },
        description: {
          DEFAULT: "var(--afw-description, #b3b3b3)",
          muted: "var(--afw-description-muted, #8c8c8c)",
        },
        input: {
          DEFAULT: "var(--afw-input, #2d2d2d)",
          foreground: "var(--afw-input-fg, #e6e6e6)",
          border: "var(--afw-input-border, #555555)",
          placeholder: "var(--afw-input-placeholder, #9e9e9e)",
        },
        table: {
          oddRow: "var(--afw-table-odd, #2d2d2d)",
        },
        badge: {
          DEFAULT: "var(--afw-badge, #4d4d4d)",
          foreground: "var(--afw-badge-fg, #ffffff)",
        },
        info: "var(--afw-info, #2196f3)",
        success: "var(--afw-success, #4caf50)",
        warning: "var(--afw-warning, #ffb74d)",
        error: "var(--afw-error, #f44336)",
        link: "var(--afw-link, #06b6d4)",
        accent: "var(--afw-accent, #10b981)",
        terminal: "var(--afw-terminal, #0dbc79)",
        findMatch: {
          DEFAULT: "#05966940",
          selected: "#ffb74d40",
        },
        list: {
          hover: "var(--afw-list-hover, #383838)",
          active: {
            DEFAULT: "var(--afw-list-active, #05966950)",
            foreground: "var(--afw-list-active-fg, #ffffff)",
          },
        },
      },
    },
  },
  plugins: [],
};
