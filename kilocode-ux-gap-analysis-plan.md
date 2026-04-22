# Kilocode UX Gap Analysis & Implementation Plan

**Target repo:** `continue-main` (AI Firewall)
**Reference repo:** `kilocode/` (vendored under `continue-main/kilocode/`)
**Focus areas:** Token utilization bars · Reasoning display · Todos · Planning · Multi-file diff · Chat UI polish
**Date:** 2026-04-22
**Status:** Draft — awaiting implementation approval

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Methodology](#2-methodology)
3. [Part A — UX Gap Map](#part-a--ux-gap-map)
   - A1. Token / Context Usage Display
   - A2. Reasoning / Thinking Blocks
   - A3. Todos in Chat
   - A4. Session Timeline
   - A5. Tool Call Rendering
   - A6. Diff Rendering for File Edits
   - A7. Chat Message Anatomy
   - A8. Model Selector
   - A9. Streaming Animations
   - A10. Design Tokens / Theming
4. [Part B — Implementation Plan (Phased)](#part-b--implementation-plan-phased)
5. [Part C — Data Flow Changes](#part-c--data-flow-changes)
6. [Part D — File-Level Touch List](#part-d--file-level-touch-list)
7. [Part E — Sequenced Milestones & Timeline](#part-e--sequenced-milestones--timeline)
8. [Part F — Risks & Mitigations](#part-f--risks--mitigations)
9. [Part G — Success Metrics](#part-g--success-metrics)
10. [Appendix — Reference File Map](#appendix--reference-file-map)

---

## 1. Executive Summary

Kilocode ships a production-grade agentic chat UX that is markedly ahead of continue-main in five visible areas:

| #   | Area                         | Kilocode edge                                                                                |
| --- | ---------------------------- | -------------------------------------------------------------------------------------------- |
| 1   | **Context window bar**       | Three-segment bar (used / reserved / available) with threshold-aware "hot" coloring at 50%+  |
| 2   | **Cache & reasoning tokens** | Separate up/down-arrow rows in the task header with icons                                    |
| 3   | **Reasoning block**          | Inline collapsible "Thought process" section per message with duration + tokens              |
| 4   | **Todo list**                | Live checklist in a sticky header, strikethrough + green "All done" state                    |
| 5   | **Multi-file diff**          | Accordion panel with file tree, sticky per-file headers, split/unified toggle, revert button |

Continue-main already has solid foundations — Redux state, Tailwind + VSCode-theme mapping, `FirewallConsentCard`, a functional `ToolCallDiv`, inline + side-by-side diff components, and a `PlanPanel`. The work below is **additive, mostly UI-layer**, and falls cleanly into phased slices.

**Headline estimate:** The "token bar + reasoning + todos + diff UX" parity goal needs **~10–13 dev days** (Phases 0–3). Full polish including timeline and virtualization lands in **~21–26 days**.

**Recommended first PR:** Phase 0 + Phase 1 bundled — additive theme tokens, extended Redux `sessionStats`, new `ContextBar`/`TokenBreakdown`/`TaskHeader` components, plus CLI parity. Self-contained, shippable slice.

---

## 2. Methodology

Two parallel deep-scans were run:

1. **Kilocode UX inventory** — walked `packages/kilo-vscode/webview-ui/`, `packages/kilo-ui/`, `packages/opencode/src/` and extracted component file paths, JSX/TSX snippets, CSS tokens, and animation keyframes for every visible pattern.
2. **Continue-main GUI inventory** — walked `gui/src/`, `extensions/cli/src/ui/`, `extensions/vscode/src/` to catalog existing primitives (markdown renderer, diff views, Redux slices, `StepContainer`, `FirewallConsentCard`, `sessionMetrics.ts`) and identify the precise seams for insertion.

Every gap entry below cites the kilocode source (pattern reference) and the continue-main target (where to put it).

---

## Part A — UX Gap Map

Legend: ✅ exists · ⚠️ partial · ❌ missing

### A1. Token / Context Usage Display

| Feature                                             | Kilocode                                                                                                                            | Continue-main                                                                   | Gap                                                         |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 3-segment context bar (used / reserved / available) | ✅ `packages/kilo-vscode/webview-ui/src/components/chat/ContextProgress.tsx` — sticky in TaskHeader, threshold-aware "hot" red ≥50% | ❌ — only `MessageCostBadge` shows raw `N tok · $`                              | Build `ContextBar` component                                |
| Cache-read vs cache-write tokens with icons         | ✅ `TaskHeader.tsx` with ↑/↓ arrows                                                                                                 | ⚠️ data flows in `promptLogs.cacheReadTokens/cacheWriteTokens` but no UI        | Extend `MessageCostBadge` + new `TokenBreakdown`            |
| Model context-window limit driven                   | ✅ reads `model.limit.context` + `model.limit.output`                                                                               | ❌ UI unaware of model context size                                             | Thread through `packages/llm-info/`                         |
| Pre-send token estimate for prompt                  | ❌ (neither)                                                                                                                        | ❌                                                                              | New — show "≈ 4.2K tokens will be sent" next to send button |
| Cost breakdown by turn, collapsible older sessions  | ✅ `collapseCostBreakdown()` tooltip                                                                                                | ⚠️ `SessionCostBadge` total only                                                | Extend with hover tooltip                                   |
| TUI ASCII context bar                               | —                                                                                                                                   | ✅ already in `extensions/cli/src/util/sessionMetrics.ts::formatUtilizationBar` | Keep + wire to streaming                                    |
| Real-time token counter during streaming            | ❌                                                                                                                                  | ❌                                                                              | New — visible in status bar                                 |

**Kilocode reference pattern:**

```tsx
// packages/kilo-vscode/webview-ui/src/components/chat/ContextProgress.tsx
<div class="context-progress-bar">
  <div
    class="context-progress-used"
    classList={{ "context-progress-used--hot": pctUsed >= 50 }}
    style={{ width: `${pctUsed}%` }}
  />
  <div class="context-progress-reserved" style={{ width: `${pctReserved}%` }} />
  <Show when={pctAvail > 0}>
    <div class="context-progress-available" style={{ width: `${pctAvail}%` }} />
  </Show>
</div>
```

**CSS reference (`packages/kilo-vscode/webview-ui/src/styles/task-header.css:138-187`):**

```css
.context-progress-bar {
  display: flex;
  align-items: center;
  height: 4px;
  border-radius: 2px;
  overflow: hidden;
  background: color-mix(in srgb, var(--vscode-foreground) 20%, transparent);
}
.context-progress-used {
  height: 100%;
  background: var(--vscode-foreground);
  transition:
    width 0.3s ease-out,
    background 0.3s ease-out;
}
.context-progress-used--hot {
  background: color-mix(
    in srgb,
    var(--vscode-errorForeground) 60%,
    rgba(128, 0, 0, 1)
  );
}
.context-progress-reserved {
  background: color-mix(in srgb, var(--vscode-foreground) 30%, transparent);
}
```

### A2. Reasoning / Thinking Blocks

| Feature                                        | Kilocode                                                | Continue-main                                                                               | Gap                                                |
| ---------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Inline reasoning part with collapsible section | ✅ `PART_MAPPING["reasoning"]` + `--tl-reasoning` color | ⚠️ `ThinkingBlockPeek` exists but only in input area — not in historical assistant messages | Add `<ReasoningBlock>` as first-class message part |
| Reasoning token count shown per message        | ✅ tracked in breakdown                                 | ⚠️ `thinkingTokens` in `promptLogs`, not displayed                                          | Wire into `MessageCostBadge`                       |
| "Thinking…" shimmer placeholder                | ✅ `<TextShimmer text={t("thinking")}/>`                | ✅ `ThinkingIndicator` (animated ellipsis)                                                  | Replace with gradient shimmer for modernity        |
| Timeline color swatch for reasoning            | ✅ `--tl-reasoning`                                     | ❌                                                                                          | Add theme token when building timeline (A4)        |

### A3. Todos in Chat

| Feature                                     | Kilocode                                                                         | Continue-main                                                   | Gap                                                             |
| ------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------- |
| Todo tool writes checklist                  | ✅ `todowrite`/`todoread` tools                                                  | ❌ no todo tools                                                | Add `core/tools/implementations/todoWrite.ts` + `todoRead.ts`   |
| Collapsible todo list in sticky header      | ✅ `TaskHeader` todos section — "X/Y completed", strikethrough, green "All done" | ⚠️ `PlanPanel.tsx` has similar look but for a different concept | Reuse `PlanPanel` styling as reference, wire to new todos state |
| Read-only checkboxes reflecting agent state | ✅                                                                               | ❌                                                              | Build                                                           |
| Live update as agent completes items        | ✅ Solid signal-driven                                                           | ❌                                                              | Redux slice + dispatch on stream events                         |

**Kilocode reference (`packages/kilo-vscode/webview-ui/src/components/chat/TaskHeader.tsx:104-243`):**

```tsx
<Show when={hasTodos()}>
  <button onClick={() => setTodosOpen((v) => !v)} aria-expanded={todosOpen()}>
    <Icon name="checklist" size="small" />
    <span data-all-done={allDone() ? "" : undefined}>{todoSummary()}</span>
    <Icon name="chevron-down" data-open={todosOpen() ? "" : undefined} />
  </button>
  <Show when={todosOpen()}>
    <For each={todos()}>
      {(todo) => (
        <Checkbox readOnly checked={todo.status === "completed"}>
          <span data-completed={todo.status === "completed" ? "" : undefined}>
            {todo.content}
          </span>
        </Checkbox>
      )}
    </For>
  </Show>
</Show>
```

### A4. Session Timeline / Activity Visualization

| Feature                                                             | Kilocode                                                                                               | Continue-main | Gap                    |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------- | ---------------------- |
| Per-turn colored bar strip showing tool activity, reasoning, errors | ✅ `TaskTimeline.tsx` with pulse animation on active bar                                               | ❌            | New — stretch, Phase 6 |
| Color tokens per part type                                          | ✅ `--tl-user`, `--tl-read`, `--tl-write`, `--tl-tool`, `--tl-success`, `--tl-error`, `--tl-reasoning` | ❌            | Add to theme           |

### A5. Tool Call Rendering

| Feature                                                     | Kilocode                   | Continue-main                                                  | Gap                             |
| ----------------------------------------------------------- | -------------------------- | -------------------------------------------------------------- | ------------------------------- |
| Collapsed tool card (icon + title + subtitle + badge)       | ✅ `BasicTool`             | ⚠️ `ToolCallDiv` + `SimpleToolCallUI` — functional but simpler | Refresh visual language         |
| Status badges (running / success / error / denied / queued) | ✅ data-state-driven CSS   | ⚠️ only `generating`/`done`/`canceled`                         | Add `error`, `denied`, `queued` |
| Output scroll region with `content-visibility: auto`        | ✅                         | ❌                                                             | Easy perf win on long chats     |
| Sticky per-file accordion header                            | ✅ `StickyAccordionHeader` | ❌                                                             | New                             |
| Copy-output button on tool cards                            | ✅                         | ⚠️ only on code blocks                                         | Add universally                 |
| Sub-agent tool shows child count + "open in tab"            | ✅ `TaskToolExpanded.tsx`  | ❌                                                             | Depends on agent work           |

### A6. Diff Rendering for File Edits

| Feature                                     | Kilocode                                                         | Continue-main                                          | Gap                       |
| ------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------ | ------------------------- |
| Per-file accordion panel with sticky header | ✅ `packages/kilo-vscode/webview-ui/agent-manager/DiffPanel.tsx` | ❌ — diffs inline in `ToolCallDiv` only                | New `MultiFileDiffPanel`  |
| File tree sidebar with change counts        | ✅ `FileTree`                                                    | ❌                                                     | New                       |
| Unified ↔ Split view toggle                 | ✅ `diffStyle: "unified"\|"split"`                               | ⚠️ has `SideBySideDiff` and `InlineDiff` but no toggle | Add toggle + persist      |
| Virtualized rendering for big diffs         | ✅ `VirtualizedFileDiff`                                         | ❌                                                     | `@tanstack/react-virtual` |
| Sticky line-number gutter                   | ✅                                                               | ❌                                                     | CSS-only                  |
| +X −Y change summary badge                  | ✅ `DiffChanges`                                                 | ❌                                                     | Small component           |
| Line-level review comments                  | ✅ draft + submit                                                | ❌                                                     | Stretch                   |
| Revert-single-file button                   | ✅                                                               | ❌                                                     | Wire to IDE messenger     |
| Diff syntax highlighting                    | ✅ worker pool                                                   | ⚠️ `rehype-highlight` on plain code blocks only        | Apply to diffs too        |

**Kilocode reference (`packages/kilo-vscode/webview-ui/agent-manager/DiffPanel.tsx:1-120`):**

```tsx
<DiffPanel
  diffs={workspaceFiles}
  diffStyle="unified"
  onDiffStyleChange={setStyle}
  onRevertFile={handleRevert}
/>

// Internally:
<Accordion value={open()} onChange={setOpen}>
  <For each={sorted()}>
    {(diff) => (
      <Accordion.Item value={diff.file}>
        <StickyAccordionHeader>
          <FileIcon filepath={diff.file} />
          <span>{getFilename(diff.file)}</span>
          <DiffChanges diff={diff} />
        </StickyAccordionHeader>
        <Diff before={diff.before} after={diff.after} />
      </Accordion.Item>
    )}
  </For>
</Accordion>
```

### A7. Chat Message Anatomy

| Feature                            | Kilocode                                       | Continue-main                  | Gap                       |
| ---------------------------------- | ---------------------------------------------- | ------------------------------ | ------------------------- |
| Turn-level copy button             | ✅ `text-part-copy-wrapper[data-is-turn-copy]` | ❌                             | Add hover-reveal copy     |
| Load-older-messages button         | ✅ `.message-list-load-older`                  | ❌                             | New                       |
| Virtualized message list           | ✅ `Virtualizer`                               | ❌ — full scroll               | `@tanstack/react-virtual` |
| Queued-turn indicator              | ✅ `data-queued`                               | ❌                             | Small                     |
| Interrupted / error badge per turn | ✅                                             | ⚠️ only top-level stream error | Per-turn `ErrorDisplay`   |

### A8. Model Selector

| Feature                                                     | Kilocode                | Continue-main            | Gap                                   |
| ----------------------------------------------------------- | ----------------------- | ------------------------ | ------------------------------------- |
| Model preview panel (context size, cost, capability badges) | ✅ `model-preview-grid` | ⚠️ shows model name only | Extend `modelSelection/` with preview |
| Favorites / Recommended / All grouping                      | ✅                      | ❌                       | Add grouping                          |
| Search within dropdown                                      | ✅ `PopupSelector`      | ⚠️                       | Add search                            |

### A9. Streaming Animations

| Feature                          | Kilocode                         | Continue-main         | Gap                  |
| -------------------------------- | -------------------------------- | --------------------- | -------------------- |
| Typewriter reveal                | ✅ `Typewriter`                  | ❌                    | Optional             |
| Text shimmer for "Thinking…"     | ✅                               | ⚠️ `AnimatedEllipsis` | Replace with shimmer |
| Fade-in on new timeline segments | ✅ `@keyframes timeline-fade-in` | N/A                   | Ship with timeline   |
| Pulse on active segment          | ✅ `@keyframes timeline-pulse`   | N/A                   | Ship with timeline   |

### A10. Design Tokens / Theming

| Feature                                                  | Kilocode                        | Continue-main                                 | Gap                   |
| -------------------------------------------------------- | ------------------------------- | --------------------------------------------- | --------------------- |
| Hierarchical text tokens (`--text-weak`/`base`/`strong`) | ✅                              | ⚠️ only `text-foreground`, `text-description` | Extend Tailwind theme |
| Surface hierarchy (`--surface-inset-base`)               | ✅                              | ⚠️                                            | Extend                |
| Diff-specific surface tokens                             | ✅ `--surface-diff-hidden-base` | ❌                                            | Add                   |
| Timeline tokens                                          | ✅                              | ❌                                            | Add                   |

---

## Part B — Implementation Plan (Phased)

### Phase 0 — Foundation (2–3 days)

#### B0.1 Extend Tailwind theme tokens

**New file:** `gui/src/styles/tokens.css`

```css
:root {
  /* Text hierarchy */
  --text-weak: var(--vscode-descriptionForeground, #858585);
  --text-base: var(--vscode-foreground, #cccccc);
  --text-strong: var(--vscode-editor-foreground, #ffffff);
  --text-success: var(--vscode-testing-iconPassed, #5cb85c);

  /* Surfaces */
  --surface-base: var(--vscode-editor-background);
  --surface-inset-base: var(--vscode-sideBar-background);
  --surface-inset-base-hover: var(--vscode-list-hoverBackground);

  /* Borders */
  --border-weak-base: var(--vscode-panel-border, rgba(128, 128, 128, 0.35));
  --border-focus: var(--vscode-focusBorder);

  /* Radii */
  --radius-sm: 3px;
  --radius-md: 6px;
  --radius-lg: 10px;

  /* Timeline */
  --tl-user: var(--vscode-textLink-foreground, #3794ff);
  --tl-read: var(--vscode-charts-blue, #4e9eff);
  --tl-write: var(--vscode-charts-green, #4ec9b0);
  --tl-tool: var(--vscode-charts-purple, #c586c0);
  --tl-success: var(--vscode-testing-iconPassed, #5cb85c);
  --tl-error: var(--vscode-errorForeground, #f48771);
  --tl-reasoning: var(--vscode-descriptionForeground, #858585);

  /* Diff */
  --surface-diff-add: color-mix(in srgb, #4ec9b0 12%, transparent);
  --surface-diff-del: color-mix(in srgb, #f48771 14%, transparent);
  --surface-diff-gutter: color-mix(in srgb, var(--text-base) 6%, transparent);
}

@keyframes shimmer {
  0% {
    background-position: -200% 0;
  }
  100% {
    background-position: 200% 0;
  }
}

@keyframes timeline-fade-in {
  from {
    opacity: 0;
    transform: scaleY(0);
    transform-origin: bottom;
  }
  to {
    opacity: 1;
    transform: scaleY(1);
  }
}

@keyframes timeline-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.4;
  }
}
```

**Edit:** `gui/tailwind.config.js` — expose tokens as Tailwind utilities (`text-weak`, `bg-diff-add`, etc.).

**Edit:** `gui/src/main.tsx` (or equivalent entry) — import `./styles/tokens.css`.

#### B0.2 Extend Redux `securitySlice.sessionStats`

**Edit:** `gui/src/redux/slices/securitySlice.ts`

```ts
interface SessionStats {
  // existing
  totalTokens: number;
  totalCost: number;
  allowed: number;
  blocked: number;
  redacted: number;

  // NEW
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  contextUsed: number; // tokens in live window
  contextLimit: number; // model.limit.context
  outputReserve: number; // model.limit.output
}
```

Extend `addScanResult` (or add new `updateSessionStats` action) to accumulate the new fields.

#### B0.3 `llm-info` surfaces `maxCompletionTokens`

**Audit:** `packages/llm-info/src/models/*.ts`
Add `contextLength` (already present in most) and `maxCompletionTokens` for each model. These drive the "reserved" segment of the bar.

Also record per-model cache pricing where available: `cacheReadCostPer1M`, `cacheWriteCostPer1M`.

---

### Phase 1 — Context Bar + Token Breakdown (3–4 days) ⭐ Priority

#### B1.1 `ContextBar`

**New file:** `gui/src/components/chat/ContextBar.tsx`

```tsx
import { useAppSelector } from "../../redux/hooks";
import { Tooltip } from "../ui/Tooltip";

function fmtK(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

export function ContextBar() {
  const stats = useAppSelector((s) => s.security.sessionStats);
  const { contextUsed, contextLimit, outputReserve } = stats;
  if (!contextLimit) return null;

  const used = Math.min(contextUsed, contextLimit);
  const reserved = Math.min(outputReserve, contextLimit - used);
  const avail = Math.max(0, contextLimit - used - reserved);
  const pctUsed = (used / contextLimit) * 100;
  const pctReserved = (reserved / contextLimit) * 100;
  const pctAvail = (avail / contextLimit) * 100;
  const hot = pctUsed >= 50;

  const tip = [
    `${fmtK(used)} / ${fmtK(contextLimit)} tokens used`,
    outputReserve > 0 ? `${fmtK(outputReserve)} reserved for output` : null,
    avail > 0 ? `${fmtK(avail)} available` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return (
    <div className="text-weak flex items-center gap-1.5 font-mono text-[11px] tabular-nums">
      <span className="shrink-0">{fmtK(used)}</span>
      <Tooltip content={tip}>
        <div className="relative flex h-1 flex-1 overflow-hidden rounded-sm bg-[color-mix(in_srgb,var(--text-base)_20%,transparent)]">
          <div
            className={`h-full transition-[width,background] duration-300 ease-out ${
              hot
                ? "bg-[color-mix(in_srgb,var(--vscode-errorForeground)_60%,rgba(128,0,0,1))]"
                : "bg-[var(--text-base)]"
            }`}
            style={{ width: `${pctUsed}%` }}
          />
          <div
            className="h-full bg-[color-mix(in_srgb,var(--text-base)_30%,transparent)] transition-[width] duration-300"
            style={{ width: `${pctReserved}%` }}
          />
          {pctAvail > 0 && (
            <div className="h-full" style={{ width: `${pctAvail}%` }} />
          )}
        </div>
      </Tooltip>
      <span className="shrink-0">{fmtK(contextLimit)}</span>
    </div>
  );
}
```

#### B1.2 `TokenBreakdown`

**New file:** `gui/src/components/chat/TokenBreakdown.tsx`

```tsx
import {
  ArrowUpIcon,
  ArrowDownIcon,
  CpuChipIcon,
} from "@heroicons/react/24/outline";
import { useAppSelector } from "../../redux/hooks";

export function TokenBreakdown() {
  const s = useAppSelector((s) => s.security.sessionStats);
  const {
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    reasoningTokens,
  } = s;
  const fmt = (n: number) =>
    n >= 1000 ? `${(n / 1000).toFixed(1)}K` : n.toLocaleString();

  return (
    <div className="text-weak flex items-center gap-2 px-2 text-[11px]">
      <span className="font-semibold">Tokens</span>
      {inputTokens > 0 && (
        <span className="flex items-center gap-0.5">
          <ArrowUpIcon className="h-3 w-3" />
          {fmt(inputTokens)}
        </span>
      )}
      {outputTokens > 0 && (
        <span className="flex items-center gap-0.5">
          <ArrowDownIcon className="h-3 w-3" />
          {fmt(outputTokens)}
        </span>
      )}
      {cacheWriteTokens > 0 && (
        <span className="flex items-center gap-0.5" title="Cache write">
          <ArrowUpIcon className="h-3 w-3" />
          cache {fmt(cacheWriteTokens)}
        </span>
      )}
      {cacheReadTokens > 0 && (
        <span
          className="text-success flex items-center gap-0.5"
          title="Cache read — saved input cost"
        >
          <ArrowDownIcon className="h-3 w-3" />
          cache {fmt(cacheReadTokens)}
        </span>
      )}
      {reasoningTokens > 0 && (
        <span className="flex items-center gap-0.5" title="Reasoning">
          <CpuChipIcon className="h-3 w-3" />
          {fmt(reasoningTokens)}
        </span>
      )}
    </div>
  );
}
```

#### B1.3 `TaskHeader`

**New file:** `gui/src/components/chat/TaskHeader.tsx`

Sticky header at the top of the chat scroll region. Collapsed by default — click to expand.

```tsx
import { useState } from "react";
import { ChevronDownIcon } from "@heroicons/react/24/outline";
import { useAppSelector } from "../../redux/hooks";
import { ContextBar } from "./ContextBar";
import { TokenBreakdown } from "./TokenBreakdown";
import { TodoStrip } from "./TodoStrip"; // from Phase 2

export function TaskHeader() {
  const [expanded, setExpanded] = useState(false);
  const stats = useAppSelector((s) => s.security.sessionStats);
  const title = useAppSelector((s) => s.session.title) ?? "New conversation";

  return (
    <div className="border-weak-base bg-surface-inset sticky top-0 z-10 border-b backdrop-blur">
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-weak flex w-full items-center gap-2 px-4 py-1.5 text-[12px] hover:text-base"
      >
        <span className="flex-1 truncate text-left">{title}</span>
        <span className="tabular-nums">${stats.totalCost.toFixed(2)}</span>
        <ContextBar />
        <ChevronDownIcon
          className={`h-3.5 w-3.5 transition ${expanded ? "rotate-180" : ""}`}
        />
      </button>

      {expanded && (
        <div className="px-4 pb-2">
          <TokenBreakdown />
          {/* Future: <TaskTimeline /> */}
        </div>
      )}

      <TodoStrip />
    </div>
  );
}
```

#### B1.4 Wire `TaskHeader` into Chat page

**Edit:** `gui/src/pages/gui/Chat.tsx`

Mount `<TaskHeader />` as the first child of the message list container. Keep `FirewallConsentCard` and existing components intact.

#### B1.5 Proxy emits cache/reasoning headers

**Edit:** `proxy/src/routes/ai.route.ts`

```ts
reply.header("X-AF-Cache-Read-Tokens", usage.cache_read_input_tokens ?? 0);
reply.header("X-AF-Cache-Write-Tokens", usage.cache_creation_input_tokens ?? 0);
reply.header("X-AF-Reasoning-Tokens", usage.reasoning_tokens ?? 0);
reply.header("X-AF-Context-Used", contextUsedTokens);
reply.header("X-AF-Context-Limit", modelContextLimit);
reply.header("X-AF-Output-Reserve", modelOutputLimit);
```

#### B1.6 Redux thunk parses new headers

**Edit:** `gui/src/redux/thunks/streamResponse.ts`

After each successful scan response, read `X-AF-*` headers and dispatch `updateSessionStats({ inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, reasoningTokens, contextUsed, contextLimit, outputReserve })`.

#### B1.7 CLI parity

**Edit:** `extensions/cli/src/util/sessionMetrics.ts`

```ts
export function formatTokenUsage(
  usage: TokenUsage,
  cost?: CostBreakdown,
): string {
  const parts: string[] = [];
  if (usage.promptTokens) parts.push(`in: ${formatTokens(usage.promptTokens)}`);
  if (usage.completionTokens)
    parts.push(`out: ${formatTokens(usage.completionTokens)}`);
  if (usage.cacheReadTokens)
    parts.push(chalk.green(`cache↓ ${formatTokens(usage.cacheReadTokens)}`));
  if (usage.cacheWriteTokens)
    parts.push(chalk.cyan(`cache↑ ${formatTokens(usage.cacheWriteTokens)}`));
  if (usage.reasoningTokens)
    parts.push(chalk.magenta(`think ${formatTokens(usage.reasoningTokens)}`));
  const line = chalk.dim(parts.join(" · "));
  return cost?.cost ? `${line} · ${formatCost(cost.cost)}` : line;
}
```

**Edit:** `extensions/cli/src/ui/components/BottomStatusBar.tsx` — always render the context bar (remove the `if (totalCost)` gate).

---

### Phase 2 — Reasoning Block + Todos (3–4 days) ⭐ Priority

#### B2.1 Extend chat message schema

**Edit:** `core/index.d.ts`

```ts
export interface TodoItem {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
}

export interface ReasoningPart {
  text: string;
  tokens?: number;
  durationMs?: number;
}

// on ChatHistoryItem:
interface ChatHistoryItem {
  // existing fields...
  reasoning?: ReasoningPart;
  todos?: TodoItem[];
}
```

#### B2.2 New tools — `todoWrite` + `todoRead`

**New files:**

- `core/tools/implementations/todoWrite.ts`
- `core/tools/implementations/todoRead.ts`
- `core/tools/definitions/todoWrite.ts`

Agent writes/reads a todo list; store is per-session and mirrored into Redux via stream events. Mirrors kilocode's tool pair.

#### B2.3 Redux `todosSlice`

**New file:** `gui/src/redux/slices/todosSlice.ts`

```ts
import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import type { TodoItem } from "core";

const todosSlice = createSlice({
  name: "todos",
  initialState: [] as TodoItem[],
  reducers: {
    setTodos: (_, a: PayloadAction<TodoItem[]>) => a.payload,
    updateTodoStatus: (
      s,
      a: PayloadAction<{ id: string; status: TodoItem["status"] }>,
    ) => {
      const t = s.find((x) => x.id === a.payload.id);
      if (t) t.status = a.payload.status;
    },
    clearTodos: () => [],
  },
});

export const { setTodos, updateTodoStatus, clearTodos } = todosSlice.actions;
export default todosSlice.reducer;
```

Register in `gui/src/redux/store.ts`.

#### B2.4 `TodoStrip`

**New file:** `gui/src/components/chat/TodoStrip.tsx`

```tsx
import { useState } from "react";
import {
  ClipboardDocumentCheckIcon,
  ChevronDownIcon,
} from "@heroicons/react/24/outline";
import { useAppSelector } from "../../redux/hooks";
import { LoadingSpinner } from "../ui/LoadingSpinner";

export function TodoStrip() {
  const todos = useAppSelector((s) => s.todos);
  const [open, setOpen] = useState(false);
  if (todos.length === 0) return null;

  const done = todos.filter((t) => t.status === "completed").length;
  const allDone = done === todos.length;
  const summary = allDone
    ? `All done (${todos.length})`
    : `${done}/${todos.length} completed`;

  return (
    <div className="border-weak-base border-t">
      <button
        className="text-weak flex w-full items-center gap-1.5 px-4 py-1.5 text-[12px] hover:text-base"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <ClipboardDocumentCheckIcon className="h-3.5 w-3.5" />
        <span className={`flex-1 text-left ${allDone ? "text-success" : ""}`}>
          {summary}
        </span>
        <ChevronDownIcon
          className={`h-3 w-3 transition ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="flex flex-col gap-0.5 px-4 pb-2">
          {todos.map((t) => (
            <label key={t.id} className="flex items-center gap-2 text-[12px]">
              <input
                type="checkbox"
                readOnly
                checked={t.status === "completed"}
                className="h-3 w-3"
              />
              <span
                className={
                  t.status === "completed"
                    ? "text-weak line-through"
                    : "text-base"
                }
              >
                {t.content}
              </span>
              {t.status === "in_progress" && (
                <LoadingSpinner className="h-3 w-3" />
              )}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}
```

#### B2.5 `ReasoningBlock`

**New file:** `gui/src/components/chat/ReasoningBlock.tsx`

```tsx
import { useState } from "react";
import { SparklesIcon, ChevronDownIcon } from "@heroicons/react/24/outline";
import { TextShimmer } from "../ui/TextShimmer";

export function ReasoningBlock({
  text,
  tokens,
  durationMs,
  streaming,
}: {
  text: string;
  tokens?: number;
  durationMs?: number;
  streaming?: boolean;
}) {
  const [open, setOpen] = useState(streaming ?? false);

  return (
    <div className="border-weak-base bg-surface-inset/60 mb-2 rounded-md border">
      <button
        className="text-weak flex w-full items-center gap-2 px-3 py-1.5 text-[11px] hover:text-base"
        onClick={() => setOpen(!open)}
      >
        <SparklesIcon className="h-3.5 w-3.5" />
        <span className="flex-1 text-left">
          {streaming ? <TextShimmer>Thinking…</TextShimmer> : "Thought process"}
        </span>
        {tokens != null && (
          <span className="tabular-nums">{tokens.toLocaleString()} tok</span>
        )}
        {durationMs != null && (
          <span className="tabular-nums">
            · {(durationMs / 1000).toFixed(1)}s
          </span>
        )}
        <ChevronDownIcon
          className={`h-3 w-3 transition ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="border-weak-base text-weak whitespace-pre-wrap border-t px-3 py-2 text-[12px] leading-5">
          {text}
        </div>
      )}
    </div>
  );
}
```

#### B2.6 `TextShimmer`

**New file:** `gui/src/components/ui/TextShimmer.tsx`

```tsx
export function TextShimmer({ children }: { children: React.ReactNode }) {
  return (
    <span className="relative inline-block">
      <span className="text-weak">{children}</span>
      <span
        className="absolute inset-0 bg-gradient-to-r from-transparent via-[var(--text-base)] to-transparent bg-[length:200%_100%] bg-clip-text text-transparent"
        style={{ animation: "shimmer 2s linear infinite" }}
        aria-hidden
      >
        {children}
      </span>
    </span>
  );
}
```

`@keyframes shimmer` already lives in `tokens.css` (Phase 0).

#### B2.7 Wire `ReasoningBlock` into `StepContainer`

**Edit:** `gui/src/components/StepContainer/StepContainer.tsx`

Before the existing `<StyledMarkdownPreview>`, render `<ReasoningBlock>` if `props.item.reasoning` exists:

```tsx
{
  isAssistant && props.item.reasoning && (
    <ReasoningBlock
      text={props.item.reasoning.text}
      tokens={props.item.reasoning.tokens}
      durationMs={props.item.reasoning.durationMs}
      streaming={props.isLast && isStreaming}
    />
  );
}
```

#### B2.8 CLI reasoning panel

**Edit:** `extensions/cli/src/ui/MarkdownRenderer.tsx`

Already handles `<think>`. Enhance with a collapsed-by-default banner:

```
◦ Thinking [42 tok · 3.1s] — press 't' to expand
```

Bind `t` key in `extensions/cli/src/ui/TUIChat.tsx` to toggle visibility.

---

### Phase 3 — Multi-File Diff Panel (4–5 days) ⭐ Priority

#### B3.1 `MultiFileDiffPanel`

**New file:** `gui/src/components/diff/MultiFileDiffPanel.tsx`

```tsx
import { useState } from "react";
import { FileTree } from "./FileTree";
import { FileAccordion } from "./FileAccordion";

export interface FileDiff {
  path: string;
  before: string;
  after: string;
  additions: number;
  deletions: number;
}

export function MultiFileDiffPanel({ diffs }: { diffs: FileDiff[] }) {
  const [style, setStyle] = useState<"unified" | "split">(
    () =>
      (localStorage.getItem("diffStyle") as "unified" | "split") || "unified",
  );
  const [openFiles, setOpenFiles] = useState<Set<string>>(
    new Set(diffs.map((d) => d.path)),
  );

  const toggle = (p: string) =>
    setOpenFiles((s) => {
      const n = new Set(s);
      n.has(p) ? n.delete(p) : n.add(p);
      return n;
    });

  const setStyleAndSave = (s: "unified" | "split") => {
    setStyle(s);
    localStorage.setItem("diffStyle", s);
  };

  const totalAdds = diffs.reduce((s, d) => s + d.additions, 0);
  const totalDels = diffs.reduce((s, d) => s + d.deletions, 0);

  return (
    <div className="border-weak-base bg-surface-base flex h-full flex-col rounded-md border">
      <div className="border-weak-base flex items-center gap-2 border-b px-3 py-2 text-[12px]">
        <span className="font-semibold">
          {diffs.length} file{diffs.length !== 1 ? "s" : ""} changed
        </span>
        <span className="text-success tabular-nums">+{totalAdds}</span>
        <span className="text-error tabular-nums">−{totalDels}</span>
        <div className="ml-auto flex gap-1">
          <button
            className={`rounded px-2 py-0.5 text-[11px] ${
              style === "unified" ? "bg-input text-base" : "text-weak"
            }`}
            onClick={() => setStyleAndSave("unified")}
          >
            Unified
          </button>
          <button
            className={`rounded px-2 py-0.5 text-[11px] ${
              style === "split" ? "bg-input text-base" : "text-weak"
            }`}
            onClick={() => setStyleAndSave("split")}
          >
            Split
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <FileTree diffs={diffs} openFiles={openFiles} onToggle={toggle} />
        <div className="flex-1 overflow-y-auto">
          {diffs.map((d) => (
            <FileAccordion
              key={d.path}
              diff={d}
              open={openFiles.has(d.path)}
              onToggle={() => toggle(d.path)}
              style={style}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
```

#### B3.2 `FileAccordion`

**New file:** `gui/src/components/diff/FileAccordion.tsx`

```tsx
import {
  ChevronDownIcon,
  ArrowUturnLeftIcon,
} from "@heroicons/react/24/outline";
import { FileIcon } from "../ui/FileIcon";
import { DiffChanges } from "./DiffChanges";
import { UnifiedDiff } from "./UnifiedDiff";
import { SideBySideDiff } from "./SideBySideDiff";
import type { FileDiff } from "./MultiFileDiffPanel";

export function FileAccordion({
  diff,
  open,
  onToggle,
  style,
}: {
  diff: FileDiff;
  open: boolean;
  onToggle: () => void;
  style: "unified" | "split";
}) {
  return (
    <div className="border-weak-base border-b last:border-0">
      <div className="border-weak-base bg-surface-inset sticky top-0 z-[1] flex items-center gap-2 border-b px-3 py-1.5 text-[12px]">
        <button
          onClick={onToggle}
          className="flex flex-1 items-center gap-2 text-left"
        >
          <ChevronDownIcon
            className={`h-3 w-3 transition ${open ? "" : "-rotate-90"}`}
          />
          <FileIcon filepath={diff.path} className="h-3.5 w-3.5" />
          <span className="font-mono">{getFilename(diff.path)}</span>
          <span className="text-weak">{getDirectory(diff.path)}</span>
        </button>
        <DiffChanges additions={diff.additions} deletions={diff.deletions} />
        <button className="text-weak hover:text-error" title="Revert file">
          <ArrowUturnLeftIcon className="h-3.5 w-3.5" />
        </button>
      </div>
      {open &&
        (style === "split" ? (
          <SideBySideDiff oldContent={diff.before} newContent={diff.after} />
        ) : (
          <UnifiedDiff before={diff.before} after={diff.after} />
        ))}
    </div>
  );
}

function getFilename(p: string) {
  return p.split("/").pop() || p;
}
function getDirectory(p: string) {
  const parts = p.split("/");
  parts.pop();
  return parts.join("/");
}
```

#### B3.3 `DiffChanges`

**New file:** `gui/src/components/diff/DiffChanges.tsx`

```tsx
export function DiffChanges({
  additions,
  deletions,
}: {
  additions: number;
  deletions: number;
}) {
  return (
    <span className="flex items-center gap-1 font-mono text-[11px]">
      <span className="text-success tabular-nums">+{additions}</span>
      <span className="text-error tabular-nums">−{deletions}</span>
    </span>
  );
}
```

#### B3.4 `UnifiedDiff` (replace/extend `InlineDiff`)

**New file:** `gui/src/components/diff/UnifiedDiff.tsx`

Key CSS pattern from kilocode:

```css
.unified-diff {
  content-visibility: auto;
}
.diff-line-number {
  position: sticky;
  left: 0;
  z-index: 2;
  background: var(--surface-diff-gutter);
  padding: 0 6px;
}
.diff-line-add {
  background: var(--surface-diff-add);
}
.diff-line-del {
  background: var(--surface-diff-del);
}
```

Apply `rehype-highlight` per-line (cached by content hash) so added/removed code retains syntax colors.

#### B3.5 `FileTree` sidebar

**New file:** `gui/src/components/diff/FileTree.tsx`

Folder-grouped tree on the left; clicking a file scrolls the accordion into view. Use a simple recursive reducer grouping paths by `/`.

#### B3.6 Virtualize for large diffs

Pull in `@tanstack/react-virtual`. Only render on-screen hunks. Alternative: `react-diff-viewer-continued` with custom renderer (if we want to skip virtualization in v1, defer to Phase 5).

#### B3.7 Wire into tool-call flow

**Edit:** `gui/src/pages/gui/ToolCallDiv/EditFile.tsx`
**Edit:** `gui/src/pages/gui/ToolCallDiv/FindAndReplace.tsx`

When a tool emits a file edit, render `<MultiFileDiffPanel>` with a single entry. When an agent batch-edits multiple files, render all in one panel.

---

### Phase 4 — Tool Card Polish (2 days)

#### B4.1 Refresh `SimpleToolCallUI`

**Edit:** `gui/src/pages/gui/ToolCallDiv/SimpleToolCallUI.tsx`

Adopt kilocode's card shape:

- 36px header height (`h-9`)
- Hover: `bg-list-hover`
- `data-state` attribute driving styles
- Rotate chevron on expand
- Apply `content-visibility: auto` to output region
- Copy button always rendered on output

#### B4.2 Expand status vocabulary

**Edit:** `gui/src/pages/gui/ToolCallDiv/index.tsx::getStatusIcon`

Add states: `queued`, `denied`, `error`, each with icon + color.

#### B4.3 Scrollable output with max-height

```css
.tool-output {
  max-height: 360px;
  overflow-y: auto;
  overscroll-behavior: contain;
}
```

Show "Show N more lines" button under truncated output.

---

### Phase 5 — Chat List UX (2–3 days)

#### B5.1 Virtualized message list

Wrap the history `.map` in `useVirtualizer` from `@tanstack/react-virtual`. Massive perf win on 100+ message sessions.

#### B5.2 Load-older-messages button

**Edit:** `gui/src/pages/gui/Chat.tsx`

When history length > 40, collapse older turns behind a "Load older messages" button. Mirror kilocode's `.message-list-load-older`.

#### B5.3 Turn-level copy button

Hover reveal on each `StepContainer`. Copies the markdown output (and optionally the tool outputs).

#### B5.4 Per-turn error / interrupted badge

Replace top-level `StreamError` with per-turn chips so users see exactly which turn failed.

---

### Phase 6 — Session Timeline (Stretch, 3 days)

#### B6.1 `TaskTimeline` component

**New file:** `gui/src/components/chat/TaskTimeline.tsx`

A thin strip above the message list inside the expanded `TaskHeader`, one bar per turn-part colored by kind (user, tool, reasoning, success, error). Pulse animation on the last/active bar.

```tsx
export function TaskTimeline() {
  const parts = useAppSelector(timelineSelector);
  return (
    <div className="flex h-2 items-end gap-0.5 px-4 py-1">
      {parts.map((p, i) => (
        <div
          key={i}
          className={`flex-1 rounded-sm ${
            i === parts.length - 1
              ? "animate-timeline-pulse"
              : "animate-timeline-fade-in"
          }`}
          style={{
            height: `${Math.min(p.tokens / 100, 8)}px`,
            background: `var(--tl-${p.kind})`,
          }}
          title={`${p.kind}: ${p.tokens} tokens`}
        />
      ))}
    </div>
  );
}
```

Tailwind config needs `animate-timeline-pulse` and `animate-timeline-fade-in` entries pointing at the keyframes from `tokens.css`.

---

### Phase 7 — Model Selector Preview (2 days)

#### B7.1 `ModelPreviewCard`

**New file:** `gui/src/components/modelSelection/ModelPreviewCard.tsx`

Shows cost per 1M in/out, context window, output cap, capability badges (vision, tools, reasoning, cache).

```tsx
<div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-[11px]">
  <span className="text-weak">Context</span>
  <span className="tabular-nums">{fmtK(model.contextLength)}</span>
  <span className="text-weak">Output cap</span>
  <span className="tabular-nums">{fmtK(model.maxCompletionTokens)}</span>
  <span className="text-weak">Input</span>
  <span className="tabular-nums">${model.inputCostPer1M}/M</span>
  <span className="text-weak">Output</span>
  <span className="tabular-nums">${model.outputCostPer1M}/M</span>
  <span className="text-weak">Cache read</span>
  <span className="tabular-nums">${model.cacheReadCostPer1M}/M</span>
</div>
<div className="mt-1 flex flex-wrap gap-1">
  {model.supportsVision     && <Badge>vision</Badge>}
  {model.supportsTools      && <Badge>tools</Badge>}
  {model.supportsReasoning  && <Badge>reasoning</Badge>}
  {model.supportsCacheControl && <Badge>cache</Badge>}
</div>
```

---

## Part C — Data Flow Changes

### C1. Proxy response headers

**Edit:** `proxy/src/routes/ai.route.ts`

All token usage fields are surfaced in response headers. Provider-specific extraction:

- **Anthropic** — `usage.cache_read_input_tokens`, `usage.cache_creation_input_tokens` (already present in stream).
- **OpenAI** — `usage.prompt_tokens_details.cached_tokens` for cache-read.
- **Gemini** — no cache pricing but track reasoning tokens if thinking is enabled.

```ts
reply.header("X-AF-Cache-Read-Tokens", usage.cache_read_input_tokens ?? 0);
reply.header("X-AF-Cache-Write-Tokens", usage.cache_creation_input_tokens ?? 0);
reply.header("X-AF-Reasoning-Tokens", usage.reasoning_tokens ?? 0);
reply.header("X-AF-Context-Used", contextUsedTokens);
reply.header("X-AF-Context-Limit", modelContextLimit);
reply.header("X-AF-Output-Reserve", modelOutputLimit);
```

### C2. Core stream handler

**Edit:** `core/llm/index.ts` + `core/llm/llms/Anthropic.ts` + `core/llm/llms/OpenAI.ts`

Extend `CompletionOptions.usage` to carry:

```ts
usage: {
  promptTokens: number;
  completionTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
}
```

### C3. Redux update fan-out

**Edit:** `gui/src/redux/thunks/streamResponse.ts`

After each stream chunk with usage, dispatch a single `updateSessionStats` with all new fields.

### C4. CLI parity

**Edit:** `extensions/cli/src/stream/streamChatResponse.ts`

Extend the `onTokenUsage` callback signature to include `cacheReadTokens`, `cacheWriteTokens`, `reasoningTokens`, `contextUsed`, `contextLimit`, `outputReserve`.

---

## Part D — File-Level Touch List

### New files

**GUI components**

- `gui/src/styles/tokens.css`
- `gui/src/components/chat/ContextBar.tsx`
- `gui/src/components/chat/TokenBreakdown.tsx`
- `gui/src/components/chat/TaskHeader.tsx`
- `gui/src/components/chat/TodoStrip.tsx`
- `gui/src/components/chat/ReasoningBlock.tsx`
- `gui/src/components/chat/TaskTimeline.tsx` _(Phase 6)_
- `gui/src/components/ui/TextShimmer.tsx`
- `gui/src/components/diff/MultiFileDiffPanel.tsx`
- `gui/src/components/diff/FileAccordion.tsx`
- `gui/src/components/diff/FileTree.tsx`
- `gui/src/components/diff/UnifiedDiff.tsx`
- `gui/src/components/diff/DiffChanges.tsx`
- `gui/src/components/modelSelection/ModelPreviewCard.tsx`

**Redux**

- `gui/src/redux/slices/todosSlice.ts`

**Core tools**

- `core/tools/implementations/todoWrite.ts`
- `core/tools/implementations/todoRead.ts`
- `core/tools/definitions/todoWrite.ts`

### Modified files

**GUI**

- `gui/tailwind.config.js` — theme tokens, animation classes
- `gui/src/redux/slices/securitySlice.ts` — extend `SessionStats`
- `gui/src/redux/store.ts` — register `todosSlice`
- `gui/src/redux/thunks/streamResponse.ts` — parse new headers
- `gui/src/pages/gui/Chat.tsx` — mount `TaskHeader`
- `gui/src/components/StepContainer/StepContainer.tsx` — render `ReasoningBlock`
- `gui/src/pages/gui/ToolCallDiv/EditFile.tsx` — use `MultiFileDiffPanel`
- `gui/src/pages/gui/ToolCallDiv/FindAndReplace.tsx` — use `MultiFileDiffPanel`
- `gui/src/pages/gui/ToolCallDiv/SimpleToolCallUI.tsx` — refresh styling
- `gui/src/pages/gui/ToolCallDiv/index.tsx` — new status states

**Proxy**

- `proxy/src/routes/ai.route.ts` — emit new headers

**Core**

- `core/index.d.ts` — `reasoning`, `todos` on message type
- `core/llm/index.ts` — extend `usage` type
- `core/llm/llms/Anthropic.ts` — surface cache + reasoning usage
- `core/llm/llms/OpenAI.ts` — surface cached-tokens

**CLI**

- `extensions/cli/src/util/sessionMetrics.ts` — cache/reasoning columns
- `extensions/cli/src/ui/components/BottomStatusBar.tsx` — always-on context bar
- `extensions/cli/src/stream/streamChatResponse.ts` — extend token callback
- `extensions/cli/src/ui/MarkdownRenderer.tsx` — reasoning banner
- `extensions/cli/src/ui/TUIChat.tsx` — `t` key for reasoning toggle

**Packages**

- `packages/llm-info/src/models/*.ts` — `maxCompletionTokens`, cache pricing

---

## Part E — Sequenced Milestones & Timeline

| Phase    | Scope                                                                       | Effort   | Visible outcome                             |
| -------- | --------------------------------------------------------------------------- | -------- | ------------------------------------------- |
| **0**    | Theme tokens + `SessionStats` extension                                     | 2–3 days | Infra in place, no visible change           |
| **1** ⭐ | `ContextBar` + `TokenBreakdown` + `TaskHeader` + proxy headers + CLI parity | 3–4 days | 3-segment bar + cache tokens at top of chat |
| **2** ⭐ | `ReasoningBlock` + `TodoStrip` + todo tools                                 | 3–4 days | Thinking panel per message, live todo list  |
| **3** ⭐ | `MultiFileDiffPanel` with sticky headers, split/unified toggle, revert      | 4–5 days | GitHub-style diff UX replacing inline diff  |
| **4**    | Tool card polish (statuses, scroll, copy)                                   | 2 days   | Cleaner tool output                         |
| **5**    | Virtualized message list + load-older + per-turn copy/error                 | 2–3 days | Long sessions don't lag                     |
| **6**    | `TaskTimeline` (stretch)                                                    | 3 days   | Activity timeline in expanded header        |
| **7**    | Model selector preview panel                                                | 2 days   | Cost-aware model picking                    |

**Total:** ~21–26 dev days for full parity on the best-of-kilocode UX.
**Headline slice (Phases 0–3):** ~12–16 dev days for the "token bar + reasoning + todos + diff" deliverable.

### Recommended first PR

**Phase 0 + Phase 1** bundled as a single PR:

- Purely additive (no removals, no risky refactors)
- Delivers immediate visible value (3-segment bar with hot threshold + cache tokens)
- Sets up the token/theme plumbing every later phase depends on
- Easy to test — stream any chat, verify headers populate, verify bar reacts to model change

---

## Part F — Risks & Mitigations

| Risk                                                                 | Likelihood | Impact | Mitigation                                                                                       |
| -------------------------------------------------------------------- | ---------- | ------ | ------------------------------------------------------------------------------------------------ |
| Provider SDKs don't expose cache tokens consistently                 | Medium     | Medium | Default to 0 when missing; feature-detect per provider in `core/llm/llms/*.ts`                   |
| Proxy `X-AF-*` header bloat for streaming (hundreds of chunks)       | Low        | Low    | Emit on stream close, not per chunk                                                              |
| Virtualizing message list breaks scroll-to-bottom-on-stream behavior | Medium     | Medium | Manual scroll management — pin to bottom if user is already there; otherwise preserve position   |
| Tailwind theme tokens collide with existing class names              | Low        | Low    | Prefix all new tokens/utilities with `af-` if collisions arise                                   |
| Todo tool schema drift vs upstream MCP/agent spec                    | Low        | Low    | Mirror kilocode's `TodoItem` shape exactly; document in `core/index.d.ts`                        |
| Large diff panels hang the render thread                             | Medium     | High   | Phase 3 includes `content-visibility: auto`; Phase 5 adds full virtualization                    |
| VSCode webview theme variance across themes (high-contrast, custom)  | Medium     | Low    | Test against 4 reference themes: Default Dark+, Default Light+, GitHub Dark, Monokai             |
| Firewall scanning latency makes real-time context bar feel laggy     | Medium     | Medium | Stream header parser updates Redux on header-receive, not on stream-complete — bar animates live |

---

## Part G — Success Metrics

**Delivery criteria for Phases 0–3 (the core ask):**

1. **Context bar renders for every model** that has a context-window set in `llm-info`. If a model has no `maxCompletionTokens`, the reserved segment is hidden but bar still functions.
2. **Cache tokens visible** for Anthropic + OpenAI + Gemini (when streams surface them). Cache-read tokens appear in green.
3. **Reasoning block renders** for any Claude Sonnet/Opus model with extended thinking enabled, plus DeepSeek/o1 models that return `<think>` blocks.
4. **Todo strip lives** on the sticky header whenever the agent has called `todoWrite`. Checkbox state reflects the latest agent update.
5. **Multi-file diff panel** replaces current inline diff for all tool calls producing > 1 file edit. Single-file edits optionally use the new panel with tree hidden.
6. **Unified/Split toggle** persists across sessions (localStorage).
7. **CLI parity** — `formatTokenUsage` emits cache/reasoning columns; status bar shows context bar always.

**Quality bars:**

- No regression in existing firewall consent flow, preflight banner, or scan results
- VSCode webview bundle size increase < 60 KB gzip
- No new console warnings in GUI dev mode
- All new components pass existing `tsc:watch` + `eslint` checks
- 80% unit-test coverage on new Redux reducers and token-format utilities

---

## Appendix — Reference File Map

### Kilocode — pattern sources

| Pattern                               | File                                                                               |
| ------------------------------------- | ---------------------------------------------------------------------------------- |
| Context progress bar                  | `kilocode/packages/kilo-vscode/webview-ui/src/components/chat/ContextProgress.tsx` |
| Task header (tokens, todos, timeline) | `kilocode/packages/kilo-vscode/webview-ui/src/components/chat/TaskHeader.tsx`      |
| Task timeline                         | `kilocode/packages/kilo-vscode/webview-ui/src/components/chat/TaskTimeline.tsx`    |
| Task-header CSS                       | `kilocode/packages/kilo-vscode/webview-ui/src/styles/task-header.css`              |
| Chat layout CSS                       | `kilocode/packages/kilo-vscode/webview-ui/src/styles/chat-layout.css`              |
| Diff panel (multi-file)               | `kilocode/packages/kilo-vscode/webview-ui/agent-manager/DiffPanel.tsx`             |
| Low-level diff component              | `kilocode/packages/kilo-ui/src/components/diff.tsx`                                |
| Diff CSS                              | `kilocode/packages/kilo-ui/src/components/diff.css`                                |
| BasicTool card                        | `kilocode/packages/kilo-ui/src/components/basic-tool.tsx`                          |
| BasicTool CSS                         | `kilocode/packages/kilo-ui/src/components/basic-tool.css`                          |
| Message list                          | `kilocode/packages/kilo-vscode/webview-ui/src/components/chat/MessageList.tsx`     |
| Model selector                        | `kilocode/packages/kilo-vscode/webview-ui/src/components/shared/ModelSelector.tsx` |
| Timeline color tokens                 | `kilocode/packages/kilo-vscode/webview-ui/src/utils/timeline/colors.ts`            |

### Continue-main — target locations

| Target                                           | File                                                                |
| ------------------------------------------------ | ------------------------------------------------------------------- |
| Main chat page                                   | `gui/src/pages/gui/Chat.tsx`                                        |
| Assistant message container (modified on branch) | `gui/src/components/StepContainer/StepContainer.tsx`                |
| Markdown renderer                                | `gui/src/components/StyledMarkdownPreview/index.tsx`                |
| Tool call rendering                              | `gui/src/pages/gui/ToolCallDiv/`                                    |
| Existing diff components                         | `gui/src/components/diff/SideBySideDiff.tsx`, `InlineDiff.tsx`      |
| Existing plan panel                              | `gui/src/pages/gui/PlanPanel.tsx`                                   |
| Thinking peek (to replace/extend)                | `gui/src/components/mainInput/belowMainInput/ThinkingBlockPeek.tsx` |
| Cost badges                                      | `gui/src/components/security/CostBadge.tsx`                         |
| Firewall consent card                            | `gui/src/components/security/FirewallConsentCard.tsx`               |
| Security Redux slice                             | `gui/src/redux/slices/securitySlice.ts`                             |
| Session Redux slice                              | `gui/src/redux/slices/sessionSlice.ts`                              |
| Proxy AI route                                   | `proxy/src/routes/ai.route.ts`                                      |
| Proxy token counter                              | `proxy/src/gateway/tokenCounter.ts`                                 |
| Core types                                       | `core/index.d.ts`                                                   |
| Core LLM base                                    | `core/llm/index.ts`                                                 |
| CLI TUI root                                     | `extensions/cli/src/ui/TUIChat.tsx`                                 |
| CLI session metrics                              | `extensions/cli/src/util/sessionMetrics.ts`                         |
| CLI status bar                                   | `extensions/cli/src/ui/components/BottomStatusBar.tsx`              |
| CLI stream handler                               | `extensions/cli/src/stream/streamChatResponse.ts`                   |
| Model metadata                                   | `packages/llm-info/src/models/`                                     |

---

**Document owner:** Siddartha (siddartha.yekollu@recykal.com)
**Next action:** Approve scope → begin Phase 0 + Phase 1 PR.
