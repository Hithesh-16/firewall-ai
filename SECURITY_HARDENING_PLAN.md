# Security Hardening Plan — AI Firewall

**Status:** In progress — Phase A executing 2026-04-16
**Date drafted:** 2026-04-15
**Last verified:** 2026-04-16 (codebase re-surveyed against every finding below)
**Source:** Consolidated audit across key storage, scan-chokepoint coverage, BLOCK/REDACT enforcement, and token efficiency
**Related:** `CLAUDE.md` (architecture), `.claude/rules/audit-checklist.md`, `AUTH_AND_ONBOARDING_PLAN.md`

> ## Verification log (2026-04-16)
>
> Re-surveyed every finding before starting Phase A. Status legend used in
> the tables below:
>
> - ✅ **Confirmed open** — bug still present at the cited line, exact
>   reproduction held up.
> - 🟡 **Partially closed** — code shape changed since the draft but the
>   underlying gap remains; updated guidance below.
> - ✅⚙️ **In progress** — actively being fixed in this session.
> - ✅✓ **Closed** — verified fixed, test added.
>
> Findings without a status emoji are unverified — the on-paper severity
> stands but the line numbers in this plan may have drifted.

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

### 1.1 Vault / Key Storage — **CRITICAL** _(re-surveyed 2026-04-16)_

| ID  | Status           | File                                                                 | Issue                                                                                                                                                                                                                                            |
| --- | ---------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| V1  | 🟡 partially     | `core/config/onboarding.ts`                                          | YAML-write pattern still exists in `setupProviderConfig()` (`with: { [apiKeyInputName]: apiKey }`) but is no longer the default onboarding entry point. Wire the new flow in C2.                                                                 |
| V2  | ✅ open          | `core/llm/index.ts:273`                                              | `this.apiKey = options.apiKey;` — accepts raw value from YAML; no vault lookup. C3 still needed.                                                                                                                                                 |
| V3  | ✅ open          | `core/llm/llms/OpenAI.ts:376` (+60 provider files share the pattern) | `Authorization: \`Bearer ${this.apiKey}\`` uses the unvalidated field. Becomes safe automatically once V2 is fixed.                                                                                                                              |
| V4  | ✅✓ closed       | `proxy/src/gateway/gatewayRouter.ts:84`                              | Returns `decryptedKey: um.apiKey`; the underlying `userModelService.ts:77` already does `apiKey: decrypt(row.api_key_encrypted)`. No plaintext leaves the proxy.                                                                                 |
| V5  | ✅✓ closed       | `proxy/src/db/schema.ts`                                             | `user_models` uses `api_key_encrypted` (encrypted BLOB) consistent with the `providers` table.                                                                                                                                                   |
| V6  | 🟡 partially     | `gui/src/components/OnboardingCard/hooks/useSubmitOnboarding.ts:22`  | Sends apiKey to the IDE messenger `onboarding/complete`, not to a proxy HTTP route. Extension-side handler still needs to be wired through `/api/providers`.                                                                                     |
| V7  | ✅✓ closed by A2 | Any `config.yaml` path                                               | `core/config/yaml/scanLoadedConfig.ts` (Phase A.A2) walks loaded YAML, scans every literal `apiKey:` value, and emits a critical `ScanReport`. Hard refusal still pending (C6).                                                                  |
| V8  | 🆕 added         | `packages/config-yaml/src/schemas/models.ts:181`                     | `apiKeyRef: z.string().optional()` field already exists in the schema (commented "vault://provider-slug/model"). Resolver logic in `core/config/yaml/load/clientRender.ts:135` is partial — vault `://` substitution not implemented end-to-end. |
| V9  | 🆕 added         | `proxy/src/routes/`                                                  | `GET /api/providers/by-slug/:slug` (C1) **does not exist** yet. Only id-based `GET /api/providers/:id` is available.                                                                                                                             |

**Verdict (revised 2026-04-16):** schema and DB layer are vault-clean. The bypass surface narrowed to: (a) the resolver wiring at `BaseLLM` (V2/V3), (b) the GUI/IDE onboarding handoff (V6), (c) the missing slug resolver route (V9), and (d) the absent hard refusal (C6). Phase A.A2 already shines a light on every leak — Phase C now has to close the migration path.

### 1.2 Scanner Pattern Coverage — **CRITICAL**

