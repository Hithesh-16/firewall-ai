---
paths:
  - "gui/**/*.tsx"
  - "gui/**/*.ts"
  - "gui/**/*.css"
  - "extensions/**/*.ts"
---
# Design QA Checklist — AI Firewall

## Golden Rule
If it feels like a separate tool, it's wrong. It should feel native everywhere.

## Theme Compatibility (CRITICAL — every component)
- NEVER use hardcoded colors: no `#ef4444`, no `text-white`, no `bg-gray-600`
- ALWAYS use theme-mapped Tailwind classes:
  - Backgrounds: `bg-editor`, `bg-input`, `bg-secondary-background`, `bg-list-hover`
  - Text: `text-foreground`, `text-description`, `text-description-muted`
  - Buttons: `bg-primary text-primary-foreground`, `bg-badge text-badge-foreground`
  - Semantic: `text-error`, `text-warning`, `text-success`, `text-info`
  - Borders: `border-border`, `border-border-focus`
  - Inputs: `bg-input text-input-foreground placeholder:text-input-placeholder`
- Test in: dark mode, light mode, high contrast
- SVG strokes: use `stroke="currentColor"` + className, never `stroke="white"`

## Buttons
- No default white buttons unless intentional
- Primary: `bg-primary text-primary-foreground hover:bg-primary-hover`
- Secondary: `bg-secondary-background text-foreground border border-border`
- Danger: `text-error border-error/30`
- Disabled: `opacity-50 cursor-not-allowed`
- Click area >= 40px height

## Tabs
- Active: `bg-list-active text-list-active-foreground border-b-2 border-b-primary`
- Inactive: `text-description hover:text-foreground hover:bg-list-hover`
- NEVER use `bg-primary-background` for tabs (too bright in some themes)

## Unicode in JSX
- ALWAYS use JSX expressions for unicode: `{"\u23CE"}` not `\u23CE`
- The latter renders as literal text `\u23CE` instead of the symbol ⏎

## Navigation
- Every detail page has back button or breadcrumb to chat
- Use `react-router-dom` navigate, not raw `window.location`

## Performance
- UI response: <100ms
- Loading states on every async operation
- No layout shifts during load
