# Security Hardening Plan — AI Firewall

**Status:** Draft, awaiting approval
**Date:** 2026-04-15
**Source:** Consolidated audit across key storage, scan-chokepoint coverage, BLOCK/REDACT enforcement, and token efficiency
**Related:** `CLAUDE.md` (architecture), `.claude/rules/audit-checklist.md`, `AUTH_AND_ONBOARDING_PLAN.md`

---

## 0. Executive Summary

**Ground rule:** AI Firewall is a separate, fresh product — **no backward compatibility with Continue.dev users is required.** Every decision in this plan should choose the simplest secure option, not the one that preserves Continue's existing flows.

The product has three distinct security gaps plus one large cleanup surface, in descending order of blast radius:

1. **The vault is decorative, not authoritative.** The 60+ LLM providers inherited from Continue read API keys from plain-text `config.yaml` files written by the onboarding wizard. The proxy's AES-256-GCM vault only holds keys submitted through `POST /api/providers` — a route the default onboarding flow never touches. Users who add BYOK keys via the GUI wizard get zero encryption at rest. **Fix: vault becomes the only key store. No `env://`, no `apiKey:`, no migration path — a `config.yaml` with a plain-text `apiKey:` field should refuse to load.**

2. **Named-format API keys slip through the scanner.** `packages/scanner/src/patterns.ts` has no explicit regex for Groq (`gsk_…`), Anthropic (`sk-ant-…`), or OpenAI organisation (`sk-proj-…`) keys. They are only caught incidentally by the generic entropy scanner. This is the root cause of the recent Groq key leak into a committed SQLite database.

3. **CLI file-edit tools bypass the scanning chokepoint, and streaming REDACT is incomplete.** The VS Code side of the decorator (`ScanningIde`) is solid, but the CLI parallel (`ScanningFileIo`) has gaps in the `edit`/`multiEdit`/`writeFile` tools, and the streaming response path in `ai.route.ts` only redacts in-flight chunks — accumulated buffers leak secrets the model emitted.

4. **Continue.dev cruft.** Telemetry that phones home to `api.continue.dev`, WorkOS auth against Continue's tenant, a JSON→YAML migration shim, dead `free-trial` provider stubs, a hub SDK we don't use, 26+ Kotlin files under `com.github.continuedev.*`, dual config format support, and references to `.continueignore` / `.continuerc.json`. All of it can go.

Everything else (token efficiency, caching, minor bypasses) is **P2**.

---

## 1. Critical Findings

### 1.1 Vault / Key Storage — **CRITICAL**

| ID  | File                                                                             | Issue                                                                                                                                     |
| --- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| V1  | `core/config/onboarding.ts:80,88,96`                                             | Setup wizard writes `OPENAI_API_KEY: sk-proj-…` as plain text to `config.yaml`; never calls the vault                                     |
| V2  | `core/llm/index.ts:273`                                                          | `BaseLLM.constructor` reads `options.apiKey` straight from YAML; no vault lookup                                                          |
| V3  | `core/llm/llms/OpenAI.ts:376` (same pattern: Anthropic, Groq, all 60+ providers) | Providers use the raw `this.apiKey` in request headers                                                                                    |
| V4  | `proxy/src/gateway/gatewayRouter.ts:84`                                          | `user_models.apiKey` column returned **unencrypted**, unlike `providers.apiKeyEncrypted`                                                  |
| V5  | `proxy/src/db/schema.ts`                                                         | `user_models.apiKey` stored without encryption — inconsistent with `providers` table                                                      |
| V6  | `gui/src/components/OnboardingCard/hooks/useSubmitOnboarding.ts:22`              | Posts plaintext apiKey to `onboarding/complete`, not `/api/providers`                                                                     |
| V7  | Any `config.yaml` path                                                           | `config.yaml` files are never scanned by the firewall's scanner pipeline — secrets in them are invisible to the product's own protections |

**Verdict:** Two isolated key stores exist. No code path migrates a YAML key into the vault. The vault works only for keys explicitly POSTed to `/api/providers` — a flow the default onboarding never exercises.

### 1.2 Scanner Pattern Coverage — **CRITICAL**

