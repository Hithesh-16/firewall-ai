# UI / UX Design Plan — Parity Pass

Author: Apr 23, 2026 · Owner: GUI + Web polish track

## Why this plan exists

Two asks came in simultaneously:

1. Design system standardisation — one set of tokens, one component vocabulary, same look across CLI / IDE / Web.
2. Kilocode-inspired polish — visible token usage, phase-of-communication UI, sticky Plan/Todo strips, shimmering loaders while the LLM thinks.

Rather than green-field these, every item below maps to an **existing** file in this monorepo. We either already have it (polish pass), or the primitive exists and we need to wire it into one more surface. Nothing in this plan is a from-scratch build.

## What we already have (inventory)

### Loader primitives — `gui/src/components/loaders/`

| File                                              | Used for                                   |
| ------------------------------------------------- | ------------------------------------------ |
| `AfProgressBar.tsx`                               | Token-usage bar, step progress             |
| `AfPulseHalo.tsx`                                 | Scanner "scanning…" pulse                  |
| `AfSkeleton.tsx`                                  | Placeholder while lists load               |
| `AfSpinner.tsx`                                   | Inline button spinners                     |
| `AfStepper.tsx`                                   | Vertical phase stepper (firewall pipeline) |
| `AfSuccessCheck.tsx`                              | One-shot tick for policy ALLOW             |
| `AfTextShimmer.tsx`                               | "AI is thinking…" shimmer                  |
| `BlinkingDot.tsx`, `RingLoader.tsx`, `Loader.tsx` | Lower-level primitives                     |

### Chat surfaces — `gui/src/components/chat/`

| File                     | Purpose                                             |
| ------------------------ | --------------------------------------------------- |
| `TaskHeader.tsx`         | Top bar on chat: session, elapsed, cache-active dot |
| `TokenBreakdown.tsx`     | Prompt/output/cache token pills                     |
| `ContextBar.tsx`         | Shows attached files / context selection            |
| `TodoStrip.tsx`          | Sticky todo list from `todo_write` tool output      |
| `ReasoningBlock.tsx`     | Streams the model's `reasoning` channel             |
| `StickyPromptHeader.tsx` | Pins the user's last prompt at top while streaming  |

### Diff surface — `gui/src/components/diff/`

`MultiFileDiffPanel` + `FileAccordion` + `UnifiedDiff` + `SideBySideDiff` — used by EditFile/FindAndReplace tools. Already consistent with theme tokens.

### Theme / tokens

