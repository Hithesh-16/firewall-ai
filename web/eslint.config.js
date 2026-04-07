import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y";
import prettier from "eslint-config-prettier";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,

  { ignores: ["dist/", "node_modules/", "*.config.*", "postcss.config.cjs"] },

  // Main rules for all TS/TSX
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
      "jsx-a11y": jsxA11y,
    },
    languageOptions: {
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      // ── TypeScript ──
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/consistent-type-imports": ["warn", { prefer: "type-imports" }],

      // ── React Hooks ──
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",

      // ── Accessibility ──
      "jsx-a11y/alt-text": "warn",
      "jsx-a11y/anchor-is-valid": "warn",
      "jsx-a11y/click-events-have-key-events": "warn",
      "jsx-a11y/no-static-element-interactions": "warn",
      "jsx-a11y/aria-props": "error",
      "jsx-a11y/aria-role": "error",

      // ── Code quality ──
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "no-debugger": "error",
      "no-alert": "error",
      "no-var": "error",
      "prefer-const": "error",
      eqeqeq: ["error", "always", { null: "ignore" }],
      curly: ["error", "multi-line"],
      "no-nested-ternary": "warn",
      "no-eval": "error",
      "no-implied-eval": "error",

      // ── Environment: prevent direct env access ──
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "MemberExpression[object.object.name='import'][object.property.name='meta'][property.name='env']",
          message: "Do not access import.meta.env directly. Use config/env.ts instead.",
        },
      ],

      // ── Prevent direct localStorage for tokens ──
      "no-restricted-globals": [
        "error",
        {
          name: "localStorage",
          message: "Do not access localStorage directly. Use utils/storage.ts helpers.",
        },
      ],
    },
  },

  // Allow config/env.ts to access import.meta.env
  {
    files: ["src/config/env.ts"],
    rules: { "no-restricted-syntax": "off" },
  },

  // Allow utils/storage.ts to access localStorage
  {
    files: ["src/utils/storage.ts"],
    rules: { "no-restricted-globals": "off" },
  },

  // Allow theme files to use raw values
  {
    files: ["src/theme/**/*.ts"],
    rules: { "no-restricted-syntax": "off" },
  },
);