| ID  | File                                     | Issue                                                                                                                                      |
| --- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| S1  | `packages/scanner/src/patterns.ts:22-46` | No regex for Groq (`gsk_…`), Anthropic (`sk-ant-…`), OpenAI org (`sk-proj-…`). Currently only caught via entropy fallback (low confidence) |
| S2  | Same file                                | Explicit patterns exist for AWS (`AKIA…`) and GitHub (`ghp_…`), so the omission is arbitrary — not architectural                           |

### 1.3 Scan Chokepoint Coverage — **CRITICAL**

| ID  | File                                                  | Issue                                                                                                                                                                                  |
| --- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CH1 | `extensions/cli/src/tools/edit.ts:117`                | `fs.readFileSync(resolvedPath, "utf-8")` direct — bypasses `ScanningFileIo` entirely                                                                                                   |
| CH2 | `extensions/cli/src/tools/multiEdit.ts:117,125`       | Calls `scanFileViaProxy` directly then `fs.readFileSync` — not routed through the shim, no decision cache                                                                              |
| CH3 | `extensions/cli/src/services/ScanningFileIo.ts:44-52` | CLI config allowlist is basename-only; missing `FORCED_CONFIG_SUFFIXES` present in `ScanningIde.ts:67-71` (`.ai-firewall/config.yaml`, `.ai-firewall/policy.json`, `/mcpServers.json`) |
| CH4 | `core/config/loadProjectInstructions.ts:24`           | `.aifirewall.md` read with raw `fs.readFileSync` — content flows into the system prompt unscanned (prompt-injection entry point)                                                       |
| CH5 | `core/indexing/continueignore.ts:7`                   | Global ignore file read outside the decorator. Low risk but violates the chokepoint invariant                                                                                          |
| CH6 | `extensions/cli/src/tools/writeFile.ts:79`            | Direct `fs.readFileSync` for preview — scan runs first so it's structurally OK, but should use the shim for consistency                                                                |

### 1.4 BLOCK / REDACT Enforcement — **CRITICAL / HIGH**

| ID  | File                                                                                      | Issue                                                                                                                                        | Severity |
| --- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| E1  | `proxy/src/routes/ai.route.ts:305-310`, `proxy/src/middleware/responseScanner.ts:252-279` | Streaming REDACT is incomplete: inline SSE-chunk rewrite works, but the accumulated text buffer at flush is unredacted                       | CRITICAL |
| E2  | `proxy/src/middleware/responseScanner.ts:49`                                              | `response_scanning.enabled = false` by default — LLM05 (model emitting secrets) silently undetected                                          | HIGH     |
| E3  | `proxy/src/middleware/responseScanner.ts:234`                                             | `JSON.parse` inside the transform is uncaught — on failure, the chunk passes through unscanned                                               | HIGH     |
| E4  | `proxy/src/redactor/piiVault.ts`, `proxy/src/routes/ai.route.ts`                          | `detokenizePii()` has zero callers — reversible PII tokens are never restored on the response, user sees `<PII_EMAIL_a1b2c3>` literally      | HIGH     |
| E5  | `proxy/src/routes/mcpGateway.route.ts:220`                                                | `sanitizedOutput: action === "REDACT" ? redactedText : output` — if `redactedText` is undefined, unredacted content is returned              | HIGH     |
| E6  | `core/util/fileScanProxy.ts`                                                              | On proxy unreachable, core fail-opens with no local blocklist fallback — `proxy/src/scope/fileScope.ts` patterns aren't honoured client-side | MEDIUM   |

### 1.5 Token Efficiency / Cache Correctness — **MEDIUM**

| ID  | File                                                          | Issue                                                                                                                                                  |
| --- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| T1  | `proxy/src/routes/ai.route.ts:171-200`                        | Reducer pipeline in `proxy/src/reducer/` (5 files) exists but is never called on overflow — tokens wasted on every oversized request                   |
| T2  | `core/util/scanning/ScanningIde.ts:159`                       | `cacheKey(uri, 0, purpose)` — `mtime` hardcoded to `0`, stale decisions returned after file edits. CLAUDE.md documents the key as `path:mtime:purpose` |
| T3  | `proxy/src/routes/fileScan.route.ts:175-190`                  | Cache consulted **after** the full scan runs — every cache hit is wasted CPU                                                                           |
| T4  | `proxy/src/services/compactService.ts:246`                    | `Math.ceil(text.length / 4)` fallback for compaction budget — CLAUDE.md bans this outside `tokenCounter.ts`                                            |
| T5  | `core/util/repoMemory.ts:208,226`                             | Same `length / 4` heuristic for repo-memory summaries                                                                                                  |
| T6  | `core/nextEdit/providers/BaseNextEditProvider.ts:418,432,444` | Same heuristic branch — should unconditionally use `countTokens`                                                                                       |

