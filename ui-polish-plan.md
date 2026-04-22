# AI Firewall — UI Polish & Identity Plan

**Target:** web dashboard + VS Code webview + CLI TUI
**Goal:** move from "functional parity with kilocode" to "distinctive, confident, security-first UX that feels premium across all three surfaces"
**Status:** Draft — awaiting approval
**Date:** 2026-04-22

---

## 0. Why this plan exists

Phases 0–3 shipped the missing **features** (token bars, reasoning, todos, multi-file diff). What's still missing is the **identity layer**: the small details that separate a "tool that works" from "tool I actively want to use." Screens currently look correct but generic — token bars use default widths, loaders are basic spinners, empty states are bare text, error surfaces are red boxes. Nothing signals "this is a security-first product built for developers who care."

The fix is not more features — it's a consistent aesthetic decision applied uniformly. This plan takes 6–8 dev days and is **additive only** (no behavior changes, no data-flow refactors).

---

## 1. Identity — the three decisions to lock in first

Before any component work, pick a lane on three axes. Everything downstream cascades from these.

### 1.1 Accent + semantic palette

**Current state:** `index.css` already defines `--af-emerald`, `--af-emerald-light`, `--af-cyan`, `--af-surface` but nothing consistently uses them. Design-system components default to VS Code semantic tokens (blue/green/red/orange).

**Proposal:** lean hard into **emerald + cyan** as the AI Firewall signature. Reasoning: emerald reads as "safe/trusted" (security posture), cyan reads as "precise/technical" (developer tool). Nobody else in the LLM-tool space owns this combo — Cursor is blue-gray, Copilot is vscode-orange, kilocode is slate+emerald-green. A tuned emerald+cyan gives us visual ownership.

| Token                 | Role                 | Value                    | Usage                                                |
| --------------------- | -------------------- | ------------------------ | ---------------------------------------------------- |
| `--af-accent`         | primary brand accent | `#10b981` (emerald-500)  | primary buttons, active tabs, success confirmations  |
| `--af-accent-glow`    | accent halo          | `rgba(16,185,129,0.18)`  | focused inputs, primary-button hover glow            |
| `--af-info`           | information hue      | `#06b6d4` (cyan-500)     | cache-read tokens, "scanning" activity, info banners |
| `--af-danger`         | threat/block         | `#ef4444` (red-500)      | BLOCK verdicts, revert, destructive actions          |
| `--af-warning`        | elevated risk        | `#f59e0b` (amber-500)    | REDACT verdicts, PII detection, degraded-cache       |
| `--af-surface-deep`   | premium dark surface | `#0b0f14`                | web dashboard shell behind cards                     |
| `--af-surface-raised` | card / panel         | `#1e293b`                | web cards, IDE accordion headers                     |
| `--af-hairline`       | 1px separator        | `rgba(148,163,184,0.14)` | dividers, subtle borders                             |

These are **additive** to the VS Code theme token set — they don't override `bg-primary` or `text-foreground`. Introduce them as first-class Tailwind colors (`bg-af-accent`, `text-af-info`) and use them only where the product's identity should show through: headers, CTAs, loaders, badges.

### 1.2 Motion vocabulary — what each animation means

**Current state:** ad-hoc — some components use CSS transitions, others don't animate; `AnimatedEllipsis`, `shimmer`, `spin-slow`, `timeline-pulse` exist with no shared grammar.

**Proposal:** one verb per motion, consistent across surfaces.

| Motion              | Meaning                             | Where used                                                         | Duration                             |
| ------------------- | ----------------------------------- | ------------------------------------------------------------------ | ------------------------------------ |
| **Shimmer**         | "AI is thinking / streaming tokens" | ThinkingBlock, streaming assistant message, CLI status "Thinking…" | 1.8s infinite                        |
| **Pulse (halo)**    | "Active firewall / security work"   | ScanResultBanner, firewall activity row, CLI `◐` scanning icon     | 1.4s infinite                        |
| **Progress wave**   | "Multi-step pipeline in flight"     | FirewallActivityIndicator, CLI onboarding steps                    | variable — ticks with step           |
| **Scale-in + fade** | "Content just arrived"              | New chat message, toast, tool-call card                            | 180ms ease-out                       |
| **Slide-down**      | "Opening a drawer/accordion"        | TaskHeader expand, FileAccordion, dialogs                          | 200ms ease-out                       |
| **Subtle bounce**   | "Success confirmation"              | Copy success, grant success, model connected                       | 280ms cubic-bezier(0.34,1.56,0.64,1) |