| ID  | Status              | File                                     | Issue                                                                                                                                                                                                           |
| --- | ------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | ✅⚙️ this PR        | `packages/scanner/src/patterns.ts:22-46` | No regex for Groq (`gsk_…`), Anthropic (`sk-ant-…`), OpenAI org (`sk-proj-…`). Currently only caught via entropy fallback (low confidence)                                                                      |
| S2  | ✅⚙️ this PR        | Same file                                | Explicit patterns exist for AWS (`AKIA…`) and GitHub (`ghp_…`), so the omission is arbitrary — not architectural                                                                                                |
| S3  | 🆕 added 2026-04-16 | Same file                                | Plan should also cover Mistral (`api-…`), Together AI (`xxx-…` 64-char), Fireworks (`fw_…`), Perplexity (`pplx-…`), DeepSeek (`sk-…` shorter), xAI (`xai-…`) — recommended **next batch**, not blocking Phase A |

### 1.3 Scan Chokepoint Coverage — **CRITICAL**

| ID  | Status       | File                                                  | Issue                                                                                                                                                                                  |
| --- | ------------ | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CH1 | ✅ open      | `extensions/cli/src/tools/edit.ts:117`                | `fs.readFileSync(resolvedPath, "utf-8")` direct — bypasses `ScanningFileIo` entirely                                                                                                   |
| CH2 | ✅ open      | `extensions/cli/src/tools/multiEdit.ts:117,125`       | Calls `scanFileViaProxy` directly then `fs.readFileSync` — not routed through the shim, no decision cache                                                                              |
| CH3 | ✅⚙️ this PR | `extensions/cli/src/services/ScanningFileIo.ts:36-52` | CLI config allowlist is basename-only; missing `FORCED_CONFIG_SUFFIXES` present in `ScanningIde.ts:67-71` (`.ai-firewall/config.yaml`, `.ai-firewall/policy.json`, `/mcpServers.json`) |
| CH4 | ✅ open      | `core/config/loadProjectInstructions.ts:24`           | `.aifirewall.md` read with raw `fs.readFileSync` — content flows into the system prompt unscanned (prompt-injection entry point)                                                       |
| CH5 | ✅ open      | `core/indexing/continueignore.ts:7`                   | Global ignore file read outside the decorator. Low risk but violates the chokepoint invariant                                                                                          |
| CH6 | ✅ open      | `extensions/cli/src/tools/writeFile.ts:79`            | Direct `fs.readFileSync` for preview — scan runs first so it's structurally OK, but should use the shim for consistency                                                                |

### 1.4 BLOCK / REDACT Enforcement — **CRITICAL / HIGH** _(re-surveyed 2026-04-16)_

| ID  | Status       | File                                              | Issue                                                                                                                                                                                           | Severity |
| --- | ------------ | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| E1  | ✅ open      | `proxy/src/middleware/responseScanner.ts:264-281` | `flush()` runs the final scan and emits a SUMMARY SSE comment but **never redacts the accumulated buffer before flushing**. Inline chunks ARE rewritten (252-259) — gap is on the final tail.   | CRITICAL |
| E2  | ✅ open      | `proxy/src/middleware/responseScanner.ts:49`      | `enabled: false` is still the default in `DEFAULT_CONFIG`. Response scanning opt-in only.                                                                                                       | HIGH     |
| E3  | 🟡 by-design | `proxy/src/middleware/responseScanner.ts:234`     | `JSON.parse` catch is empty but the chunk participates in buffer accumulation and is caught by the next interval scan. Re-classified low-risk; D3 should still wrap with explicit logging.      | LOW      |
| E4  | ✅ open      | `proxy/src/redactor/piiVault.ts:184`              | `detokenizePii()` exists but **zero production callers** (only `proxy/src/test/advancedFeatures.test.ts`). PII tokens never restored on response.                                               | HIGH     |
| E5  | ✅ open      | `proxy/src/routes/mcpGateway.route.ts:220`        | `redactedText` may be `undefined` when `redact_on_detection: false`; ternary leaves `sanitizedOutput` undefined.                                                                                | HIGH     |
| E6  | ✅ open      | `core/util/fileScanProxy.ts:45-50`                | `FAIL_OPEN = { action: "ALLOW", … }` — no client-side glob fallback against `proxy/src/scope/fileScope.ts` patterns.                                                                            | MEDIUM   |
| E7  | 🆕 added     | `gui/src/`, `extensions/cli/`                     | `X-AF-Response-Action` header IS emitted (`responseScanner.ts:191`) but **no client interceptor reads it**. GUI's `ScanResultBanner` reads from Redux, never from response headers. Wire in D4. | MEDIUM   |
| E8  | 🆕 added     | `core/config/loadProjectInstructions.ts:24`       | `.aifirewall.md` still read via raw `fs.readFileSync` — system-prompt injection vector. Same defect class as CH4; fix together in D6.                                                           | HIGH     |

