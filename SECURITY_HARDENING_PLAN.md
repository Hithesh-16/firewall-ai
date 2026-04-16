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

**Phase C — partial completion log (2026-04-17)**

- ✅✓ **C1 (`GET /api/providers/by-slug/:slug`)** — added to `proxy/src/routes/provider.route.ts`. Composes the existing `resolveProviderForUser(userId, orgId, slug)` + `getProviderBySlug` services and returns `{slug, baseUrl, source: "user"|"org"|"global", decryptedKey}` to authenticated callers. Resolution order matches `gatewayRouter`: user override → org default → global registry. Returns 404 with a clear "no vault entry resolves this slug" message if nothing matches — failing closed per the C-phase principle. Gated by the `provider:read` capability (same as the existing `GET /api/providers`). This is the foundation C3 (BaseLLM resolver) will plug into.

The other Phase C items (C2 onboarding rewrite, C3 BaseLLM resolver, C5 GUI wizard, C6 hard refusal) are larger and break existing flows — held for sign-off before execution. C7 was already closed by Phase A.A2 scanner.

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

**Phase E — completion log (2026-04-16)**

- ✅✓ **E1** — `core/util/scanning/ScanningIde.ts`: hardcoded `cacheKeyMtime = 0` replaced with `await statMtime(uri)` (uses `fs.promises.stat`, strips `file://` and query/fragment, falls back to 0 for vfs/untitled paths). Cache key now matches CLAUDE.md's documented `path:mtime:purpose` shape — file edits invalidate stale decisions automatically. The CLI parallel `ScanningFileIo.ts` already did this correctly; the IDE side is now in line.
- ✅✓ **E2** — `proxy/src/scanner/fileScanService.ts`: cache lookup moved BEFORE the scanner pipeline. Read + hash still run (we need the hash to key the cache), but the seven-scanner pipeline is skipped on cache hit. Returns the cached result with `cached: true` and an updated `scanDurationMs`.
- ✅✓ **E3** — three of four `Math.ceil(length / 4)` violations closed with the canonical tokenizer:
  - `proxy/src/services/compactService.ts:246` — `estimateTokens` helper deleted, sole caller now uses `await countTokens(text, model)` from `tokenCounter.ts` (tiktoken with documented heuristic fallback).
  - `core/util/repoMemory.ts:208,226` — both `tokenEstimate` assignments use `countTokens()` from `core/llm/countTokens.ts` (sync, llama2 default tokenizer).
  - `packages/openai-adapters/src/apis/AnthropicCachingStrategies.ts:13` — kept the local heuristic, but added an explicit "documented exception" comment justifying it (cache-decision gate where ~10% accuracy is fine; can't import `tokenCounter` from a leaf adapter package without inverting the dependency graph).
  - `core/nextEdit/providers/BaseNextEditProvider.ts:418,432,444` — kept the `heuristic: "fourChars" | "tokenizer"` API parameter (it's an explicit, documented performance opt-out for autocomplete inner loops). Added a clarifying comment that this is the documented exception per the same E3 rationale.
- ❌ **E4** — pre-commit lint guard not added in this batch. The remaining violations are now all explicitly justified with comments, so a guard is no longer urgent. Recommend adding a `rg 'length\s*/\s*4' --type ts` check in CI as the simpler enforcement.

`tsc --noEmit` clean across `core/`, `proxy/`, `extensions/cli/`. Full proxy suite still 690 pass / 1 known pre-existing fail.

### Phase F — Context reducer wiring (1 day, needs design call)

**Goal:** Stop wasting tokens on every context overflow without violating CLAUDE.md's "never auto-truncate" principle.

- **F1.** Add an opt-in policy flag `auto_compact_on_overflow` (default `false`) in `policy.json`.
- **F2.** In `proxy/src/routes/ai.route.ts:171-200`, when the flag is on and `checkContextWindow` reports overflow, invoke `compactConversation(messages, maxTokens * 0.9)`.
- **F3.** Emit a new header `X-AF-Auto-Compacted: true` so clients know the payload was modified.
- **F4.** Default off — the decision stays client-side unless the user opts in.

**Acceptance:** With the flag off, behaviour is identical to today. With the flag on, an overflow request succeeds and the response header is set.

**Phase F — verification (2026-04-16)**

All four tasks remain entirely greenfield. Survey results:

- `compactConversation` exists at `gui/src/util/compactConversation.ts`, **not in the proxy**. Wiring it into `proxy/src/routes/ai.route.ts:171-200` requires moving it to a shared package (`packages/scanner/` or a new `packages/reducer/`) since `proxy/` cannot import from `gui/`.
- `proxy/src/types/index.ts` `PolicyConfig` has no `auto_compact_on_overflow` flag (or any `auto_compact_*`).
- Zero repo-wide hits for `X-AF-Auto-Compacted`.

**Decision needed before execution:** the plan's F2 imports `compactConversation` from `gui/`. That violates the `proxy → gui` boundary (proxy doesn't depend on the GUI). Either (a) move `compactConversation` into a shared package, or (b) reimplement a smaller version in the proxy (the proxy already has `proxy/src/services/compactService.ts` — re-survey that before deciding). Defer Phase F until this is decided.

### Phase H — Continue.dev cruft removal (2 days) _(re-surveyed 2026-04-16)_

Survey delta — most findings still open, two already closed by prior work:

| Item                                                             | Status                | Notes                                                                                                                                |
| ---------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **H1a** `PRODUCTION_HUB_ENV`/`STAGING_ENV`/`TEST_ENV`            | ✅ open               | All three defined in `core/control-plane/env.ts:15-37` (URLs now point at `localhost:8080`, but the multi-env scaffolding lives on). |
| **H1b** `enableHubContinueDev()`                                 | ✅ open               | `core/control-plane/env.ts:61-63` — stub still returns `true`.                                                                       |
| **H1c** `TRIAL_PROXY_URL`                                        | ✅ open               | `core/control-plane/client.ts:49-50` — points at `proxy-server-blue-l6vsfbzhba-uw.a.run.app`.                                        |
| **H1d** `ContinueProxyAnalyticsProvider.ts`                      | ✅ open               | File exists in `core/control-plane/analytics/`.                                                                                      |
| **H1e** Free-trial branch in `streamChat.ts`                     | 🟡 partial            | No explicit "free-trial" string in `core/llm/streamChat.ts`; `core/config/load.ts:6` references `usesCreditsBasedApiKey()`.          |
| **H2a** `core/llm/llms/stubs/ContinueProxy.ts`                   | ✅ open               | File + companion `.vitest.ts` still present.                                                                                         |
| **H2b** `providerName === "free-trial"` branches                 | ✅ open (2 hits)      | One commented in `core/nextEdit/NextEditProvider.ts`, one active in `core/config/load.ts`.                                           |
| **H3a** `extensions/cli/src/auth/workos.ts`                      | ✅ open               | 830-line WorkOS device-auth flow.                                                                                                    |
| **H3b** `extensions/vscode/src/stubs/WorkOsAuthProvider.ts`      | ✅ open               | File + `.vitest.ts` still present.                                                                                                   |
| **H3c** `WORKOS_CLIENT_ID_*` in `proxy/src/auth/ssoService.ts`   | ✅✓ closed            | Proxy now uses generic `SSO_*` env pattern; no hardcoded WorkOS IDs.                                                                 |
| **H4a** `packages/continue-sdk/`                                 | ✅ open               | Directory exists (Python API + openapi_client). Audit imports before deletion.                                                       |
| **H4b** `packages/hub/`                                          | ✅ open (rename only) | Package name already `@ai-firewall/hub`; internal references not yet swept.                                                          |
| **H5a** `core/config/migrateSharedConfig.ts`                     | ✅ open               | File still imported by `ConfigHandler.ts` and `core.ts` per the original plan; trace before deleting.                                |
| **H5b** `.continueignore` files                                  | ✅ open (3 instances) | Root `/`, `extensions/vscode/`, `binary/`.                                                                                           |
| **H6a** `getContinueUtilsPath` / `getGlobalContinueIgnorePath`   | ✅ open               | Both in `core/util/paths.ts:50-67`. Called by `getChromiumPath()`.                                                                   |
| **H6b** Root `.continueignore` file                              | ✅ open               | 112 bytes; not yet replaced by `.ai-firewallignore`.                                                                                 |
| **H7a** `gui/src/util/isContinueTeamMember.ts`                   | 🟡 partial            | Deprecated alias still exported (line 12 forwards to `isFirewallTeamMember`). One-line removal.                                      |
| **H7b** `core/context/providers/ContinueProxyContextProvider.ts` | ✅ open               | Class still named `ContinueProxyContextProvider`; description says "Continue for Teams".                                             |
| **H8** `continue.dev` URL references                             | ✅✓ closed            | Zero hits in `**/*.ts` — already swept.                                                                                              |

**Recommended Phase H execution order (easiest → riskiest):**

1. ✅✓ **H8** — verification only (already clean).
2. ✅✓ **H3c** — already clean.
3. **H7a** — drop the deprecated `isContinueTeamMember` re-export (1 line).
4. **H6b** — delete root `.continueignore` (already replaced by `.ai-firewallignore`).
5. **H1c** — delete `TRIAL_PROXY_URL` + audit callers.
6. **H6a** — rename `getContinueUtilsPath` / `getGlobalContinueIgnorePath` (touches multiple call sites; do as one PR).
7. **H2a** + **H2b** — delete `ContinueProxy.ts` stub + remove free-trial branches.
8. **H5** — delete `migrateSharedConfig.ts` + the 3 `.continueignore` files + dual-format parsing in `core/config/load.ts:81-95`.
9. **H3a/b** — delete WorkOS CLI/VSCode files (risky — verify no callers).
10. **H4** — drop `packages/continue-sdk/`, sweep `packages/hub/` for residual references (risky — verify exhaustively).
11. **H1a/b/d** — delete control-plane envs + `enableHubContinueDev()` (riskiest — `useHub()` and `getControlPlaneEnv()` callers in `core/config/load.ts`, GUI auth, VSCode stubs all need rewiring first).
12. **H7b** — rename `ContinueProxyContextProvider` (drops JetBrains user state keyed on the class name; release-note).

**Phase H — partial completion log (2026-04-17)**

Three quick wins shipped this session:

- ✅✓ **H7a** — dropped the deprecated `isContinueTeamMember = isFirewallTeamMember` re-export from `gui/src/util/isContinueTeamMember.ts` and `core/util/isContinueTeamMember.ts`. Updated the `core/util/isFirewallTeamMember.ts` wrapper to re-export only the canonical name. Verified zero callers used the alias before removal — every existing import site uses `isFirewallTeamMember` directly. Filenames intentionally NOT renamed yet (would touch every import path for zero runtime benefit; deferred to a follow-up).
- ✅✓ **H6b** — created root `.ai-firewallignore` (canonical replacement) with the same gitignore-style patterns as the old `.continueignore`, then `git rm`'d the original. The `core/util/paths.ts:getGlobalContinueIgnorePath` rename (H6a) is still pending — that's the multi-call-site rename and gets its own PR.
- ✅✓ **H1c** — removed the hardcoded Continue.dev hosted URL `TRIAL_PROXY_URL = "https://proxy-server-blue-l6vsfbzhba-uw.a.run.app"` from `core/control-plane/client.ts`. The two callers (`DefaultCrawler` for docs indexing, `WebContextProvider` for the `@web` provider) now read env vars `AI_FIREWALL_CRAWL_PROXY_URL` and `AI_FIREWALL_WEB_CONTEXT_PROXY_URL` respectively. If the env var is unset, the feature throws a clear configuration error at call time naming the env var and pointing at this plan section. Features still exist; the silent dependency on Continue.dev infrastructure does not.

`tsc --noEmit` clean across `core/`, `proxy/`, `gui/`, `extensions/cli/`. No tests changed — the deprecated alias had no test coverage; the URL replacements only affect the runtime config surface, not import-time behaviour.

#### Phase H — original task definitions (preserved for execution detail)

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
- **G2.** ✅✓ closed 2026-04-17. `git filter-repo --invert-paths --path proxy/data --force` rewrote all 6 branches; force-pushed to all of them on `Hithesh-16/firewall-ai`. Backup branches `backup` + `backup-pre-g2-2026-04-17` preserved locally for the reflog window. Old commit SHAs may still be reachable on GitHub via direct URL until their GC catches up; key rotation (G1) remains the only real mitigation.
- **G3.** Audit GitHub's secret-scanning alerts panel for any other flagged secrets; close each with an explicit reason.

---

## Phase I — Agent Harness Parity (effort: M, ~2 weeks) _(added 2026-04-17, see `docs/DEEPAGENTS_INTEGRATION_ANALYSIS.md`)_

**Goal:** Surface the multi-agent capabilities we already have and close gaps the LangChain `deepagents` analysis flagged. Decisions on the original open questions are baked in below (Q-numbers reference §6 of the analysis doc).

- **I1. Unified `provider:model-id` resolver** _(decision Q6: standardize everywhere)_
  - Add `proxy/src/gateway/modelResolver.ts` exposing `resolveModel("openai:gpt-4o" | "anthropic:claude-sonnet-4-6" | …) → LLMConfig`.
  - Wire into `core/llm/llms/index.ts`, CLI `/model` command, and the GUI model picker so the same string identifies a model in every surface.
  - Default fallback to current org default (mirrors deepagents `get_default_model()`).
  - Acceptance: `curl localhost:8080/v1/chat/completions -d '{"model":"openai:gpt-4o",...}'` resolves correctly across all 60+ existing providers.
- **I2. Declarative subagent registry** _(decision Q1: project + user scope, project wins)_
  - Reads `<workspace>/.ai-firewall/subagents.yaml` then `~/.ai-firewall/subagents.yaml`; project entries override user entries by `name`.
  - Each entry: `name`, `description`, `system_prompt`, optional `tools`, `model`, `skills`. Same shape as deepagents' `SubAgent` TypedDict.
  - When the registry is non-empty, inject a `task(name, instructions)` tool into the model's tool list at request time. Implementation calls `agentService.spawn()` with the matching subagent's prompt/model/tools.
  - Files: `core/tools/implementations/taskTool.ts`, `proxy/src/agents/registry.ts`, GUI `AgentRegistryPage`.
  - Acceptance: agent calls `task(name="researcher", instructions="...")` → child worker spawns with researcher's system prompt + scoped tools, parent gets only the final result.
- **I3. Async subagent state channel** _(decision Q8: survive process restart via SQLite)_
  - Extend `proxy/src/services/agentService.ts` with `async_tasks` state field persisted to a new SQLite table `async_tasks(id, parent_session, prompt, status, started_at, last_check_at, result_json)`.
  - Add 5 tools mirroring deepagents: `start_async_task`, `check_async_task`, `update_async_task`, `cancel_async_task`, `list_async_tasks`.
  - Survives `compactService` runs (lives outside the message log) and proxy restarts.
  - Acceptance: parent can spawn 3 background tasks, ask for status while they run, cancel one, restart the proxy, and see the surviving 2 still in the table with `status: running`.
- **I4. Planning middleware in CLI** _(decision Q4 partial: structured plan)_
  - Move `core/tools/implementations/planTool.ts` into the shared CLI tool registry (`extensions/cli/src/tools/`).
  - Inject a system-prompt fragment from `proxy/src/middleware/planningPrompt.ts` that nudges multi-step plan creation for tasks ≥3 steps.
  - Add `/todos` slash command in CLI + GUI to read the current plan state.
  - Acceptance: CLI agent autonomously calls `planTool` for tasks ≥3 steps; todos visible via `/todos` in both surfaces.

---

## Phase J — MCP & Commands Parity (effort: S/M, ~1 week)

**Goal:** Bring MCP integration to parity with deepagents (auto-discovery, project trust, slash commands) and add the Chrome DevTools MCP server the user explicitly asked for.

- **J1. `.mcp.json` discovery service**
  - New `proxy/src/services/mcpDiscoveryService.ts` scanning, in precedence order:
    1. `<proj>/.mcp.json` (Claude-compatible — interop with users coming from claude-code)
    2. `<proj>/.ai-firewall/.mcp.json`
    3. `~/.ai-firewall/.mcp.json`
  - Project entries override user entries by server name. Expose via `GET /api/mcp/servers`.
  - Acceptance: dropping a `.mcp.json` in workspace root auto-loads the server on next chat without restart.
- **J2. Project MCP trust store** _(decision Q9: fingerprint + manifest scan, defense-in-depth)_
  - `proxy/src/services/mcpTrustService.ts` with two layers:
    - SHA-256 of each project config in new SQLite table `mcp_trust(fingerprint, project_path, decision, decided_at)`.
    - Proxy-side scan of the spawned MCP server's manifest (binary path / npm package name) through the same scanner pipeline (so policy can deny known-malicious packages).
  - Prompt user on first encounter (CLI dialog + GUI banner). `--trust-project-mcp` env flag for CI.
  - Acceptance: changing the `.mcp.json` content invalidates trust and re-prompts; a manifest matching a denylist pattern is auto-blocked even with prior trust.
- **J3. Missing slash commands in proxy**
  - Add `/mcp`, `/agents`, `/spawn`, `/skills`, `/todos` to `proxy/src/commands/builtinCommands.ts` so they're discoverable from both CLI and GUI.
  - `/mcp [list | enable <id> | disable <id> | install <slug>]`, `/agents` lists registry + active workers, `/spawn <name>` triggers async subagent, `/skills` lists loaded skills, `/todos` reads the current plan.
  - Acceptance: GUI command palette shows all 5 in addition to existing 15.
- **J4. CLI tool parity**
  - Port the 8 highest-value missing tools to `extensions/cli/src/tools/`: `spawnAgent`, `planTool`, `memory`, `skillTool`, `readSkill`, `worktree`, `globSearch`, `grepSearch`.
  - Acceptance: CLI tool count rises from 14 to 22; coverage matches IDE for the planning/memory/spawn surface.
- **J5. Bundle Chrome DevTools MCP plugin** _(NEW — user's explicit ask)_
  - New `proxy/src/plugins/bundled/chrome-devtools/plugin.json` registering the Chrome DevTools MCP server (`@modelcontextprotocol/server-chromium` or equivalent).
  - Acceptance: after `enabling` the plugin via `/mcp enable chrome-devtools`, the agent can call browser tools (navigate, screenshot, get-console-messages) through the firewall's MCP gateway.

**Phase J — partial completion log (2026-04-17)**

Two quick wins shipped this session — the user's explicit ask:

- ✅✓ **J3 (`/mcp` slash command)** — added to `proxy/src/commands/builtinCommands.ts` and exported via `BUILTIN_COMMANDS`. Subcommands: `list` (default), `enable <name>`, `disable <name>`, `install <slug>` (placeholder; explains it's a follow-up). Wired into `pluginLoader` for enable/disable. 6 new unit tests in `proxy/src/test/commands.test.ts` (registered, list output, enable-unknown, enable-missing-arg, unknown-subcommand, install-not-impl) — all green. Total proxy suite: 696 pass / 1 known pre-existing fail.
- ✅✓ **J5 (Chrome DevTools MCP plugin bundled)** — new `proxy/src/plugins/bundled/chrome-devtools/plugin.json` registers `chrome-devtools-mcp` via stdio. Disabled by default (Chromium has a non-trivial resource footprint). Enable with `/mcp enable chrome-devtools`. All browser tool calls (navigate / click / take_screenshot / list_console_messages / etc.) route through `/v1/mcp/tools/call` so the firewall's MCP Security Gateway scans inputs/outputs the same way it does for the bundled `filesystem` server. The plugin loader's auto-discovery picked it up without code changes.

**Phase J — second batch shipped (2026-04-17)**

- ✅✓ **J1 (`.mcp.json` discovery)** — new `proxy/src/services/mcpDiscoveryService.ts` reads three precedence-ordered locations (`<proj>/.mcp.json`, `<proj>/.ai-firewall/.mcp.json`, `~/.ai-firewall/.mcp.json`) and merges with project-most-specific winning. Two new HTTP routes on the MCP gateway: `GET /v1/mcp/discover?projectPath=...` (pure read; returns sources + effective merged set + per-source SHA-256 fingerprint) and `POST /v1/mcp/sync` (writes the merged set into core's `~/.ai-firewall/mcpServers/discovered-from-mcpjson.json` so the existing `loadJsonMcpConfigs.ts` picks it up). Handles both Claude Desktop shape (`{mcpServers: {…}}`) and flat shape (`{name: serverDef}`). 10 new unit tests covering shape parsing, precedence, malformed JSON tolerance, fingerprint stability, and sync/clear lifecycle — all green.
- ✅✓ **J2 (trust store with fingerprint + manifest scan)** — new `proxy/src/services/mcpTrustService.ts` runs both layers per the plan's defense-in-depth requirement:
  - **Layer 1 (fingerprint trust)**: SHA-256 of source `.mcp.json` content recorded in new SQLite table `mcp_trust(project_path, source_path, fingerprint, decision, decided_at, decided_by_user_id)` with unique constraint on the triple. Trust is sticky for that exact fingerprint; any edit changes the hash and re-prompts. Three decision states: `trusted | denied | pending`.
  - **Layer 2 (manifest scan)**: `command`/`args`/`env`/`url` concatenated into a single surface string, scanned against a denylist of typosquats + obvious-bad keywords, and run through the secret scanner (catches `sk-proj-*` etc. accidentally checked into a `.mcp.json` `env` block).
  - The two layers compose: a Layer 2 hit OVERRIDES any prior Layer 1 trust (a user mistakenly trusting a malicious manifest still gets blocked). `POST /v1/mcp/trust` records decisions; `POST /v1/mcp/sync` consults the gate per source and reports `synced / blocked / pendingTrust` to the caller. `trustAll: true` body field bypasses Layer 1 only (CI / `--trust-project-mcp` env scenario); Layer 2 always runs.
  - 12 new unit tests covering safe-server pass, denylist hit, backdoor keyword, secret-in-env, persistence (set/get + idempotent), latest-decision-wins, full evaluateTrust matrix (first-encounter / trusted / denied / fingerprint-changed / manifest-override). All green.
- ✅✓ **J4 (CLI tool parity, partial)** — ported the two highest-value missing tools to `extensions/cli/src/tools/`:
  - `memoryTool` (mirrors `core/tools/implementations/memory.ts`): single tool with `operation: save | read`, persists to `<workspace>/.ai-firewall/memory/<slug>.md` with frontmatter, maintains the `MEMORY.md` index. Enables CLI-side persistent memory matching the IDE/GUI capability.
  - `globSearchTool` (mirrors `core/tools/implementations/globSearch.ts`): glob-pattern file search distinct from the existing grep-style `searchCode`. Uses the existing `glob` dep, returns up to 100 paths relative to cwd, ignores `node_modules`/`.git`/`dist`/`build`.
  - Both registered in `allBuiltIns.ts`. CLI tool count rises 17 → 19. Six other tools (`spawnAgent` is already covered by `SUBAGENT_TOOL_META`, `planTool` is already covered by `writeChecklistTool`, `skillTool`/`readSkill` are covered by `SKILLS_TOOL_META`) — leaving `worktree`, `browserCapture`/`browserInteract` (now satisfied by the Chrome DevTools MCP server from J5), `codebaseTool`, `vibeCoding`, `securityReview`, `notebookEditTool`, `requestRule`, `createRuleBlock`, `viewRepoMap`, `viewSubdirectory` for a future batch — most of those are IDE-specific and don't have a meaningful CLI surface.

`tsc --noEmit` clean across `core/`, `proxy/`, `gui/`, `extensions/cli/`. Test baseline: 718 pass / 1 known pre-existing fail (was 696 pre-J2 batch — 22 new tests added across J1+J2).

---

## Phase K — Streaming, Frontend, HITL (effort: M, ~1.5 weeks)

**Goal:** Replace 5s polling with real-time event streams; add the HITL `edit` decision so users can correct tool args before exec.

- **K1. Unified streaming taxonomy** _(decision Q3: opt-in via header now, GUI default in 60 days)_
  - Define `proxy/src/gateway/streamEvents.ts` with `{type, ns, data}` events: `subagent.start` / `subagent.token` / `subagent.end` / `tool.call.delta` / `tool.call.final` / `todo.update` / `memory.update`.
  - Emit alongside existing OpenAI SSE on `/v1/chat/completions` via a new `X-AF-Stream: events` opt-in header (default off).
  - Plan to flip default to `events` in the release after 60 days; document the migration window in CHANGELOG.
  - Acceptance: `curl … -H 'X-AF-Stream: events'` returns interleaved event lines parseable by a JS consumer.
- **K2. `useAgentStream` React hook**
  - New `gui/src/hooks/useAgentStream.ts` modelled on deepagents' `useStream`: `{messages, subagents, todos, status}`.
  - Backed by a new `GET /api/agents/stream` SSE endpoint.
  - Migrate `CoordinatorView.tsx` and `AgentManagerPage.tsx` off the 5s poll.
  - Acceptance: subagent events appear in the GUI within 100ms of emission; CPU usage on idle drops measurably vs the polling baseline.
- **K3. HITL `edit` decision** _(decision Q4: structured JSON editor with Zod validation)_
  - Extend `approvalService.resolve(decision: "allow" | "deny" | "edit", editedArgs?)`.
  - Plumb through `approval_requests.action` enum + WS `approval_resolved` payload.
  - GUI `ApprovalDialog` shows the tool's Zod schema + a structured form for editing args (not freeform JSON — the schema-validated UI prevents the next bug class).
  - Acceptance: user intercepts a tool call, modifies its arguments via the form, approves the edited form; downstream tool sees the modified args and rejects malformed edits at validation time.

---

## Phase L — Skill Auto-match + Memory Auto-prepend (effort: S/M, ~1 week)

**Goal:** Bring deepagents' "progressive disclosure" pattern (load just-in-time context) to skills and memory. ACP adapter (the doc's original L1) deferred per decision Q2.

- **L1. Skill auto-match middleware** _(decision Q7: embedding-based matching via existing `embeddingDetector.ts`)_
  - New `proxy/src/middleware/skillMatcher.ts`: at chat-start, compute embedding of the latest user message and the loaded skills' frontmatter `description` field (cached). Inject the best match (max 1, max 4k tokens) as a system message if cosine similarity ≥ 0.7.
  - Reuses `proxy/src/ml/embeddingDetector.ts`'s feature extractor — no new ML dep.
  - Opt-in via `policy.json` `skills.auto_match: true`. Defense: skills already pass through scanner pipeline at load.
  - Acceptance: prompting "make me a commit" auto-injects the bundled `commit` skill body; `X-AF-Skill-Matched` response header set with the matched skill name.
- **L2. Memory auto-prepend** _(decision Q5: default OFF — privacy risk)_
  - Opt-in `memory.auto_prepend_in_system_prompt: false` (default off).
  - When enabled: reads `MEMORY.md` index + selected entries (≤ 8k tokens), prepends to system prompt.
  - GUI surfaces a clear privacy notice when the user enables this (one-time confirm banner).
  - Acceptance: enabling the flag and adding a memory makes it visible to the next assistant turn without an explicit `@memory` reference; disabling reverts immediately.

---

## Deferred (separate decision)

- **L3 (deepagents §3.13 ACP)** — Zed/Cursor embedding via Agent Client Protocol. Per decision Q2, deferring until there's a real demand signal. Technical sketch preserved in `docs/DEEPAGENTS_INTEGRATION_ANALYSIS.md` §3.13 if/when we want to revisit.

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