### 1.6 Minor / Design Hygiene — **LOW**

| ID  | File                                              | Issue                                                                                                                                            |
| --- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| L1  | `core/util/scanning/ScanningIde.ts:164`           | `"autocomplete"` purpose returns `null` unconditionally. Intentional (latency) but add a comment explaining the LLM path re-scans                |
| L2  | `proxy/src/middleware/responseScanner.ts:187-198` | `X-AF-Response-Action` header emitted but no client (`GUI`/`CLI` fetch interceptor) consumes it; response leaks never trigger `ScanResultBanner` |

---

## 2. Execution Plan

Fixes are grouped into phases that can each ship as one PR. Each phase is independent unless noted.

### Phase A — Stop the bleeding (same day, <4h total)

**Goal:** Close the specific gap that caused the Groq leak, and make the vault warn on the next leak.

- **A1. Add explicit API-key regexes** (`packages/scanner/src/patterns.ts`)
  - Groq: `/gsk_[A-Za-z0-9]{40,}/g` (critical)
  - Anthropic: `/sk-ant-[A-Za-z0-9_-]{40,}/g` (critical)
  - OpenAI org: `/sk-proj-[A-Za-z0-9_-]{40,}/g` (critical)
  - Cohere: `/[a-zA-Z0-9]{40}/g` gated on `co.` context keyword
  - Add unit tests for each in `packages/scanner/src/__tests__/` (true positive + true negative per `.claude/rules/testing.md`)
- **A2. Scan `config.yaml` for secrets at load time**
  - Extend `core/config/yaml/yamlToContinueConfig.ts` to run the content through `@ai-firewall/scanner` before parsing.
  - On finding, emit a banner via the scan-report channel with severity `critical` + message "Plain-text API key detected in config.yaml — migrate to vault."
  - Do not block load (CLAUDE.md: "proxy informs, client decides").
- **A3. Port `FORCED_CONFIG_SUFFIXES` to CLI shim** (`extensions/cli/src/services/ScanningFileIo.ts`)
  - Copy the array from `ScanningIde.ts:67-71`
  - Add the suffix-match loop in `forcedConfigOverride()`.

**Acceptance:** Running `rg` over a synthetic `config.yaml` containing `OPENAI_API_KEY: sk-proj-TESTKEY123...` produces a finding. No existing tests break.

### Phase B — CLI chokepoint parity (1 day)

**Goal:** Eliminate the class of "CLI tool reads file directly" bypasses so the CLI agent cannot exfiltrate content the VS Code agent cannot.

- **B1.** `extensions/cli/src/tools/edit.ts:117` — replace with `const { content } = await scanningReadFile(resolvedPath, "llm")`.
- **B2.** `extensions/cli/src/tools/multiEdit.ts:117,125` — single `scanningReadFile` call; delete the duplicate `scanFileViaProxy` call.
- **B3.** `extensions/cli/src/tools/writeFile.ts:79` — route the preview read through the shim for consistency (not a real bypass, but removes a footgun for future CLI tool authors).
- **B4.** Add an ESLint rule or grep-based `pre-commit` check that flags any new `fs.readFileSync` / `fs.readFile` in `extensions/cli/src/tools/**` unless preceded by a `// scan-raw:` comment. (Prevents regression.)
- **B5.** Unit test: `ScanningFileIo` must record a decision for every path in `edit` / `multiEdit` / `writeFile` integration tests.

**Acceptance:** `grep -rn 'fs\.readFileSync\|fs\.readFile(' extensions/cli/src/tools/` returns only explicit `// scan-raw:` justified reads.

### Phase C — Vault authority, clean break (2 days, depends on Phase A)

**Goal:** Make the proxy vault the single source of truth for every BYOK API key. No fallback, no migration, no plaintext.

**Decision log**

- **No `env://` tier.** Environment variable indirection adds complexity for a scenario fresh users don't have.
- **No legacy `apiKey:` support.** A `config.yaml` containing a raw `apiKey:` field must **refuse to load** with a clear error pointing to the onboarding flow.
- **No migration command.** This is a fresh product; there is nothing to migrate.
- **`user_models.apiKey` column is deleted**, not backfilled. The table ships with `apiKeyEncrypted` only.