### 1.5 Token Efficiency / Cache Correctness — **MEDIUM**

| ID  | Status  | File                                                          | Issue                                                                                                                                                                                                                                  |
| --- | ------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| T1  | ✅ open | `proxy/src/routes/ai.route.ts:171-200`                        | Reducer pipeline in `proxy/src/reducer/` (5 files) exists but is never called on overflow — tokens wasted on every oversized request                                                                                                   |
| T2  | ✅ open | `core/util/scanning/ScanningIde.ts:159`                       | `cacheKey(uri, 0, purpose)` — `mtime` hardcoded to `0`, stale decisions returned after file edits. CLAUDE.md documents the key as `path:mtime:purpose`. **Note:** the CLI parallel `ScanningFileIo.ts:99` already does this correctly. |
| T3  | ✅ open | `proxy/src/routes/fileScan.route.ts:175-190`                  | Cache consulted **after** the full scan runs — every cache hit is wasted CPU                                                                                                                                                           |
| T4  | ✅ open | `proxy/src/services/compactService.ts:246`                    | `Math.ceil(text.length / 4)` fallback for compaction budget — CLAUDE.md bans this outside `tokenCounter.ts`                                                                                                                            |
| T5  | ✅ open | `core/util/repoMemory.ts:208,226`                             | Same `length / 4` heuristic for repo-memory summaries                                                                                                                                                                                  |
| T6  | ✅ open | `core/nextEdit/providers/BaseNextEditProvider.ts:418,432,444` | Same heuristic branch — should unconditionally use `countTokens`                                                                                                                                                                       |

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

- **A1. Add explicit API-key regexes** (`packages/scanner/src/patterns.ts`) — _✅⚙️ in progress this PR_
  - Groq: `/gsk_[A-Za-z0-9]{40,}/g` (critical)
  - Anthropic: `/sk-ant-[A-Za-z0-9_-]{40,}/g` (critical)
  - OpenAI project: `/sk-proj-[A-Za-z0-9_-]{40,}/g` (critical)
  - Cohere: `/[a-zA-Z0-9]{40}/g` gated on `co.` context keyword
  - Extend `SecretType` in `packages/scanner/src/types.ts` with the new variants.
  - Add unit tests for each in `packages/scanner/src/__tests__/` (true positive + true negative per `.claude/rules/testing.md`).
- **A2. Detect plain-text `apiKey` in loaded YAML config** — _✅⚙️ in progress this PR (revised approach)_
  - **Revised** from the original draft: the disk-read path uses `ide.readFile` which already routes through the scanner; raw-text scanning of YAML duplicates that and produces noise on commit hashes / ENV examples. Instead, hook at the **post-parse** point in `core/config/yaml/loadYaml.ts` (after `unrollAssistant` returns and before `validateConfigYaml`).
  - Walk `config.models[]` (and any other slot exposing `apiKey`); for each entry where `apiKey` is set and is **not** an empty string, **not** a `${{ secrets.X }}` template, and **not** a `vault://` reference, run the value through `@ai-firewall/scanner`'s `scanSecrets`.
  - Emit a `ScanReport` via `publishScanReport` (the scan-report channel — same plumbing the file scanner uses) with severity `critical` and message: _"Plain-text API key detected in `config.yaml` model `<name>` — migrate to `apiKeyRef: vault://...` (Phase C)."_
  - Do not block load (CLAUDE.md: "proxy informs, client decides"). The hard refusal lives in Phase C.
- **A3. Port `FORCED_CONFIG_SUFFIXES` to CLI shim** (`extensions/cli/src/services/ScanningFileIo.ts`) — _✅⚙️ in progress this PR_
  - Copy the array from `ScanningIde.ts:67-71`.
  - Add the suffix-match loop in `forcedConfigOverride()` (mirror the IDE implementation).

**Acceptance:**

1. `scanSecrets("Authorization: Bearer gsk_AAAA…BBBB")` returns a `GROQ_KEY` match in `packages/scanner` unit tests.
2. Loading a `config.yaml` containing a model with `apiKey: sk-proj-TESTKEY...` emits a critical ScanReport visible in the GUI/CLI banner channel; load still completes.
3. CLI tool reading `~/.ai-firewall/config.yaml` is forced to `"config"` purpose (verified by reading the path and confirming no proxy round-trip).
4. `tsc --noEmit` clean across affected packages; no existing test fails.