These become 6 Tailwind animation utilities (`animate-af-shimmer`, `animate-af-pulse`, `animate-af-progress`, `animate-af-pop-in`, `animate-af-slide-down`, `animate-af-bounce`) with matching keyframes. No other motion is invented — new components pick from this vocabulary.

### 1.3 Typography rhythm

**Current state:** font sizes scattered (`text-[11px]`, `text-xs`, `text-2xs`, `text-sm`, `text-[12px]`, `text-foreground`). No consistent type scale.

**Proposal:** three sizes only, each with a purpose.

| Size        | Token                                     | Usage                                    |
| ----------- | ----------------------------------------- | ---------------------------------------- |
| **Caption** | `text-[11px] leading-[1.4]`               | metadata, tokens, timestamps, file paths |
| **Body**    | `text-[13px] leading-[1.55]`              | messages, descriptions, form labels      |
| **Heading** | `text-[16px] font-semibold leading-[1.3]` | card titles, page H1s                    |

Monospace is **JetBrains Mono** everywhere code, file paths, or token counts appear (already loaded in `index.css`). Body text is system sans (already default).

Add a Tailwind plugin that exposes `text-af-caption`, `text-af-body`, `text-af-heading` so future components never re-pick pixel values.

---

## 2. Loader system — unified across web, IDE, CLI

Loaders are currently the single biggest polish gap. The bar is: **every async state communicates what's happening, how long it will take, and doesn't feel broken.**

### 2.1 Pick by intent, not by convention

| Loader                           | When to use                                                                | Anti-pattern                           |
| -------------------------------- | -------------------------------------------------------------------------- | -------------------------------------- |
| **Skeleton**                     | fetching known-shape data (models list, users, grants)                     | spinner over empty area — looks broken |
| **Shimmer text**                 | streaming unknown-length content (LLM response, reasoning)                 | static "Loading…" with no motion       |
| **Indeterminate progress bar**   | multi-step pipeline where steps are known but timing isn't (firewall scan) | spinner with no progress hint          |
| **Determinate progress bar**     | upload/download with known total (file upload, config sync)                | spinner                                |
| **Pulse halo**                   | "working on something, not a request" (background sync, watcher)           | nothing                                |
| **Success checkmark (animated)** | one-shot completion (copy, save, grant)                                    | silent swap                            |

### 2.2 Components to build (web + IDE)

Single shared set under `gui/src/components/loaders/` (shared via symlink or re-export for `web/`):

1. **`AfSpinner`** — replaces the existing ad-hoc div+border spinners. Sizes `xs | sm | md | lg`, color accent by default, `muted` prop for overlays.
2. **`AfSkeleton`** — rectangular placeholder with subtle shimmer. Props: `width`, `height`, `rounded`. Compose into `AfSkeletonRow`, `AfSkeletonCard` presets.
3. **`AfTextShimmer`** — already built; rename + extend with `variant: "thinking" | "scanning" | "saving"` preset labels.
4. **`AfProgressBar`** — indeterminate (animated gradient sweep) + determinate (percent). Thin 2px bar; accent color by default.
5. **`AfPulseHalo`** — circular halo around an icon, 3 concentric rings pulsing at offset phases. Used on the sidebar "scanning" indicator and the web dashboard's "live" dot.
6. **`AfSuccessCheck`** — inline animated checkmark (SVG stroke draw). Fires once on mount; no infinite loop.
7. **`AfStepper`** — vertical step indicator for multi-stage pipelines (firewall scan: scanning → redacting → routing → forwarding). Kills the current flat status text.

Every loader respects `prefers-reduced-motion: reduce` — animations collapse to a subtle fade instead.

### 2.3 CLI loader set

CLI can't do CSS animations but has Ink + chalk. Matching vocabulary:

| Web loader       | CLI equivalent                                                                                                        |
| ---------------- | --------------------------------------------------------------------------------------------------------------------- |
| `AfSpinner`      | `ora` spinner with custom frames `['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏']` (dots3 — already ora default) in emerald |
| `AfSkeleton`     | "loading" cyan ellipsis + dim placeholder text                                                                        |
| `AfTextShimmer`  | chalk.gray → chalk.white cycle on label, 350ms interval                                                               |
| `AfProgressBar`  | cli-progress bar in emerald with Unicode blocks `█▓▒░`                                                                |
| `AfPulseHalo`    | rotating `◐◓◑◒` glyph in emerald                                                                                      |
| `AfSuccessCheck` | chalk.green("✔") with 200ms initial fade-in                                                                           |
| `AfStepper`      | multi-line step list with `◉ done ● active ○ pending`                                                                 |

