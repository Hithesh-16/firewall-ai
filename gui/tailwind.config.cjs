/** @type {import('tailwindcss').Config} */
const defaultTheme = require("tailwindcss/defaultTheme");
const { varWithFallback, THEME_COLORS } = require("./src/styles/theme");

module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "./src/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    // Note that these breakpoints are primarily optimized for the input toolbar
    screens: {
      "2xs": "170px", // Smallest width for Primary Sidebar in VS Code
      xs: "250px", // Avg default sidebar width in VS Code
      sm: "330px",
      int: "380px",
      md: "460px",
      lg: "590px",
      xl: "720px",
      "2xl": "860px",
      "3xl": "1000px",
      "4xl": "1180px",
    },
    extend: {
      animation: {
        "spin-slow": "spin 6s linear infinite",
        // Kilocode-parity animations (keyframes live in src/styles/tokens.css).
        shimmer: "shimmer 2s linear infinite",
        "timeline-fade-in": "timeline-fade-in 200ms ease-out",
        "timeline-pulse": "timeline-pulse 1.4s ease-in-out infinite",
        // ── AI Firewall motion vocabulary (P1) ─────────────────
        "af-pulse": "af-pulse 1.4s ease-in-out infinite",
        "af-progress": "af-progress 1.4s ease-in-out infinite",
        "af-pop-in": "af-pop-in 180ms ease-out",
        "af-slide-down": "af-slide-down 200ms ease-out",
        "af-bounce": "af-bounce 280ms cubic-bezier(0.34,1.56,0.64,1)",
        "af-stroke-draw": "af-stroke-draw 360ms ease-out forwards",
      },
      borderRadius: {
        default: "0.5rem",
      },
      fontSize: {
        "2xs": "0.6875rem", // 11px
        // ── AI Firewall type scale (P1) — three sizes, one per role ──
        "af-caption": ["11px", { lineHeight: "1.4" }],
        "af-body": ["13px", { lineHeight: "1.55" }],
        "af-heading": ["16px", { lineHeight: "1.3", fontWeight: "600" }],
      },
      outlineOffset: {
        0.5: "0.5px",
      },
      colors: {
        background: varWithFallback("background"),
        foreground: varWithFallback("foreground"),
        editor: {
          DEFAULT: varWithFallback("editor-background"),
          foreground: varWithFallback("editor-foreground"),
        },
        primary: {
          DEFAULT: varWithFallback("primary-background"),
          foreground: varWithFallback("primary-foreground"),
          hover: varWithFallback("primary-hover"),
        },
        secondary: {
          DEFAULT: varWithFallback("secondary-background"),
          foreground: varWithFallback("secondary-foreground"),
          hover: varWithFallback("secondary-hover"),
        },
        border: {
          DEFAULT: varWithFallback("border"),
          focus: varWithFallback("border-focus"),
        },
        command: {
          DEFAULT: varWithFallback("command-background"),
          foreground: varWithFallback("command-foreground"),
          border: {
            DEFAULT: varWithFallback("command-border"),
            focus: varWithFallback("command-border-focus"),
          },
        },
        description: {
          DEFAULT: varWithFallback("description"),
          muted: varWithFallback("description-muted"),
        },
        input: {
          DEFAULT: varWithFallback("input-background"),
          foreground: varWithFallback("input-foreground"),
          border: varWithFallback("input-border"),
          placeholder: varWithFallback("input-placeholder"),
        },
        table: {
          oddRow: varWithFallback("table-oddRow"),
        },
        badge: {
          DEFAULT: varWithFallback("badge-background"),
          foreground: varWithFallback("badge-foreground"),
        },
        info: varWithFallback("info"),
        success: varWithFallback("success"),
        warning: varWithFallback("warning"),
        error: varWithFallback("error"),
        link: varWithFallback("link"),
        accent: varWithFallback("accent"),
        terminal: varWithFallback("terminal"),
        findMatch: {
          DEFAULT: THEME_COLORS["find-match"].default,
          selected: varWithFallback("find-match-selected"),
        },
        list: {
          hover: varWithFallback("list-hover"),
          active: {
            DEFAULT: varWithFallback("list-active"),
            foreground: varWithFallback("list-active-foreground"),
          },
        },

        // ── Kilocode-parity tokens (defined in src/styles/tokens.css) ──
        // Text hierarchy — weak/base/strong augment the existing
        // foreground/description pair with a stronger variant.
        weak: "var(--text-weak)",
        strong: "var(--text-strong)",

        // Surface hierarchy — inset surfaces (sidebars, accordion
        // headers, task header) sit behind the main editor surface.
        "surface-base": "var(--surface-base)",
        "surface-inset": {
          DEFAULT: "var(--surface-inset-base)",
          hover: "var(--surface-inset-base-hover)",
        },

        // Border weak — softer than `border` for internal dividers.
        "border-weak": "var(--border-weak-base)",

        // Timeline colors — per-turn-part activity swatches.
        timeline: {
          user: "var(--tl-user)",
          read: "var(--tl-read)",
          write: "var(--tl-write)",
          tool: "var(--tl-tool)",
          success: "var(--tl-success)",
          error: "var(--tl-error)",
          reasoning: "var(--tl-reasoning)",
        },

        // Diff surfaces — add/del/gutter backgrounds for inline
        // and side-by-side diff rendering.
        diff: {
          add: "var(--surface-diff-add)",
          del: "var(--surface-diff-del)",
          gutter: "var(--surface-diff-gutter)",
        },

        // ── AI Firewall identity palette (P1) ────────────────────
        // Used on product-identity surfaces (CTAs, active nav,
        // loaders, brand moments). Semantic roles like success/error
        // keep the VS Code theme tokens so the editor still rules.
        af: {
          accent: {
            DEFAULT: "var(--af-accent)",
            hover: "var(--af-accent-hover)",
            glow: "var(--af-accent-glow)",
          },
          info: {
            DEFAULT: "var(--af-info)",
            glow: "var(--af-info-glow)",
          },
          danger: "var(--af-danger)",
          warning: "var(--af-warning)",
          surface: {
            deep: "var(--af-surface-deep)",
            raised: "var(--af-surface-raised)",
          },
          hairline: "var(--af-hairline)",
        },

        // DEPRECATED, slowly remove usages of these ide-named or explicit colors
        lightgray: "#999998", // use border, description, or description-muted instead - AVOID
        "vsc-input-background": varWithFallback("input-background"), // use "input-background" instead
        "vsc-background": varWithFallback("background"), // use "background" instead
        "vsc-foreground": varWithFallback("editor-foreground"), // use "foreground" instead
        "vsc-editor-background": varWithFallback("editor-background"), // use "editor" instead
        "vsc-input-border": varWithFallback("input-border"), // use "input-border" instead
      },
    },
  },
  plugins: [],
  corePlugins: {
    preflight: false,
  },
};