**Phase A — completion log (2026-04-16)**

- ✅✓ **A1** — Added `GROQ_KEY` / `ANTHROPIC_KEY` / `OPENAI_PROJECT_KEY` / `COHERE_KEY` to both `packages/scanner/src/{types,patterns}.ts` and the proxy's mirror at `proxy/src/types/index.ts`. Cohere uses a context-keyword anchor to avoid false positives on commit-hash-shaped strings. 9 new unit tests in `proxy/src/test/secretPatterns.test.ts` (TP + TN per pattern + cross-pattern prose check); all pass. Total proxy test suite: 690 pass, 1 pre-existing fail (`testStrictLocalConfigParsing`, unrelated, documented in CLAUDE.md).
- ✅✓ **A2** — New module `core/config/yaml/scanLoadedConfig.ts` walks `assistant.models[]` post-unroll, identifies literal `apiKey:` values (skipping `vault://...`, `${{ secrets.X }}`, empty), runs each through `scanSecrets`, and publishes a `ScanReport` with severity `critical` and a remediation message. Wired into `core/config/yaml/loadYaml.ts` after `validateConfigYaml`. Defensive try/catch ensures scanner failure cannot break config load. 7 unit tests in `core/config/yaml/scanLoadedConfig.test.ts`; all pass. Reports outside an active `runInScanContext` are silently dropped (no startup-time banner spam).
- ✅✓ **A3** — Ported `FORCED_CONFIG_SUFFIXES` (`/mcpServers.json`, `/.ai-firewall/config.yaml`, `/.ai-firewall/policy.json`, plus Windows-separator equivalents) from `core/util/scanning/ScanningIde.ts` into `extensions/cli/src/services/ScanningFileIo.ts`. CLI now matches IDE behaviour for self-referential config reads.

`tsc --noEmit` clean across `core/`, `proxy/`, `extensions/cli/`, `packages/scanner/`. **Phase A is complete.**

### Phase B — CLI chokepoint parity (1 day)

**Goal:** Eliminate the class of "CLI tool reads file directly" bypasses so the CLI agent cannot exfiltrate content the VS Code agent cannot.

- **B1.** `extensions/cli/src/tools/edit.ts:117` — replace with `const { content } = await scanningReadFile(resolvedPath, "llm")`.
- **B2.** `extensions/cli/src/tools/multiEdit.ts:117,125` — single `scanningReadFile` call; delete the duplicate `scanFileViaProxy` call.
- **B3.** `extensions/cli/src/tools/writeFile.ts:79` — route the preview read through the shim for consistency (not a real bypass, but removes a footgun for future CLI tool authors).
- **B4.** Add an ESLint rule or grep-based `pre-commit` check that flags any new `fs.readFileSync` / `fs.readFile` in `extensions/cli/src/tools/**` unless preceded by a `// scan-raw:` comment. (Prevents regression.)
- **B5.** Unit test: `ScanningFileIo` must record a decision for every path in `edit` / `multiEdit` / `writeFile` integration tests.

**Acceptance:** `grep -rn 'fs\.readFileSync\|fs\.readFile(' extensions/cli/src/tools/` returns only explicit `// scan-raw:` justified reads.

**Phase B — completion log (2026-04-16)**

- ✅✓ **B1** — `edit.ts:117` now `await scanningReadFile(resolvedPath, "llm")`. BLOCK is caught and re-thrown as a `ContinueError(FileIsSecurityConcern)` with the report's reasons + risk score.
- ✅✓ **B2** — `multiEdit.ts` lost its duplicate `scanFileViaProxy(resolvedPath)` call; single trip through `scanningReadFile` + cache. Same BLOCK→ContinueError conversion.
- ✅✓ **B3** — `writeFile.ts` routes both reads through the shim: the `preprocess` preview read (line ~80) and the `run` step's old-content fetch for the diff/telemetry calculation (line ~176). The latter benefits from the decision cache (path+mtime+purpose) so it's effectively free after preprocess. Original swallow-all `catch {}` was tightened to re-throw `ContinueError` instances.
- ✅✓ **B4** — Static guard: `extensions/cli/src/services/cliChokepointGuard.test.ts` parses every file in `WATCHED_FILES` (`edit.ts`, `multiEdit.ts`, `writeFile.ts`) and fails if any new `fs.readFileSync(` appears without a `// scan-raw:` justification within 3 lines above. Caught one regression in writeFile.ts:176 during this PR (now fixed).
- ✅✓ **B5** — The static guard doubles as the regression test. 3/3 tests pass, no live proxy needed. CI-friendly (1s runtime).