Already-used `chalk.dim`, `chalk.green("✓")` get consolidated behind these helpers so CLI visuals are consistent wherever rendered.

---

## 3. Per-surface polish — specific visual changes

### 3.1 Web dashboard (`web/`)

**Current feel:** functional, but flat. Cards all same weight, no hero moment, empty states bare.

**Changes:**

1. **Shell background.** Add `--af-surface-deep` as the outer shell, `--af-surface-raised` for cards. Creates a one-step depth hierarchy that reads immediately.
2. **Sidebar polish.** Active nav item gets a 2px emerald left-rail (not just background). Inactive items pick up a faint hover glow instead of gray rectangle.
3. **Card style update.** Every `<Card>` gains `rounded-lg border border-af-hairline bg-af-surface-raised shadow-[0_1px_0_0_rgba(0,0,0,0.2)]`. Single elevation step, no drop-shadow escalation.
4. **Empty states.** Replace the `<EmptyState>` component: softer icon (outline style, af-hairline stroke), larger heading (`text-af-heading`), single-action CTA button in emerald with subtle glow.
5. **Page headers.** Add breadcrumb row + page hint text above the H1 on every settings page. Gives each page an orienting line before the content.
6. **Loaders.** Every async list page (`UsersTab`, `UserModelsTab`, `ProvidersTab`, `ModelsPage`) renders `AfSkeleton` placeholders instead of the current full-container spinner — instant perceived-perf win.
7. **Success surfaces.** Replace toast check marks with `AfSuccessCheck` animated stroke; the toast slides down instead of fading.
8. **Model rows.** "Added by you" / "Assigned by org" badges get pill shape with inline dot (`bg-af-accent` / `bg-af-info`). Row hover lifts the background by one step + grows the delete button alpha from 0.6 to 1.
9. **Form inputs.** On focus: border becomes `border-af-accent` + halo ring `shadow-[0_0_0_3px_var(--af-accent-glow)]`. Replaces the current bare VS Code focus-border.
10. **Navigation transitions.** Route changes animate via `animate-af-pop-in` on the inner content, 180ms — avoids the current "blink" on navigation.

### 3.2 IDE sidebar webview (`gui/`)

**Current feel:** information-rich but crowded. Chat already looks solid; what's missing is the premium details.

**Changes:**

1. **TaskHeader redesign.** Two-line layout when expanded:
   - Line 1: cost + ContextBar + chevron (current)
   - Line 2: TokenBreakdown on the left, session elapsed time + model name on the right
   - Collapsed state: same as today, but cost pill gets an emerald dot when `cacheReadTokens > 0` (signals caching is working)
2. **ContextBar polish.** Active segment gets a subtle emerald glow when caching is active; pulse animation at 80%+ utilization (caution mode).
3. **TodoStrip.** Each todo row gets an avatar-sized status glyph: empty circle / half-filled pulse for in_progress / emerald check for completed. Items completing animate `AfSuccessCheck` inline (one-shot).
4. **ThinkingBlockPeek upgrade.** The outline pill button gets an emerald-tinted background when expanded (visually confirms "you're looking at the reasoning"). Shimmer label gets `variant="thinking"`.
5. **Chat message anatomy.** Assistant messages gain a 2px emerald accent rail on the left edge during streaming (disappears when complete). Makes the streaming message scannable even while scrolled.
6. **Tool card uplift.** `SimpleToolCallUI` border becomes `border-af-hairline`, header hover picks up `bg-af-accent/5`, running state shows inline `AfPulseHalo` on the tool icon.
7. **MultiFileDiffPanel.** Header gains an `AfSuccessCheck`-style stroke that draws in when all revert buttons have been resolved (reviewed state). File names in tree get truncation tooltip. Selected file in tree gets emerald left-rail + bold name.
8. **FirewallConsentCard.** Currently renders a block banner. Rebuild as an elevated card (`bg-af-surface-raised`, 1px emerald border) with shield icon + findings chips + 3-button row. Signals trust, not panic.
9. **ScanResultBanner.** Slim top-bar design: 2px emerald strip at the very top of chat for ALLOW, amber for REDACT, red for BLOCK. Auto-dismisses after 3s for ALLOW only.
10. **Sidebar bottom area.** We removed `AuthStatusBar`; the remaining `AccountDropdown` gets a small emerald pulse dot when the proxy is healthy (and red when unreachable) so users see live system status without a separate chrome element.

### 3.3 CLI TUI (`extensions/cli/`)