**Tasks**

- **C1. New resolve route** — `GET /api/providers/by-slug/:slug` returns `{ providerId, decryptedKey }` to authenticated core callers only. Gated by existing auth middleware; every call audited to `logs` table.
- **C2. Rewrite onboarding** — `core/config/onboarding.ts:80,88,96`
  - Delete the YAML-write path entirely.
  - Replace with `POST /api/providers` (encrypts + stores in vault, returns a slug like `openai-primary`).
  - Write the reference, not the key, to `config.yaml`: `apiKeyRef: vault://openai-primary`.
- **C3. BaseLLM resolver** — `core/llm/index.ts:273`
  - Accept only `apiKeyRef: vault://<slug>` — resolve via `/api/providers/by-slug/:slug` at instantiation.
  - If the field is missing or `apiKey:` is present instead, throw `InvalidKeyConfigError` with a message instructing the user to run onboarding.
  - Cache the resolved key in-memory for the lifetime of the LLM instance only; zeroize on disposal.
  - If the proxy is unreachable, **fail hard** — do not silently downgrade. The firewall is the runtime dependency; that is the product.
- **C4. Schema change** — `proxy/src/db/schema.ts`
  - Drop the unencrypted `user_models.apiKey` column. Ship `apiKeyEncrypted BLOB NOT NULL` instead.
  - Update `proxy/src/gateway/gatewayRouter.ts:84` to read the encrypted column through `decrypt()`.
  - Since this is a fresh product, no backfill script — the schema change is the final state.
- **C5. GUI wizard** — `gui/src/components/OnboardingCard/hooks/useSubmitOnboarding.ts:22`
  - POST the apiKey directly to the proxy's `/api/providers`, never to `onboarding/complete`.
  - Show a confirmation step: "Key encrypted and stored in vault. It will never touch disk in plain text."
  - On subsequent loads, the wizard reads the list of vaulted providers from `GET /api/providers` and shows "Already configured — re-enter to rotate."
- **C6. Config loader hard refusal** — `core/config/yaml/yamlToContinueConfig.ts`
  - On load, if any model entry contains a raw `apiKey:` field, throw and surface a clear error: `"Plain-text API keys are not supported. Run the onboarding wizard to vault your keys."`
  - Add a unit test that asserts the exact error.
- **C7. Scanner self-check** — run `@ai-firewall/scanner` over every loaded `config.yaml` via `ScanningIde` at `"config"` purpose. Any finding in a config file emits a banner (but does not block — the hard refusal in C6 is the gate).

**Acceptance**

1. `grep -rn '"apiKey"' core/config/ core/llm/ extensions/` returns no live code paths (only the validator that rejects it).
2. Fresh install → onboard with a Groq key → `grep -r 'gsk_' ~/` returns nothing.
3. Manually placing a `config.yaml` with a raw `apiKey:` under `~/.ai-firewall/` → IDE shows the hard-refusal error on startup.
4. All 60+ providers successfully resolve their key via the vault path in a single integration test run.
5. Killing the proxy mid-session → next LLM call fails with a clear "firewall unreachable" error, not a silent plaintext leak.

### Phase D — Enforcement correctness (1 day)

**Goal:** Close the BLOCK/REDACT gaps on the response path so the firewall's decisions actually ship.

- **D1.** `proxy/src/middleware/responseScanner.ts:252-279` — apply redaction to the accumulated buffer at flush before the final SSE chunk is sent.
- **D2.** Same file, line 49 — default `enabled: true` for `response_scanning`. Document the toggle in `policy.json`.
- **D3.** Same file, line 234 — wrap the `JSON.parse` in a try/catch; on failure, log and emit a `[REDACTED]` chunk.
- **D4.** `proxy/src/routes/ai.route.ts` — if the request created a `piiVault` session, call `detokenizePii(session, responseText)` before returning. Wire the `X-AF-Response-Action` header into the GUI/CLI fetch interceptors so `ScanResultBanner` fires on response-side findings.
- **D5.** `proxy/src/routes/mcpGateway.route.ts:220` — fix the `?? "[REDACTED]"` fallback.
- **D6.** `core/config/loadProjectInstructions.ts:24` — route `.aifirewall.md` through `ide.readFile(filepath, "config")`.
- **D7.** `core/indexing/continueignore.ts:7` — same treatment or add a `// scan-raw:` justification comment.