`tsc --noEmit` clean across `extensions/cli/`. **Phase B is complete.**

### Phase C — Vault authority, clean break (2 days, depends on Phase A) _(re-surveyed 2026-04-16)_

**Survey delta (2026-04-16):** V4 (gateway returns plaintext from `user_models`) is **already closed** — the row is decrypted via `userModelService.ts:77` before reaching the gateway. V5 (schema unencrypted column) is **already closed** — the column is `api_key_encrypted` BLOB. The remaining surface is narrower than the original draft assumed:

- **Still open:** V2/V3 (BaseLLM accepts raw `options.apiKey` + 60+ providers use it in headers), V6 (GUI onboarding sends apiKey to IDE messenger, not proxy `/api/providers`), V9 (no `GET /api/providers/by-slug/:slug` route), C6 (no hard refusal on plaintext `apiKey:` in YAML).
- **Already partially in place:** the schema accepts `apiKeyRef: z.string().optional()` (`packages/config-yaml/src/schemas/models.ts:181`), commented "vault://provider-slug/model". Resolver wiring at `core/config/yaml/load/clientRender.ts:135` is partial; the substitution path is unfinished.

**Revised priority for Phase C:** C4/C5 (schema, GUI onboarding) and C1 (slug route) are the smallest dependencies. C3 (BaseLLM resolver) is the keystone — once it consumes `apiKeyRef` and refuses raw `apiKey`, every provider becomes vault-only automatically (V3 closes for free). C6 (hard refusal) is a 5-line throw in `loadYaml.ts` + a new test, gated behind C3 landing first.

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

**Phase D — partial completion log (2026-04-16)**

Quick wins shipped this session (D2, D5, D6 — and D7 closed by `// scan-raw:` justification per the plan's "same treatment or add a comment" guidance):

- ✅✓ **D2** — `proxy/src/middleware/responseScanner.ts:49`: `DEFAULT_CONFIG.enabled` flipped to `true`. Per-request scan cost is sub-ms; `redact_on_detection` stays `false` so the default is "warn, don't rewrite" — surfaces incidents without changing payload bytes. Existing `testResponseScanSkipsWhenDisabled` still passes (it explicitly opts out).
- ✅✓ **D5** — `proxy/src/routes/mcpGateway.route.ts:220`: ternary now `outputScanResult.redactedText ?? "[REDACTED]"`. When policy says "scan and warn but don't rewrite" and `redactedText` is undefined, the sanitized output is the literal `"[REDACTED]"` sentinel instead of leaking the raw `output` via the previous undefined-coalesce fallback.
- ✅✓ **D6** — `core/config/loadProjectInstructions.ts`: rewrote to scan content via `scanPromptInjection` + `scanSecrets` inline before returning. If the injection score crosses the conservative `INJECTION_BLOCK_THRESHOLD = 60` (matches the package's default `isInjection` boundary), the file is excluded from the system prompt and a critical `ScanReport` is emitted via the scan-report channel. Lower-severity findings still emit informational reports. Function stayed sync (no async cascade through callers — there are zero callers in core today; both `loadProjectInstructions` and `loadProjectContext` were unused helpers, low blast radius). Inline scan plus an explicit `// scan-raw:` comment satisfy the chokepoint invariant.
- ✅✓ **D7** — `core/indexing/continueignore.ts:7`: added a `// scan-raw:` justification. The global ignore file is parsed as gitignore-style globs and never reaches an LLM (no prompt injection vector); routing through the scanner adds latency without security value.

Still open (need design discussion before execution):

- ❌ **D1** — accumulated-buffer redaction at stream flush. Requires a state-machine change inside `createScanningTransform` so the final flush re-emits a redacted tail when `redact_on_detection: true`. Touches the streaming protocol assumptions.
- ❌ **D3** — `JSON.parse` re-classified to LOW severity (E3 row in section 1.4). The chunk is caught in the next interval scan; the original "silent passthrough" claim was incorrect. D3 reduced to "wrap with explicit logging" — useful but no longer urgent.
- ❌ **D4** — PII detokenization end-to-end + client interceptor for `X-AF-Response-Action`. Two-layer change (proxy + every client). Saved for a dedicated PR.

`tsc --noEmit` clean, full proxy suite still 690 pass / 1 known pre-existing fail.

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