**Current feel:** functional Ink UI, heavy on plain text. Lacks the personality of Claude Code / aider.

**Changes:**

1. **Boot banner.** On `cn chat`, show a 3-line art banner (`▲ AI Firewall` emerald outline → cyan tag line → dim build info). Only on first boot per session.
2. **Prompt box redesign.** Current input is a thin box. New: 2-column prompt with an emerald `▎` accent on the left edge. When active, the accent pulses subtly (Ink interval render). Empty state placeholder text is `chalk.dim.italic("Ask anything, / to run a command, @ to add context")`.
3. **Status bar.** Current bar is a single row with bullets. New:
   - Left cluster: mode indicator (colored), context percentage with mini-bar (Unicode block chars), model name dim
   - Right cluster: session cost, free-trial status
   - Middle: live "token rate" display during streaming (`↓ 42 tok/s`) — emerald when cached, white otherwise
4. **Streaming response.** Currently prints tokens as they arrive with no visual cue. Add:
   - 2-character left-gutter `│ ` in emerald while streaming
   - On stream end, gutter flashes emerald `✔` then fades to dim
   - Cache-read tokens render in emerald underline (subtle signal that caching saved money)
5. **Tool call output.** Each tool invocation gets a bracketed header:
   ```
   ╭─ read_file  src/index.ts ···········  ⟳ 0.12s
   │ (file content)
   ╰─ ✔ 340 lines
   ```
   Uses Unicode box-drawing + emerald `✔` / cyan `⟳` / red `✖`.
6. **Firewall activity display.** Currently single-line status text. New vertical stepper using `AfStepper` CLI equivalent:
   ```
   ◉ scanning secrets
   ◉ scanning PII
   ● checking policy
   ○ routing
   ```
7. **Slash command help.** `/help` currently prints a flat list. New: two-column layout with command in emerald and description dim, grouped by section (Chat / Session / Account / Config).
8. **Error messages.** Rewrap: `╳ message` in red on dim-red background. Actionable hints indented under with `↳ hint text` in dim.
9. **Onboarding flow.** First-run `cn login` → `cn chat`: show a 3-step stepper banner (`① Sign in  ② Add a model  ③ Start chatting`) with the current step lit emerald. Collapses once all three are complete.
10. **Exit confirmation.** Currently prints text. New: centered emerald box with `Press Ctrl+C again to exit`, auto-clears after 2s.

---

## 4. Component-level cross-check (every Phase 0–3 artifact)

For each component already shipped, here's the polish delta.