- `gui/tailwind.config.cjs` exposes `bg-background`, `text-foreground`, `text-description`, `bg-editor`, `border-border`, `text-info`, `text-warning`, `text-error`, `text-success`, `bg-primary`, `bg-badge` — every component in the new design must use these.
- `gui/src/styles/tokens.css` holds the emerald-cyan identity gradient + motion vocab (`afw-animate-fade-up`, etc).
- Web dashboard uses the same Tailwind theme classes (mapped to the AI Firewall identity rather than VS Code's `--vscode-*`).

## What the design doc asks for — mapped to reality

### 1. Severity colour system

The pasted doc mandates `danger` / `warning` / `safe` / `info` semantic tokens. We already have `text-error` / `text-warning` / `text-success` / `text-info`. **Gap**: nothing currently enforces this in scanner/policy badges. A few places still use raw `red-500` / `yellow-500` hex-ish Tailwind.

**Action**: one sweep across `gui/src/components/` and `web/src/components/` to replace raw palette classes with semantic tokens. File count from grep is ~12 components — bounded, low-risk.

### 2. Heights (32/40/48)

Our `Button` component currently exposes `sm` / `md` / `lg` but the sizes don't map cleanly to 32/40/48. A pass on `web/src/components/ui/Button.tsx` + the same component in `gui/` aligns them.

**Action**: bump `sm` → 32px (h-8), `md` → 40px (h-10), `lg` → 48px (h-12). Applies to `Button`, `SearchInput`, `Input` by default. Dropdowns already at 40.

### 3. Token-usage bar that expands while streaming

kilocode does this as a thin accent bar at the top of the chat area that grows rightward as tokens are consumed, flipping amber at ~80% of the model's context window and red near 100%.

**Gap**: we have `TokenBreakdown.tsx` (pills showing numbers) and `AfProgressBar.tsx` (generic progress). They're not composed.

**Action**: new thin component `gui/src/components/chat/TokenUsageBar.tsx` that:

- Mounts directly under `TaskHeader`
- Reads `messages[*].usage` from Redux + `config.selectedModelByRole.chat.contextLength`
- Renders `AfProgressBar` coloured via `text-success` < 60% · `text-warning` 60–85% · `text-error` > 85%
- Tooltip on hover shows the `TokenBreakdown` pill set (reuse, not rewrite)

Ship as a new child of `Chat.tsx` below the header. Respect the "only show when there's been ≥1 turn" visibility gate.

### 4. Phases-of-communication UI

kilocode renders a small 4-step trail in the response while the LLM is streaming: **Scanning → Policy → LLM → Response**. We already have `AfStepper` and a firewall-scan flow but they're not wired into the chat response.

**Action**: reuse `AfStepper.tsx`. Compose into a new `gui/src/components/chat/ResponsePhases.tsx` that reads from Redux `session.streamState`. The existing scanner middleware in `packages/fetch` already emits step events via `onScanResult` → Redux — we just aren't displaying them in the chat turn. Attach above the assistant message bubble while `status === "pending"`; collapse to a tiny "scanned · allowed" chip once done.

### 5. Shimmering / "thinking" state

`AfTextShimmer` already exists. It's used in onboarding but not in chat.

**Action**: when the assistant message has `content === ""` and `status === "pending"`, render `<AfTextShimmer>` inside the bubble with the current phase from step 4 as the label ("Scanning…" / "Checking policy…" / "Generating…"). Swap to real text as soon as the first token arrives.

### 6. Sticky Plan + Todo strips

`TodoStrip.tsx` already renders todos at the top of the chat when the agent writes one. `StickyPromptHeader.tsx` already pins the user's last prompt. **Gap**: they're not both visible at once and they don't stay pinned while scrolling back through history.

**Action**: lift both into a stacked sticky container in `Chat.tsx`:

```
┌───────────────────────── TaskHeader ─────────────────────────┐
│ TokenUsageBar  (new — thin, reactive)                        │
│ StickyPromptHeader (user's last msg)                         │
│ TodoStrip (when plan exists, ≥3 items)                       │
└──────────────────────────────────────────────────────────────┘
  ↓ scrollable chat area ↓
```

CSS: `position: sticky; top: 0` with `z-index` stacking. Each sub-strip has `shouldRender` logic so empty states don't reserve space.

### 7. CLI parity — same vocabulary

The CLI TUI already has equivalents but named differently:

| GUI                  | CLI (extensions/cli/src/ui)                                   |
| -------------------- | ------------------------------------------------------------- |
| `AfSpinner`          | Ink spinner component                                         |
| `AfStepper` (phases) | `components/StepDisplay.tsx` (similar shape)                  |
| `TodoStrip`          | `components/CLITodoStrip.tsx` (already mirrors)               |
| `TokenBreakdown`     | `util/sessionMetrics.ts` formats a line via `onSystemMessage` |

**Action**: one pass on the CLI to ensure every phase the GUI shows as a step has a corresponding log line. The firewall-scan stepper (P12c) is already shipped. Token usage footer ships too. Remaining: a one-line "Scanning → Policy → LLM" marker at the start of each tool call, not just at the end.

## Priority & effort

Order matters — each step is a visible, ship-able slice. No long-running branches.

| #   | Slice                                        | Est effort | Surfaces touched                  |
| --- | -------------------------------------------- | ---------- | --------------------------------- |
| 1   | Semantic-token sweep (danger/warning/info)   | 2 h        | gui/ + web/ (~12 files)           |
| 2   | Button / Input height alignment (32/40/48)   | 1 h        | ui/Button.tsx, ui/SearchInput.tsx |
| 3   | `TokenUsageBar` component + Chat wiring      | 3 h        | gui/                              |
| 4   | `ResponsePhases` stepper + streamState reads | 4 h        | gui/ + minor core/ wiring         |
| 5   | Shimmer-while-thinking on empty bubbles      | 1 h        | gui/                              |
| 6   | Sticky stacked strip (Todo + Prompt + Usage) | 2 h        | gui/ Chat.tsx + CSS               |
| 7   | CLI phase-marker parity                      | 2 h        | extensions/cli/src/stream/        |
| 8   | Docs: tokens.md + component catalogue page   | 1 h        | docs/                             |

Total: ~16 h. Each item is independently shippable.

## What we deliberately skip (and why)

- **Rebuilding any loader/primitive.** We already have ten of them — we just aren't using them in enough places.
- **A new design-system package.** Tailwind + CSS variables already do this; a separate package adds build complexity without benefit at this scale.
- **Mobile-first redesign.** The IDE webview is desktop-only; the web dashboard is functional on mobile but not a priority right now. Keep responsive classes, don't refactor layouts.
- **Theming for individual users.** VS Code theme passthrough already exists; changing that would break every user's current look.

## Anti-patterns to actively fix during the sweep

1. **Hardcoded colours.** `text-white`, `bg-gray-600`, `#ef4444` — replace with semantic tokens. Grep finds ~30 instances across web/gui.
2. **Silent blocks.** Any code path that drops data without rendering a reason is a regression. The firewall-block inline consent is the template.
3. **Inconsistent heights.** Buttons next to inputs that don't line up because one is `py-1.5` and the other `py-2`.
4. **Duplicated loader SVGs.** Anything re-implementing a spinner inline instead of using `AfSpinner`.

## Kilocode — items we picked from vs. items we didn't

**Picked:**

- Expanding token bar at the top of the chat.
- Phase-stepper inside streaming assistant turns.
- Sticky Plan/Todo that never scrolls off.
- Shimmering labels while waiting for first token.
- Tool-call glyph vocabulary (`⟳` pending / `◐` in-progress / `✔` done / `✖` failed — already shipped P12b).

**Skipped:**

- Their `.kilo/*.md` filesystem-based config. We already chose a hybrid: DB for org-shared rules, local files for personal. Going pure-file would re-introduce the cross-device drift we just fixed.
- Their per-session cloud sync. Sessions are local-only in AI Firewall — enough; cloud sync is enterprise-flagged in the product-vision doc but not Phase 1.
- Legacy VSCode-extension mode migration. Not applicable — we never shipped modes.

## How this plugs into the backend refactor we just shipped

Nothing in this plan requires new API routes. Every data source already exists:

- Token counts → `messages[].usage` (gateway already writes `prompt_tokens`, `completion_tokens`, `cache_read_tokens`).
- Context length → `config.selectedModelByRole.chat.contextLength` (populated by the synthesised `/api/me/assistant`).
- Scan phases → `packages/fetch/src/scanHeaders.ts` already emits `X-AF-*` headers + fires `onScanResult`.
- Policy outcome → the fetch wrapper dispatches to Redux; `ResponsePhases` reads the same slice.

The only thing this plan can **block** on is if a phase doesn't fire an event — those we'll add as one-liner dispatches in the gateway.

## Definition of done

- Every shared UI component (Button / Input / Badge / Card / EmptyState / Pagination / SearchInput) uses semantic tokens exclusively.
- Chat shows: TaskHeader → TokenUsageBar → StickyPromptHeader → TodoStrip → scrollable turns, with each layer respecting `shouldRender` rules so empty states vanish.
- Streaming assistant messages render `ResponsePhases` until the first token, then `AfTextShimmer` until the third token, then the real stream.
- A red-token-bar test case ("send a 200K-token prompt against a 32K model") shows the bar going red + a warning toast before dispatch.
- CLI prints the same phase labels as the GUI for every tool call.
- No new dependencies added. All work within existing packages.

## Open questions (for you to decide)

1. **Token-usage warning threshold**: kilocode uses 60/85. Keep or tune to AI Firewall's scan-aware context estimation (which is often over-reports)?
2. **Phase visibility for ALLOW**: when policy allows a request, should we still flash the 4-step stepper, or skip straight to streaming? Kilocode always shows it; I lean towards "yes, but auto-collapse once phase 3 starts" so users build mental model.
3. **Skills / rules catalogue discovery on the chat page**: ping-pong between "show a banner when an org pushes a new rule" vs "only surface in Settings". Kilocode does the banner; I think a badge on the settings nav entry is enough.

Ping if you want 1/2/3 decided before slice 1 ships.