**Acceptance:** Integration test where the upstream provider emits a fake `sk-proj-TESTKEY…` in a streaming response — the client sees `[REDACTED]` in both the final text and the banner.

### Phase E — Token efficiency + cache hygiene (half day)

**Goal:** Close the "accurate tokens, less waste" gaps. Low risk, independent of the rest of the plan.

- **E1.** `core/util/scanning/ScanningIde.ts:159` — add `fs.statSync(uri).mtimeMs` to the cache key.
- **E2.** `proxy/src/routes/fileScan.route.ts:175-190` — invert the order: consult `getCachedScan` first, write-through on miss.
- **E3.** Replace `Math.ceil(text.length / 4)` in `proxy/src/services/compactService.ts:246`, `core/util/repoMemory.ts:208,226`, `core/nextEdit/providers/BaseNextEditProvider.ts:418,432,444` with `countMessageTokens` / `countTokens` from the authoritative modules.
- **E4.** Add a repo-wide pre-commit check: any new `length / 4` in a non-test file fails unless it appears inside `proxy/src/gateway/tokenCounter.ts`.

**Acceptance:** `rg 'length\s*/\s*4' --type ts` returns only `proxy/src/gateway/tokenCounter.ts` and test files.

### Phase F — Context reducer wiring (1 day, needs design call)

**Goal:** Stop wasting tokens on every context overflow without violating CLAUDE.md's "never auto-truncate" principle.

- **F1.** Add an opt-in policy flag `auto_compact_on_overflow` (default `false`) in `policy.json`.
- **F2.** In `proxy/src/routes/ai.route.ts:171-200`, when the flag is on and `checkContextWindow` reports overflow, invoke `compactConversation(messages, maxTokens * 0.9)`.
- **F3.** Emit a new header `X-AF-Auto-Compacted: true` so clients know the payload was modified.
- **F4.** Default off — the decision stays client-side unless the user opts in.

**Acceptance:** With the flag off, behaviour is identical to today. With the flag on, an overflow request succeeds and the response header is set.

### Phase H — Continue.dev cruft removal (2 days)

**Goal:** Since AI Firewall is a separate product with no backward-compatibility obligations, strip every Continue-specific code path, URL, name, and dead stub. Reduces attack surface, clarifies ownership, and removes future regression risk.

**H1. Control plane / telemetry (highest value)**

- `core/control-plane/env.ts` — delete `PRODUCTION_HUB_ENV`, `STAGING_ENV`, `TEST_ENV` (3 hardcoded envs pointing to `proxy.continue.dev` and `api.continue.dev`). Keep only `LOCAL` + MDM-specified URLs.
- `core/control-plane/env.ts:61-63` — delete `enableHubContinueDev()` (always returns `true` today).
- `core/control-plane/client.ts:49-50` — delete `TRIAL_PROXY_URL` constant + audit and rewire callers.
- `core/control-plane/analytics/ContinueProxyAnalyticsProvider.ts` — delete; `PostHogAnalyticsProvider` stays as the opt-in telemetry provider.
- `core/control-plane/analytics/IAnalyticsProvider.ts:7` — rebrand the "Continue for Teams" comment.
- `core/llm/streamChat.ts` — delete the free-trial status check branch.

**H2. Free-trial / Continue proxy stubs**

- `core/llm/llms/stubs/ContinueProxy.ts` — delete.
- `core/nextEdit/NextEditProvider.ts:18` — remove commented `free-trial` branch.
- Anywhere a `providerName === "free-trial"` branch exists — delete.

**H3. Auth / WorkOS**

- `extensions/cli/src/auth/workos.ts` — delete (unused; `proxy/src/auth/ssoService.ts` is the real path).
- `extensions/vscode/src/stubs/WorkOsAuthProvider.ts` — strip the disabled `WorkOS_*` constants; keep the stub shape only if something still imports it, otherwise delete the file.
- `proxy/src/auth/ssoService.ts:12-13` — delete `WORKOS_CLIENT_ID_PRODUCTION` / `WORKOS_CLIENT_ID_STAGING`; if AI Firewall has its own WorkOS tenant, replace with that, otherwise delete.

**H4. SDK / hub packages**