| Component                   | Current state                          | Polish change                                                                                                                         |
| --------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `ContextBar`                | 3-seg bar, tooltip, hot at 50%         | Emerald glow on "used" seg when cache-read > 0, `animate-af-pulse` at ≥80%, endpoint labels use caption type                          |
| `TokenBreakdown`            | icon row, auto-hide zeros              | Icons use filled-emerald on cache-read, inline chips with `bg-af-surface-raised` on each row                                          |
| `TaskHeader`                | 1-line collapsed, expands to breakdown | 2-line expanded, elapsed-time + model-name on right; left rail accent emerald when chat active                                        |
| `TodoStrip`                 | text checklist                         | Avatar-sized status glyphs, success check animation on complete, header pill for "All done"                                           |
| `ReasoningBlock`            | outline pill + content                 | Emerald tint on expanded state, shimmer variant = "thinking", copy button on content                                                  |
| `TextShimmer`               | gradient sweep                         | Add preset variants + `prefers-reduced-motion` collapse                                                                               |
| `DiffChanges`               | +X −Y text                             | Inline dot + count pill form: `(+12 green dot) (−4 red dot)`                                                                          |
| `FileTree`                  | folder-grouped buttons                 | Active file gets emerald left-rail + bold; folder row gets collapse chevron; file count summary pinned at bottom                      |
| `FileAccordion`             | sticky header + body                   | Header chevron animates; revert button gets tooltip + confirmation on hover-hold; file name gets monospace + syntax-dim for extension |
| `UnifiedDiff`               | LCS + sticky gutter                    | Add syntax-highlight hook via existing `rehype-highlight`; wrap-lines toggle icon in top-right corner                                 |
| `MultiFileDiffPanel`        | summary + tree + accordions            | Header gets breadcrumb showing "N files · +A −D · reviewed R"; toggle moves into a segmented control with icon                        |
| `AuthStatusBar`             | _removed_                              | N/A — replaced by `AccountDropdown` (see 3.2 #10)                                                                                     |
| `AccountDropdown`           | avatar + email                         | Add proxy-health dot beside email, polish dropdown menu with icons, use `AfSuccessCheck` on "signed in" transition                    |
| `AddModelForm`              | provider/model dropdowns + key         | Dropdowns already using custom pickers — add step progress indicator at top (`① Provider ② Model ③ Key`)                              |
| `UserModelsTab` (org admin) | accordion per user                     | Avatar colors consistent (user id-hashed), hover glow, search filter above list                                                       |
| `UsersTab`                  | role select + invite                   | Same avatar + hover treatment, invite form animates slide-down                                                                        |
| `ProvidersTab`              | list + expand                          | Cards get subtle elevation, model table gets striped rows, new provider button gets emerald glow                                      |
| `OrgSettingsPage`           | tab bar + content                      | Tab active state gets 2px emerald underline with slide animation when switching                                                       |
| `ModelsPage`                | list + badges                          | Already has badges — add card elevation + hover, "Add Model" CTA emerald with glow                                                    |

---

## 4b. Newly-identified gaps (field-report additions)

Added after the first round of user testing. Each ties to a specific failure mode the user observed on screen.

### 4b.1 Firewall consent — kill the fallback modal

**Symptom:** a yellow-bordered popover card floats over chat content saying "AI Firewall flagged this request — Choose how to proceed in the consent card above the chat input" with a single "Review & resubmit" button. Blocks the whole view, looks alarming.

**Root cause:** `gui/src/pages/gui/StreamError.tsx:128-267` contains a fallback modal path that fires via `TextDialog` when the firewall block error reaches the generic error handler without its typed `detail`. Intended design is that `FirewallBlockedRequestError` → `setPendingFirewallConsent(detail)` → inline `FirewallConsentCard` at the bottom of the chat. The fallback exists because `detail` sometimes gets stripped crossing the IPC boundary.

**Fix (priority CRITICAL):**

1. Preserve the structured `BlockDetail` through the IDE messenger. When the error is a `FirewallBlockedRequestError`, serialize its `detail` into the error payload explicitly; when the GUI receives it, hydrate back into `setPendingFirewallConsent`.
2. Delete the `TextDialog`-based fallback entirely. If detail is truly missing (shouldn't happen post-fix), render a subtle inline banner above the input — never a modal.
3. Visual polish on the inline `FirewallConsentCard` — slim 1px emerald border, shield-shaped icon (not warning triangle), three clear actions (Redact & send / Send as-is / Cancel). Signals trust and authority, not panic.

### 4b.2 CLI sticky TODO strip

**Symptom:** the todoWrite tool works in the IDE but nothing shows up in the CLI TUI. The agent writes a checklist; the user sees markdown output once then loses it.

**Root cause:** `extensions/cli/src/ui/TUIChat.tsx` has no bridge from tool output → persistent UI. The GUI pattern-matches `uri.type === "todo_write"` in `callToolById.ts` and dispatches Redux; the CLI has no equivalent.

**Fix:**

1. New component `extensions/cli/src/ui/components/CLITodoStrip.tsx` — Ink `<Box>` that renders above the input in `TUIChat.tsx`. Mirrors the GUI `TodoStrip`: collapsed header "`3/5 completed`", expandable to full list with status glyphs (`○` pending, `◐` in-progress in emerald, `✔` completed in emerald, `⨯` cancelled in dim).
2. New bridge in `extensions/cli/src/hooks/useChat.ts` (or wherever tool outputs are processed) — when a `todo_write` URI is detected in tool output, update a local todos state ref and pass it to `<CLITodoStrip>`.
3. Persistent behaviour: strip stays visible above the input across assistant turns; auto-collapses after 2s of inactivity once the list is `all done`, but tapping the input expands it again (user can always peek).

### 4b.3 IDE TodoStrip / TaskHeader — kilocode-parity polish

**Current state:** `TodoStrip` renders inside `TaskHeader` at the top of chat. Functional, polished per P4. But compared to kilocode's production reference:

- Kilocode's TaskHeader shows **session title + cost + compact button** on a line, with todos as a discrete collapsible section underneath. Ours collapses cost + context bar together; no title.
- Kilocode's todos group into **phases / sections** when the agent provides them (e.g. "Phase 1: Discovery", "Phase 2: Implementation") with headings and progress per phase.
- Kilocode's timeline is a separate collapsible strip with colored bars per turn-part.

**Fix (priority HIGH for visual parity):**

1. Extend `TodoItem` in `todosSlice.ts` with an optional `phase?: string` field.
2. Update `todoWrite` tool definition to advertise the `phase` field so models can group items.
3. `TodoStrip` groups by `phase` when any item has one, rendering each phase as a heading with its own "X/Y completed" progress bar underneath, followed by that phase's items. Plain (unphased) lists continue to render as a flat checklist.
4. Add a dedicated `TaskTitle` line to `TaskHeader` showing the first user message truncated (the "session title" kilocode shows), pulled from `state.session.title` when available.
5. Timeline (Phase 6 from the original plan) gets explicitly called out as "ship after todo phases" — both benefit from the same header real estate.

### 4b.4 Reasoning progression display

**Gap:** while reasoning streams, we show a shimmering "Thinking…" label but no **progression** — the user can't see what the model is working through without expanding the pill. Kilocode streams reasoning content inline as it arrives.

**Fix:**

1. Extend `ReasoningBlock` with a streaming preview — show the last ~2 lines of the reasoning text under the pill (even when collapsed), dimmed, replacing every ~200ms. Gives a live "I'm thinking about…" effect without opening the panel.
2. In `StepContainer`, when a message has both reasoning + final content, render the reasoning block above the content with the streaming preview, then fold into the collapsed pill once the final content starts.

---

## 4c. Pagination + search — field report

**Symptom:** every list in the web dashboard loads 100% of rows into the DOM. Orgs with 500+ users, 10K+ audit log entries, or even just 100 tasks start to feel sluggish or broken. No table has a search box; users scroll the browser's find-in-page.

**Scope — inventoried list surfaces:**

| Surface         | Where                               | Typical rows | Current state                                    |
| --------------- | ----------------------------------- | ------------ | ------------------------------------------------ |
| Audit Log       | `pages/org/tabs/AuditTab.tsx`       | 10K – 1M     | server pagination via `?limit&offset`, no search |
| Users           | `pages/org/tabs/UsersTab.tsx`       | 10–500       | loads all, no search                             |
| Team members    | `pages/team/tabs/MembersTab.tsx`    | 5–50         | loads all, no search                             |
| Providers       | `pages/org/tabs/ProvidersTab.tsx`   | 5–20         | loads all                                        |
| Model grants    | `pages/org/tabs/UserModelsTab.tsx`  | 10–500 users | loads all users                                  |
| Roles           | `pages/rbac/RbacPage.tsx`           | 5–15         | loads all                                        |
| Tasks           | `pages/tasks/TasksPage.tsx`         | 100–10K      | fixed `limit=50`, tab filters                    |
| Memory          | `pages/memory/MemoryPage.tsx`       | 10–100       | loads all, tab filters                           |
| Agents          | `pages/agents/AgentManagerPage.tsx` | 0–10         | DataTable, no pag                                |
| Plugins         | `pages/plugins/PluginsPage.tsx`     | 5–20         | loads all                                        |
| Usage breakdown | `pages/usage/UsagePage.tsx`         | 10–50        | DataTable                                        |

Two data-size buckets call for different strategies:

- **Client-side (rows ≤ 500):** Users, team members, providers, roles, plugins, memory, grants, agents, usage-by-model. The backend continues returning the flat array; frontend slices it locally. No API changes. Fast to ship.
- **Server-side (rows > 1K):** Audit logs, tasks, security scan history. Backend migrates to the uniform `{items, total, page, pageSize}` contract; frontend hits `?page&pageSize&search&sort`. Schema-level change.

**Uniform contract (both buckets adopt the same shape):**

```ts
// Backend response
interface ListResponse<T> {
  items: T[];
  total: number;
  page: number; // 1-indexed
  pageSize: number; // default 20
  hasMore: boolean;
}

// Frontend request
interface ListQuery {
  page?: number; // default 1
  pageSize?: number; // default 20; range 10–100
  search?: string; // free text, backend decides fields
  sort?: string; // "field" asc, "-field" desc
}
```

**Shared UI primitives to build:**

1. **`<Pagination>`** — compact rail with `‹ 1 2 … 9 10 ›` + page-size select + total count. Theme-aware, keyboard-navigable.
2. **`<SearchInput>` (already exists)** — just wire it into the new hook.
3. **`useTableControls<T>({ items, pageSize, searchKeys })`** — client-side: filters + paginates an array. Returns `{ visibleItems, page, pageSize, setPage, search, setSearch, total }`.
4. **`useServerTable<T>({ endpoint, pageSize })`** — server-side: fetches with `?page&pageSize&search`, caches, re-fetches on param change.
5. **`<PaginatedTable>`** — opinionated wrapper pairing `DataTable` + `<Pagination>` + `<SearchInput>` into one component. Most callers want this single component, not the hooks directly.

**Adoption order (this session focuses on the 3 explicit asks):**

- [x] Users (org admin) — client-side, 20/page, search by email/name/role
- [x] Roles — client-side, 20/page, search by name/description
- [x] Model Access (UserModelsTab) — client-side user list, 20/page, search
- [ ] Team members — next pass
- [ ] Audit Log — server-side migration
- [ ] Tasks — server-side migration

**Risks:**

- Audit log server migration changes the response shape; existing call sites break. Mitigate by keeping the legacy `{logs, total}` shape alongside the new `{items, total, page, pageSize}` for one release.
- Search on Users filtering "admin" finds both the admin role holder AND anyone whose name contains "admin". Scope search to explicit fields (email, name, role) rather than stringify-everything to prevent surprises.

---

## 5. Updated phase roadmap

Existing phases from `kilocode-ux-gap-analysis-plan.md` + new polish phases, reordered for shippability.

| Phase                                            | Scope                                                                                                                                                                                                                                                                    | Status                                               | Effort   |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------- | -------- |
| **0**                                            | Theme tokens + SessionStats                                                                                                                                                                                                                                              | ✅ shipped                                           | -        |
| **1**                                            | ContextBar + TokenBreakdown + TaskHeader + CLI                                                                                                                                                                                                                           | ✅ shipped                                           | -        |
| **2.1**                                          | TextShimmer + ReasoningBlock                                                                                                                                                                                                                                             | ✅ shipped (component; not wired into StepContainer) | -        |
| **2.2**                                          | todosSlice + TodoStrip                                                                                                                                                                                                                                                   | ✅ shipped                                           | -        |
| **2.3**                                          | todoWrite + todoRead tools                                                                                                                                                                                                                                               | ✅ shipped                                           | -        |
| **2.4**                                          | Tool-output → Redux bridge                                                                                                                                                                                                                                               | ✅ shipped                                           | -        |
| **3**                                            | MultiFileDiffPanel family                                                                                                                                                                                                                                                | ✅ shipped (components; not wired into EditFile)     | -        |
| **NEW P1 — Identity tokens**                     | §1.1 + §1.2 + §1.3 locked in; `af-*` tokens added to Tailwind; animation keyframes extended                                                                                                                                                                              | new                                                  | 1 day    |
| **NEW P2 — Loader system**                       | §2.2 + §2.3 built: 7 web components + 7 CLI helpers                                                                                                                                                                                                                      | new                                                  | 1.5 days |
| **NEW P3 — Polish pass: web dashboard**          | §3.1 all 10 items                                                                                                                                                                                                                                                        | new                                                  | 1.5 days |
| **NEW P4 — Polish pass: IDE sidebar**            | §3.2 all 10 items                                                                                                                                                                                                                                                        | new                                                  | 1.5 days |
| **NEW P5 — Polish pass: CLI TUI**                | §3.3 all 10 items                                                                                                                                                                                                                                                        | new                                                  | 1 day    |
| **NEW P6 — Component cross-check sweep**         | §4 — walk every shipped component, apply outstanding token/motion/loader updates                                                                                                                                                                                         | ✅ shipped                                           | -        |
| **NEW P7 — Firewall consent popover fix**        | §4b.1: preserve `BlockDetail` through IPC, delete `TextDialog` fallback, polish inline `FirewallConsentCard`                                                                                                                                                             | new                                                  | 0.5 day  |
| **NEW P8 — CLI sticky TODO strip**               | §4b.2: `CLITodoStrip` Ink component + tool-output bridge in `useChat.ts`                                                                                                                                                                                                 | new                                                  | 0.5 day  |
| **NEW P9 — TodoStrip phases + TaskHeader title** | §4b.3: optional `phase` field, grouped rendering, session title on header                                                                                                                                                                                                | new                                                  | 0.5 day  |
| **NEW P10 — Reasoning streaming preview**        | §4b.4: live last-2-lines preview under collapsed pill                                                                                                                                                                                                                    | ✅ shipped                                           | -        |
| **NEW P11 — Paginated + searchable tables**      | see §4c — uniform contract `{items, total, page, pageSize}` + `<PaginatedTable>` wrapper + `useTableControls` hook; default pageSize=20; client-side for small lists (users, roles, plugins, memory, grants), server-side migration for large lists (audit, tasks, logs) | new                                                  | 2 days   |
| **NEW P12 — CLI TUI polish**                     | §3.3 + P5: boot banner, 2-column prompt w/ pulsing accent, live tok/s during streaming, bracketed tool-call output, vertical firewall stepper                                                                                                                            | new                                                  | 1 day    |
| **NEW P13 — Capability constants**               | follow-up to BUG-PERM: export `CAP.*` const from `proxy/src/db/database.ts` so `requireCapability(CAP.policies_edit)` is compile-checked. Prevents future dot/colon spelling drift.                                                                                      | new                                                  | 0.5 day  |
| **4**                                            | Tool card polish (status vocabulary, copy, scroll)                                                                                                                                                                                                                       | existing — folded into NEW P4                        | --       |
| **5**                                            | Virtualized message list + load-older + per-turn copy                                                                                                                                                                                                                    | existing                                             | 2–3 days |
| **6**                                            | TaskTimeline (stretch)                                                                                                                                                                                                                                                   | existing                                             | 3 days   |
| **7**                                            | ModelPreviewCard                                                                                                                                                                                                                                                         | existing                                             | 2 days   |
| **Wiring stragglers**                            | ReasoningBlock → StepContainer; MultiFileDiffPanel → EditFile/FindAndReplace                                                                                                                                                                                             | existing                                             | 1 day    |

**New-work total: 6–7 dev days.** Combined with existing Phase 5–7 + stragglers: **15–18 days for a fully polished feature-complete product.**

### Recommended shipping order

1. **NEW P1 (Identity tokens)** — prerequisites for everything else. 1 day. Ship first.
2. **NEW P2 (Loader system)** — high-leverage; every page benefits. 1.5 days.
3. **NEW P3–P5 (per-surface polish)** — can run in parallel if multiple people. 4 days.
4. **NEW P6 (cross-check sweep)** — catches anything missed. 1 day.
5. **Wiring stragglers** — small; fold in during P3–P5.
6. **Phase 5 / 6 / 7** — remaining functional pieces, unchanged schedule.

---

## 6. What "done" looks like

Ship criteria for the polish work (not the features):

1. **Unified accent** — any user can flip through web / IDE / CLI and recognize "this is the same product." One look, one color story.
2. **No more generic spinners.** Every async surface uses a loader from §2.2 or §2.3, picked by intent.
3. **Motion grammar.** Six named animations, consistently applied. Any new component picks from the set instead of inventing.
4. **No hardcoded hex colors** outside `tokens.css` and `index.css` (audited via grep).
5. **Reduced motion respected.** `prefers-reduced-motion: reduce` collapses all infinite animations to static state; one-shot animations become instant.
6. **Empty states feel intentional.** Every list page has an illustrated empty state with a clear CTA, not a "No items" string.
7. **Success moments feel good.** Copy, save, grant, connect all animate a checkmark stroke; no silent state changes.
8. **Errors don't panic-mode.** Block/error surfaces communicate authority, not alarm — shield iconography, emerald border with red fill on the inside, not the other way around.
9. **CLI has personality.** Boot banner, bracket output headers, stepper status — the CLI looks like a deliberately designed tool, not a `console.log` wrapper.
10. **Accessibility pass.** Every new component has `aria-label` / `aria-live` where appropriate, focus-visible outline in `--af-accent`, reduced-motion honored.

---

## 7. Risks + mitigations

| Risk                                               | Likelihood | Impact | Mitigation                                                                                                                                                 |
| -------------------------------------------------- | ---------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Emerald+cyan clashes with some user VS Code themes | Medium     | Low    | Accent only used for product identity surfaces (CTAs, headers); semantic roles (error/warning/success) keep VS Code tokens so the editor theme still rules |
| New animations feel too busy / distracting         | Medium     | Medium | All infinite animations respect reduced-motion; durations tuned to be noticed-not-seen; each surface uses ≤3 active animations at once                     |
| CLI changes break automated scripts parsing output | Low        | Medium | New ornaments only render when stdout is a TTY; piped output stays plain                                                                                   |
| Shipping in parallel introduces inconsistencies    | Medium     | Medium | P1 (tokens) must land before P3–P5 start; P6 catches residuals                                                                                             |
| Token file bloat                                   | Low        | Low    | `tokens.css` stays under 200 lines; Tailwind tree-shakes unused utilities                                                                                  |

---

## 8. Next step

Review + approve. Once approved, I start with **NEW P1 (Identity tokens)** — single-commit diff, ~1 day, purely additive to `tokens.css` + `tailwind.config.cjs`. Everything downstream builds on it.

---

**Document owner:** Siddartha (siddartha.yekollu@recykal.com)
**Reviewer action:** approve scope → begin NEW P1.