- `packages/continue-sdk/` — confirm zero imports across the repo, then delete the package + remove the workspace reference in root `package.json`.
- `packages/hub/` — already rebranded as `@ai-firewall/hub`; keep as a generic YAML loader but do a rename sweep on any residual Continue references inside it.

**H5. Dual-config / legacy format loaders**

- `core/config/migrateSharedConfig.ts` — entire file is a one-shot JSON→YAML migration with a comment saying "remove in the future". Delete it.
- `core/config/load.ts:35` — delete `getLegacyBuiltInSlashCommandFromDescription` import + any `tabAutocompleteOptions` legacy field handling.
- `core/config/load.ts:81-95` — remove the env-substitution loop and the dual-format parsing; keep only the YAML path.
- `core/config/loadLocalAssistants.ts` — keep (assistants are a real feature) but run a brand sweep.
- Support only one config file name: `.ai-firewall/config.yaml`. Delete any `.continuerc.json`, `.continuerules`, `.continueignore` fallbacks.

**H6. Branding sweep — files and paths**

- `core/util/paths.ts:47-56` — rename `getContinueUtilsPath` → `getAiFirewallUtilsPath`, `getChromiumPath` comment fix.
- `core/util/paths.ts:58-67` — rename `getGlobalContinueIgnorePath` → `getGlobalAiFirewallIgnorePath`; the file it returns should be `.ai-firewallignore` (already partially done at line 61).
- Root `.continueignore` file — delete, use `.ai-firewallignore`.
- Any lingering `~/.continue/` path reference — rewrite to `~/.ai-firewall/`. Search glob: `rg '\.continue[/\"]'`.

**H7. Branding sweep — classes and packages**

- `gui/src/util/isContinueTeamMember.ts` — delete the deprecated alias, switch all callers to `isFirewallTeamMember`.
- `core/context/providers/ContinueProxyContextProvider.ts` — rename file + class + description string (keep the functionality; it's a real provider, just named after Continue).
- `extensions/intellij/src/main/kotlin/com/github/continuedev/**` — 26+ Kotlin files under `com.github.continuedev` package. Bulk rename to `com.aifirewall` (or similar). Classes: `ContinueAuthService`, `ContinueAuthDialog`, `ContinuePluginActions`, `ContinueErrorSubmitter`, `ContinueExtensionSettingsService`, `ContinueInlineCompletionProvider` → `AiFirewall*` equivalents. **Warning:** `ContinueExtensionSettingsService` stores JetBrains persistent state keyed on the class name — renaming drops existing user state. Acceptable (fresh product), but flag in release notes.

**H8. URL references**

- Repo-wide `rg 'continue\.dev'` sweep — replace documentation links, error messages, setup instructions. Anywhere a URL is hardcoded, point it at the AI Firewall equivalent or localhost.
- `docs/` — sweep for Continue-branded screenshots, logos, marketing copy.

**H9. Tests tied to Continue compat**

- Any test file named `*legacy*`, `*backwardCompat*`, `*v1Config*`, `*migration*` — delete unless it validates an AI Firewall-native behaviour.
- Tests asserting specific Continue URL shapes or Continue API response formats — delete.

**Risk list (from audit)**

- `useHub()` and `getControlPlaneEnv()` are called from `core/config/load.ts:39`, `extensions/vscode/src/stubs/WorkOsAuthProvider.ts:45`, and GUI auth flow. Killing the hub envs without rewiring these breaks startup — sequence H1 before the GUI/stub edits.
- `extensions/cli/src/telemetry/telemetryService.ts` is called from multiple CLI commands. Audit its destination before deleting.
- `migrateSharedConfig.ts` is called by `ConfigHandler.ts` and `core.ts` — trace the full dependency graph before deletion.
- JetBrains `ContinueExtensionSettingsService` rename drops existing user state — document in release notes.

**Acceptance**

- `rg -l 'continue\.dev|continuedev|Continue Team|free-trial|continueSdk'` returns zero source files (docs/marketing copy excluded only if explicitly rebranded).
- `find . -name '*.continue*' -not -path '*/node_modules/*'` returns nothing.
- `~/.continue/` is never written to by any code path.
- Fresh clone → `npm install` → `npm run build` across every workspace package succeeds.
- VS Code + JetBrains + CLI all start cleanly with no "Continue" strings visible in the user interface.

### Phase G — Historical cleanup (separate decision)

**Goal:** Address secrets already in git history on `origin/dev-final`.

- **G1.** Rotate the Groq key (and any other keys in the committed SQLite DB). **Do this immediately, regardless of the rest of the plan.**
- **G2.** Decide whether to run `git filter-repo` to purge `proxy/data/**` from all history. This rewrites every commit SHA on `dev-final` and requires a force-push. **Not recommended until all contributors are warned; defer to the repo owner.**
- **G3.** Audit GitHub's secret-scanning alerts panel for any other flagged secrets; close each with an explicit reason.

---

## 3. Priority Order (by blast radius)

1. **G1** — Rotate the Groq key (5 min) — real mitigation for the current leak, do this immediately
2. **A1** — Add explicit API-key regexes (10 min) — prevents the next leak of the same class
3. **A2** — Scan `config.yaml` at load (2h) — makes the vault bypass visible until Phase C lands
4. **A3** — CLI config allowlist parity (15 min) — trivial, unblocks config reads
5. **B1–B5** — CLI chokepoint parity (1 day) — one coherent PR
6. **D1–D3** — Streaming redaction fix + default-on (4h) — closes the LLM05 gap
7. **D4–D7** — Remaining enforcement gaps (4h)
8. **E1–E4** — Token efficiency + cache (half day)
9. **C1–C7** — Vault authority, clean break (2 days) — biggest architectural win, unblocked by the no-backward-compat decision
10. **H1–H9** — Continue.dev cruft removal (2 days) — can run in parallel with C after A is done
11. **F1–F4** — Reducer wiring, opt-in (1 day)
12. **G2** — History rewrite (separate decision, force-push required)

---

## 4. Cross-cutting Rules (apply to every PR from this plan)

- **Tests first** per `.claude/rules/tdd.md`: scanner patterns need true-positive + true-negative tests, policy edges need BLOCK/REDACT/ALLOW coverage.
- **No `any`** — narrow via `unknown` per `.claude/rules/coding-style.md`.
- **Immutability** — spread, don't mutate.
- **Error handling** — no silent `catch {}`; always log through the structured logger.
- **Theme-mapped colours** on any GUI changes (e.g., migration banner) per `.claude/rules/design-qa-checklist.md`.
- **Docs update after each phase**: CLAUDE.md, `docs/security/scanners.mdx`, this file's "status" section, plus any relevant user-facing docs per the "always update docs" memory.

---

## 5. Open Questions for the Owner

1. **Auto-compaction default.** CLAUDE.md says "never auto-truncate." Phase F adds an opt-in flag — is that enough, or should compaction always require an explicit client-side request?
2. **History rewrite.** Phase G2 is destructive. Who else works on `dev-final`? Are there open PRs that would break?
3. **Response-scan latency.** Default-on response scanning (Phase D2) adds a scan pass to every LLM response. Acceptable for the default experience, or gate on model size?
4. **New scanner patterns.** Beyond Groq/Anthropic/OpenAI-proj, which other providers ship named-format keys we should catch explicitly? (Mistral, Together, Fireworks, Perplexity, xAI, DeepSeek…)
5. **Telemetry destination (Phase H1).** Once Continue's control plane is gutted, do we ship any telemetry at all? If yes, to where — self-hosted, PostHog cloud, nothing?
6. **JetBrains package rename (Phase H7).** The rename drops existing JetBrains user state keyed on `ContinueExtensionSettingsService`. Acceptable (fresh product), but confirm there are no alpha users whose state we want to preserve.

---

## 6. Success Criteria (end-to-end acceptance)

A release can ship when all of the following hold:

- `rg 'gsk_' packages/scanner/src/patterns.ts` returns a match.
- Fresh install, onboarding via GUI, then `grep -r 'sk-\|gsk_\|sk-ant-' ~/.continue/` returns nothing.
- `grep -rn 'fs\.readFileSync' extensions/cli/src/tools/` returns zero results (or only `// scan-raw:`-justified ones).
- `rg 'length\s*/\s*4' --type ts` returns only `tokenCounter.ts` and test files.
- A streaming integration test where the upstream model emits a test secret shows `[REDACTED]` in both the final text and the client banner.
- All existing tests pass; new tests added for every regex, every chokepoint fix, and the vault resolve path.
- CLAUDE.md + `docs/security/scanners.mdx` updated to reflect the new state.

---

_End of plan._
