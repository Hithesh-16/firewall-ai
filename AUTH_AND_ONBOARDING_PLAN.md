# Unified Web-First Auth & Onboarding — Plan

**Status:** Draft, awaiting approval
**Scope:** `proxy/`, `web/`, `gui/`, `extensions/cli/`, `extensions/vscode/`, `extensions/intellij/`
**Owner:** (to be assigned)
**Related docs:** `CLAUDE.md`, `docs/developer/onboarding.mdx`, `docs/developer/rbac.mdx`, `docs/developer/teams.mdx`

---

## 1. Why this document exists

AI Firewall currently has **five independent auth systems** (see §2) that do not share tokens. A user who signs up through the `web/` dashboard cannot use the CLI without a second sign-in, cannot use VS Code at all because the VS Code extension still talks to the legacy WorkOS control plane, and has no onboarding flow to configure policies, teams, or providers.

The user's requirements for this change:

1. **One login surface.** All sign-in and sign-up flows must happen in the `web/` dashboard. The `gui/` webview login and onboarding pages must be removed.
2. **Shared token.** After a user signs in via `web/`, their token must automatically work for the CLI, VS Code, JetBrains, and any other local surface without a second login.
3. **Logout everywhere.** Every extension (`cn`, VS Code, JetBrains, `gui/`, `web/`) must expose a visible Sign Out command.
4. **Full onboarding wizard on first signup.** A new account must be walked through: workspace type (Individual / Team / Organization), policy configuration, team setup, provider BYOK, notification channels, and any feature already implemented in the proxy that benefits from first-time setup.
5. **Individual accounts get admin access automatically** and a simplified "solo" version of the wizard.

This document captures the full analysis of today's state, the target architecture, and a phased implementation plan.

---

## 2. Current state — what exists today (analysis)

Five surfaces, five token stores, three different auth backends. Nothing is shared.

### 2.1 Proxy — the only authority that understands AI Firewall

- **Token format:** `afw_<64-hex>` (generated in `proxy/src/auth/authService.ts:23`).
- **Storage:** SQLite `api_tokens` table, stored as a **SHA-256 hash** (raw token only exists in memory on issuance).
- **Validation:** `proxy/src/auth/authMiddleware.ts` `requireAuth` reads `Authorization: Bearer afw_...` and calls `validateApiToken()`.
- **Routes:**
  | Route | Purpose |
  | --- | --- |
  | `POST /api/auth/register` | Create user + return token |
  | `POST /api/auth/login` | Email/pw login, return token |
  | `GET /api/auth/me` | Current user (requires Bearer) |
  | `POST /api/auth/logout` | Revoke current token |
  | `POST /api/auth/logout/all` | Revoke all tokens for user |
  | `GET /api/auth/sso/config` | Which SSO providers are enabled |
  | `GET /api/auth/sso/login?provider=google` | Start OAuth |
  | `GET /api/auth/sso/callback` | Exchange code → HTML that `postMessage`s `{type:"afw-sso-token"}` to `window.opener` **and** pings `http://127.0.0.1:19836/?token=...` for CLI loopback |
- **Verdict:** canonical backend. Every other surface must funnel through here.

### 2.2 `web/` dashboard (port 5174)

- **Storage:** `localStorage["afw-token"]` via `web/src/utils/storage.ts`.
- **Flow:** email/pw or SSO popup → writes localStorage → Redux → `Bearer` on all requests via `apiClient`.
- **Logout:** clears localStorage + `POST /api/auth/logout` (not yet implemented in UI, but endpoint exists).
- **Verdict:** cleanest path. Becomes the canonical flow.

### 2.3 `gui/` IDE webview (port 5173)

- **Storage:** none of its own — talks to the extension host via `IdeMessenger`, host holds the token.
- **Has two duplicate pre-auth pages:**
  - `gui/src/pages/login/index.tsx` — **550 lines**, duplicates `web/`'s login form (email/pw, SSO buttons, feature cards).
  - `gui/src/pages/onboarding/index.tsx` — **368 lines**, 3-card wizard (Individual / Team / Organization) that creates an org via `POST /api/orgs` and assigns the user via `POST /api/orgs/:id/members`.
  - `gui/src/pages/setup/index.tsx` (7 lines) — stub that renders `OnboardingWizard` from `gui/src/components/onboarding/OnboardingWizard.tsx`.
- **Verdict:** biggest piece of duplication in the repo. To be removed.

### 2.4 CLI — `cn`

- **Storage:** `~/.ai-firewall/auth.json` (only surface that uses the filesystem for the token).
  - Helper: `extensions/cli/src/auth/workos.ts` `getAuthConfigPath`, `loadAuthConfig`, `saveAuthConfig`.
  - Shape today: `{ userId, userEmail, accessToken, refreshToken, expiresAt, organizationId, configUri, modelName }`.
- **Login paths:**
  - `AI_FIREWALL_API_KEY` env var shortcut.
  - `cn login` email/pw → `POST /api/auth/login` → writes file.
  - `cn login` SSO → `open()` browser to `/api/auth/sso/login?provider=google` and starts a **local HTTP server on port 19836**. The proxy's SSO callback HTML `fetch`es that loopback endpoint with the token.
  - Fallback: WorkOS device-authorization flow (legacy Continue code).
- **Logout:** `cn logout` → `POST /api/auth/logout` + clears file.
- **Verdict:** already uses the right backend; its file becomes the shared channel.

### 2.5 VS Code extension

- **Storage:** VS Code `SecretStorage` under `SESSIONS_SECRET_KEY`.
- **Provider:** `extensions/vscode/src/stubs/WorkOsAuthProvider.ts` — registers itself as a `vscode.authentication.AuthenticationProvider` but talks to **WorkOS directly**, not our proxy.
- **Refresh:** every 10 minutes; tokens expire in 15.
- **Verdict:** does **not** know about proxy `afw_*` tokens. The gui/ webview's login form sends credentials through the extension host, which calls WorkOS. Must be rewritten.

### 2.6 JetBrains plugin

- **Storage:** IntelliJ `PasswordSafe` (OS keychain).
- **Service:** `extensions/intellij/.../auth/ContinueAuthService.kt`.
- **Flow:** `startAuthFlow()` opens browser + shows a **manual dialog** to paste a token back. Refresh loop every 15 minutes. Talks to `api.ai-firewall.dev` / `control-plane-api-service-*.run.app`, **not** our local proxy.
- **Logout:** `signOut()` clears PasswordSafe entries.
- **Verdict:** worst UX of the lot. Must be rewritten.

### 2.7 Summary table

| Surface           | Token store                | Talks to                          | Has login UI               | Has logout                        | Shares with others              |
| ----------------- | -------------------------- | --------------------------------- | -------------------------- | --------------------------------- | ------------------------------- |
| `proxy/`          | SQLite `api_tokens`        | — (is the server)                 | n/a                        | n/a (revokes)                     | —                               |
| `web/`            | `localStorage`             | **Proxy**                         | ✅ polished                | ✅ (backend ready, no button yet) | ❌                              |
| `gui/`            | via IDE host               | WorkOS (host) / proxy (messenger) | ✅ 550-line duplicate      | ❌                                | ❌                              |
| `gui/` onboarding | n/a                        | **Proxy** `/api/orgs`             | ✅ 368-line wizard         | n/a                               | ❌                              |
| CLI               | `~/.ai-firewall/auth.json` | **Proxy** directly                | ✅ terminal + SSO + device | ✅                                | File only, nobody else reads it |
| VS Code           | `SecretStorage`            | **WorkOS** directly               | ❌ (no proxy login)        | ❌                                | ❌                              |
| JetBrains         | `PasswordSafe`             | **WorkOS** control plane          | ✅ paste-token dialog      | ✅ (local only)                   | ❌                              |

**Conclusion:** nothing is shared, three surfaces don't even talk to our proxy, and gui/ has massive duplicate login + onboarding code.

---

## 3. Target architecture

### 3.1 Principles

- **Proxy location is free.** Proxy runs on `localhost` (solo developer), on a shared server inside a team LAN, or on a cloud VM reachable over the public internet. The whole auth flow works identically in all three cases.
- **Single sign-in surface:** the `web/` dashboard served by the proxy at whatever URL the admin chose (`http://localhost:5174`, `https://firewall.team.internal`, `https://firewall.mycompany.com`, etc.). Every extension's "Sign In" command opens that URL and waits for a token to come back.
- **Two token-delivery channels (hybrid):**
  1. **Primary — per-extension callback.** After the user signs in on the web dashboard, the web page bounces the token back to the running extension via a channel local to the user's machine:
     - **CLI** — loopback HTTP server on `127.0.0.1:19836` (already implemented).
     - **VS Code** — native URI handler `vscode://aiFirewall/auth/callback?token=...` via `vscode.window.registerUriHandler`.
     - **JetBrains** — loopback HTTP server on `127.0.0.1:19837` (mirror of the CLI pattern).
       Each extension then stores the token in its own secret store (SecretStorage / PasswordSafe / `auth.json`).
  2. **Bonus — shared file, auto-enabled only when proxy is local.** If the proxy binds to loopback (`127.0.0.1` / `localhost`), the web login page additionally calls `POST /api/auth/handoff` which writes `~/.ai-firewall/auth.json` (chmod 600). Extensions that start _after_ a web login picks up this file automatically on first launch, giving the seamless "sign in once in web, all tools already work" experience without requiring the user to re-run "Sign In" in every extension.
     The two channels coexist cleanly: if a newly-launched extension finds a valid shared file it adopts the token; if not, it falls back to running its own per-extension callback flow on next "Sign In" click.
- **Proxy is the only auth backend.** All tokens are proxy `afw_*` tokens. WorkOS control-plane code in VS Code / JetBrains / CLI is **neutralized** in this pass (entry points replaced, bodies stubbed) and **deleted** in a follow-up once we're sure nothing else depends on it.
- **Admin-driven onboarding model.** An admin deploys the proxy, goes through the onboarding wizard in `web/` to configure policies and add provider keys (BYOK), then invites users by email. Invited users click a link, create a password (or use SSO), land on the dashboard with the org's policies already active — they don't configure anything themselves.
- **Invited users install the extensions and "it just works".** After the user has signed in on the web dashboard, the first time they run `cn login`, click "Sign In" in VS Code, or launch the JetBrains plugin, their extension opens the dashboard URL, receives a token via the callback channel, and joins the same org with the same policies. No per-user configuration beyond signing in.
- **Proxy URL is configurable per extension.** Each extension has a single setting (`aiFirewall.proxyUrl` in VS Code, `AI_FIREWALL_PROXY_URL` env var or `proxyUrl` in `~/.ai-firewall/config.yaml` for CLI, `aiFirewall.proxyUrl` in JetBrains settings) that points at the proxy's base URL. Default is `http://localhost:8080`. The web dashboard URL is derived from the proxy URL (same host, port 5174 in dev, same port as proxy in prod when dashboard is served from the proxy itself).
- **Logout is symmetric everywhere:** revoke on proxy (`POST /api/auth/logout`) + (if local) delete shared file (`DELETE /api/auth/handoff`) + clear per-surface cache (localStorage / SecretStorage / PasswordSafe / in-memory).
- **Onboarding is mandatory after first signup** and runs exclusively in `web/`. It configures workspace type, policies, providers, teams, and any other first-time state.
- **Individual users become their own org's admin automatically** — they still go through the wizard but team/RBAC steps are skipped.

### 3.2 Token storage per surface

Each surface stores the token in its native secret store. The **shared file** is an extra convenience, not the primary store.

| Surface          | Primary store                                        | Fallback / bonus                                                                             |
| ---------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `web/` dashboard | `localStorage["afw-token"]`                          | —                                                                                            |
| CLI (`cn`)       | `~/.ai-firewall/auth.json` (this IS the shared file) | —                                                                                            |
| VS Code          | `vscode.SecretStorage` under `aiFirewall.token`      | Read from `~/.ai-firewall/auth.json` on startup if SecretStorage is empty and file is recent |
| JetBrains        | `PasswordSafe` under `AiFirewallAccessToken`         | Read from `~/.ai-firewall/auth.json` on startup if PasswordSafe is empty and file is recent  |

**Shared file format** (written by CLI always, by VS Code / JetBrains after sign-in, by the proxy via handoff endpoint when proxy is local):

Path: `process.env.AI_FIREWALL_GLOBAL_DIR || ~/.ai-firewall/auth.json`
Permissions: `0600` (owner read/write only)

```json
{
  "version": 1,
  "proxyUrl": "http://localhost:8080",
  "accessToken": "afw_abc123...",
  "user": {
    "id": 42,
    "email": "jane@example.com",
    "name": "Jane Doe",
    "role": "developer",
    "orgId": 1
  },
  "expiresAt": 1762099999000,
  "savedAt": 1762013599000,
  "savedBy": "web" | "cli" | "vscode" | "jetbrains",
  "onboardingComplete": true
}
```

The `proxyUrl` field is new and carries the address the token is valid for. Extensions compare it with their own configured `proxyUrl` — if they don't match, the shared file is ignored (it's for a different proxy). This prevents a stale token from a demo proxy from polluting a production login.

Backward compatibility: CLI's current field names are a subset of this. The shared loader does alias-resolution on read, so old CLI installs keep working.

**Security notes:**

- Shared file writes via the handoff endpoint are only enabled when the proxy binds to loopback (`127.0.0.1` / `::1`). Remote-proxy deployments refuse the handoff endpoints — tokens stay in each extension's own secret store.
- `chmod 600` on the shared file. Documented in `SECURITY.md` as a bearer-token file.
- Tokens stored raw on the client side (the proxy's SHA-256 hash is for _server-side_ storage; clients always hold the raw token).
- Token revocation (logout) is immediate on the server because the proxy revokes by `token.id`. Every extension re-validates with `GET /api/auth/me` on startup and clears its cache on 401.

### 3.3 Per-extension callback channels

After web sign-in succeeds, the web page has the token in memory. It needs to hand it off to whichever extension asked for sign-in. Each extension registers itself before launching the browser so the web page knows where to deliver the token.

**CLI — loopback HTTP (existing, keep as-is)**

- `cn login` starts a server on `127.0.0.1:19836`
- Launches browser to `${proxyUrl}/web-login-start?return=cli&port=19836`
- Web page, on successful sign-in, does `fetch('http://127.0.0.1:19836/?token=${token}')`
- Server receives, `cn` writes `~/.ai-firewall/auth.json`, shuts down server, prints "Signed in as X"

**VS Code — native URI handler (new)**

- Extension registers a URI handler at activation: `vscode.window.registerUriHandler(handler)` for scheme `vscode:` and path `/aiFirewall/auth/callback`
- "Sign In" command launches browser to `${proxyUrl}/web-login-start?return=vscode&callback=vscode%3A%2F%2FYourPublisher.aiFirewall%2FauthCallback`
- Web page, on successful sign-in, does `window.location.replace('vscode://YourPublisher.aiFirewall/authCallback?token=...')`
- OS routes the `vscode://` URL to VS Code, which dispatches it to the extension's URI handler
- Extension stores the token in `SecretStorage` and emits an `onDidChangeAuth` event for the webview

**JetBrains — loopback HTTP (new, mirror of CLI)**

- "Sign In" action starts a server on `127.0.0.1:19837`
- Launches browser to `${proxyUrl}/web-login-start?return=jetbrains&port=19837`
- Web page `fetch`es `http://127.0.0.1:19837/?token=...`
- Server receives, plugin stores in `PasswordSafe`, shuts down server, shows a notification
- Optionally also register IntelliJ `ApplicationUrlHandler` for `jetbrains://ai-firewall/auth/...` as a secondary path (nice to have, not required)

**`/web-login-start`** is a new public proxy route that accepts `return` and `callback` or `port` query parameters and redirects to the web dashboard's `/login` page with those values preserved in the URL. This gives us a single canonical "start the web login" entrypoint that all extensions target, regardless of whether they know the exact dashboard URL.

**Why three different mechanisms?** VS Code has a first-class URI handler API that's more robust than loopback (survives reboots, no port collisions, works with OS URL routing). JetBrains's URL handler support is newer and less reliable, so we fall back to loopback. CLI can't register a URL scheme (it's a terminal program) so it uses loopback too. All three deliver the same end result: the token ends up in the extension's secret store.

### 3.4 Proxy routes — new endpoints

`proxy/src/routes/authHandoff.route.ts` (local-only, loopback gated):

| Method   | Path                       | Auth                       | Purpose                                                                                                                                                                                                                           |
| -------- | -------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST`   | `/api/auth/handoff`        | `requireAuth`              | Write the current Bearer token + user + orgId + `proxyUrl` into `~/.ai-firewall/auth.json`. Loopback-only. Body: `{ source: "web" \| "cli" \| "vscode" \| "jetbrains" }`. Refuses with 400 if the proxy is not bound to loopback. |
| `GET`    | `/api/auth/handoff/status` | public (but loopback-only) | Return `{ present, email, savedAt, source, proxyUrl }`. Used by extensions to poll while waiting for the user to finish web login.                                                                                                |
| `DELETE` | `/api/auth/handoff`        | `requireAuth`              | Delete the file. Called during every Sign Out.                                                                                                                                                                                    |

Enabled by proxy env flag `AI_FIREWALL_LOCAL_HANDOFF=1` (default on when proxy is bound to localhost, off otherwise).

`proxy/src/routes/webLoginBridge.route.ts` (works for both local and remote proxies):

| Method | Path               | Auth   | Purpose                                                                                                                                                                                                                                                                                                                |
| ------ | ------------------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/web-login-start` | public | Accepts `return=cli\|vscode\|jetbrains`, `callback=<vscode-uri>`, `port=<loopback>` query params. Stashes them in a short-lived signed cookie and 302-redirects to the web dashboard at `/login?from=extension`. The web dashboard reads the cookie after successful login and bounces the token to the right channel. |

This single entrypoint is what every extension targets. It lets the proxy control the redirect logic centrally (e.g. add new callback types without touching every client).

### 3.5 Shared auth packages

- **`packages/shared-auth/`** — new Node package, zero runtime deps. Exports:

  ```ts
  // File helpers (local-proxy bonus channel)
  getAuthFilePath(): string
  loadAuthFile(): SharedAuthFile | null
  saveAuthFile(auth: SharedAuthFile): void    // writes 0600
  deleteAuthFile(): void
  isAuthValid(auth: SharedAuthFile | null): boolean
  watchAuthFile(cb: (auth: SharedAuthFile | null) => void): () => void

  // Callback channel helpers (primary channel)
  startLoopbackTokenServer(port: number): Promise<{ token: string; stop(): void }>
  buildWebLoginUrl(opts: {
    proxyUrl: string
    return: "cli" | "vscode" | "jetbrains"
    callback?: string  // vscode://... URI for VS Code
    port?: number      // loopback port for CLI/JetBrains
  }): string
  ```

  Consumed by the CLI and the VS Code extension host.

- **Kotlin port** — `extensions/intellij/.../auth/SharedAuthStore.kt` with the same API, uses `java.nio.file.WatchService` for file watching and a `com.sun.net.httpserver.HttpServer` for the loopback token receiver.

### 3.6 Web-first login flow (happy path)

**Case A — Admin (first user), local proxy, browser only**

```
User opens http://localhost:5174/ (the web dashboard served by the local proxy)
    │
    ▼
Clicks "Sign Up" → fills form → POST /api/auth/register
    │
    ▼
web/ stores token in localStorage
    │
    ▼
web/ AppShell sees user.onboardingComplete === false → redirects to /onboarding
    │
    ▼
User walks through the 7-step wizard (§4)
    │
    ▼
Step 7 → POST /api/users/me/onboarding/complete → flips flag to true
         + POST /api/auth/handoff (proxy is local, so this succeeds)
         → writes ~/.ai-firewall/auth.json
    │
    ▼
Redirected to /dashboard (chat)
```

**Case B — Invited user, extension-driven sign-in, remote proxy**

```
Invited user receives email: "Jane invited you to AI Firewall. Click here."
    │
    ▼
Email link opens https://firewall.acme.com/invite/<signedToken> in browser
    │
    ▼
Proxy validates invite token, prompts for password / SSO
    │
    ▼
After sign-in, user is on /dashboard of the admin's web dashboard
    │
    ▼
User installs VS Code extension, sets aiFirewall.proxyUrl to https://firewall.acme.com
    │
    ▼
User runs "AI Firewall: Sign In" command
    │
    ▼
VS Code opens https://firewall.acme.com/web-login-start?return=vscode&callback=vscode://publisher.aiFirewall/authCallback
    │
    ▼
Proxy redirects to /login?from=extension (with callback stashed in signed cookie)
    │
    ▼
web/ LoginPage sees from=extension, user is already signed in → calls GET /api/auth/me to confirm
    │
    ▼
web/ reads the stashed cookie → location.replace("vscode://publisher.aiFirewall/authCallback?token=...")
    │
    ▼
OS routes the vscode:// URL to VS Code → URI handler fires → extension stores token in SecretStorage
    │
    ▼
Extension webview refreshes, shows chat. User is done.
```

**Case C — Invited user, CLI, remote proxy**

```
User runs: cn login --proxy https://firewall.acme.com
    │
    ▼
CLI starts loopback server on 127.0.0.1:19836
    │
    ▼
CLI opens browser to https://firewall.acme.com/web-login-start?return=cli&port=19836
    │
    ▼
Proxy redirects to /login?from=extension
    │
    ▼
User signs in with email/pw or SSO (already has an account from invite)
    │
    ▼
web/ reads stashed cookie → fetch('http://127.0.0.1:19836/?token=...')
    │
    ▼
CLI loopback server receives, writes ~/.ai-firewall/auth.json, shuts down
    │
    ▼
CLI prints "✓ Signed in as jane@acme.com" and starts chat
```

**Case D — Invited user, local proxy — the magic "one sign-in for all tools" case**

```
User signs in through the web dashboard (Case A or B above)
    │
    ▼
Proxy handoff endpoint writes ~/.ai-firewall/auth.json (chmod 600)
    │
    ▼
User runs `cn` in terminal. CLI sees the fresh file, uses it directly, no browser.
    │
    ▼
User opens VS Code. Extension activates, sees SecretStorage empty BUT the shared file has a valid token.
Extension reads the file, stores in SecretStorage, user is already signed in.
    │
    ▼
User opens JetBrains. Same story — PasswordSafe empty, shared file valid, adopted silently.
```

### 3.7 Web-first logout flow

Every Sign Out button in every surface executes the same three steps:

1. `POST /api/auth/logout` (proxy revokes the row in `api_tokens`)
2. `DELETE /api/auth/handoff` (proxy deletes `~/.ai-firewall/auth.json`) — **only if the proxy is local**; no-op for remote proxies
3. Local cleanup (clear localStorage / SecretStorage / PasswordSafe / in-memory cache)

**Propagation behaviour:**

- **Local proxy:** any Sign Out performed on one surface is picked up by the others because the file-watcher fires with `null` and every extension re-renders to "Sign In" state.
- **Remote proxy:** each surface must Sign Out independently. The proxy still revokes the server-side token row, so any API call from another surface will get a 401 and that surface will prompt for re-login on next action. We could optionally broadcast a "token revoked" websocket event to attached extensions as a future enhancement.

---

## 4. Onboarding wizard (runs exclusively in `web/`)

### 4.1 Trigger & gating

- **Trigger:** after `POST /api/auth/register`, or on the first login of a user whose `users.onboarding_complete` is `false`.
- **New column:** `users.onboarding_complete BOOLEAN NOT NULL DEFAULT 0` (migration added alongside the handoff route).
- **Gate:** `web/` `AppShell` checks `onboardingComplete` on the user returned by `/api/auth/me`. If `false`, redirects to `/onboarding` and blocks every other route.
- **Can't skip:** the final "Finish" step is the only thing that sets `onboarding_complete = true` via `POST /api/users/me/onboarding/complete`.

### 4.2 The 7 steps

> **Note:** individual users see **steps 1, 2, 4, 5, 6, 7**. Team/Org users see all 7. Each step has a progress bar "Step N of M" and a "Back" button. Data is persisted after every step (so a browser refresh doesn't lose progress).

#### Step 1 — Workspace type

The same card layout as today's gui/ onboarding but rebuilt in `web/`:

| Option              | Who it's for                          | Admin?                                    | Extra steps unlocked                         |
| ------------------- | ------------------------------------- | ----------------------------------------- | -------------------------------------------- |
| 👤 **Individual**   | Solo developer                        | ✅ auto-admin of a personal org           | Skips team + member invites                  |
| 👥 **Team**         | Small team sharing one workspace      | First user is admin, can invite           | Invite members + role picker                 |
| 🏢 **Organization** | Multiple teams with separate policies | First user is org admin, can create teams | Create teams + role picker + per-team policy |

On "Continue":

- `POST /api/orgs` with `{ name, slug, type }` (if not already created)
- `POST /api/orgs/:id/members` with `userId = me, role = admin` (always)
- If type is Individual, `name = "<user.name>'s Workspace"`, `slug = "personal-<random>"`, and steps 3 (Teams) is skipped.

Uses existing endpoints in `proxy/src/routes/org.route.ts`.

#### Step 2 — Profile & organization details

- User's display name (pre-filled from signup)
- Avatar initials (or upload)
- Organization name (editable; pre-filled from Step 1)
- Organization slug (editable; pre-filled; URL-safe regex)
- Industry (free-text, optional — stored for analytics only)
- Timezone (pre-filled from browser)

Writes via `PUT /api/users/me` and `PUT /api/orgs/:id`.

#### Step 3 — Teams & members (skipped for Individual)

Two sub-panels:

**a) Create teams**

- Name + slug for each team, add/remove rows
- Endpoint: `POST /api/teams` (`proxy/src/routes/team.route.ts`)

**b) Invite members**

- Email + role per invite (admin / security_lead / developer / auditor — the four roles already in the proxy's RBAC schema)
- Bulk-paste email support
- Endpoint: `POST /api/orgs/:id/invites` (if missing, added as part of this work)

The step is skippable — users can add teams and members later from Settings.

#### Step 4 — Policy configuration

The most important step. Configures `policy.json` for the new org. The wizard shows four tabs:

**a) Scanner thresholds**

Interactive sliders for each scanner type:

| Scanner           | Default Block | Default Redact | Default Allow |
| ----------------- | ------------- | -------------- | ------------- |
| Secrets           | 70            | 40             | 0             |
| PII               | 60            | 30             | 0             |
| Prompt injection  | 80            | 50             | 0             |
| Entropy           | 75            | 45             | 0             |
| Unicode anomalies | 70            | 40             | 0             |

Each scanner can be toggled on/off. Help text explains what each catches with an example.

**b) Response scanning**

A single toggle: "Scan LLM responses for leaked secrets/PII?" (maps to `response_scanning.enabled` in policy.json). Off by default — streams aren't intercepted.

**c) MCP gateway**

A toggle: "Scan MCP tool inputs/outputs?" (default on). A secondary toggle for "Audit every tool call" (default on).

**d) Cost-aware routing**

Off by default. If enabled, asks for a per-request USD cap.

Everything on this step writes to the org's row in the `policies` table via `POST /api/policy` (extends existing `proxy/src/routes/policy.route.ts`).

#### Step 5 — Providers (BYOK)

A "Add your LLM providers" step. Lists all providers the user's org can use:

| Provider                 | Required fields                             | Vault          |
| ------------------------ | ------------------------------------------- | -------------- |
| OpenAI                   | API key                                     | ✅ AES-256-GCM |
| Anthropic                | API key                                     | ✅             |
| Google Gemini            | API key                                     | ✅             |
| Mistral                  | API key                                     | ✅             |
| Azure OpenAI             | API key + endpoint + deployment             | ✅             |
| Ollama                   | Base URL (default `http://localhost:11434`) | n/a (local)    |
| Custom OpenAI-compatible | Base URL + API key + model list             | ✅             |

At least one provider must be added before "Continue" is enabled. Writes via `POST /api/providers` (already exists in `proxy/src/routes/provider.route.ts` with vault encryption).

A "Skip and add later" link is shown but warns: _"You won't be able to chat until you add at least one model."_

#### Step 6 — Notifications & integrations (optional)

Configure notification channels for approval workflows and security alerts:

- **Webhook URL** — generic POST
- **Slack incoming webhook**
- **Email** (proxy must have SMTP configured; if not, this card is greyed out)
- **Web Push** — browser subscription

Each channel is optional. Writes via `POST /api/notifications/channels`.

#### Step 7 — Review & finish

A summary card showing:

- ✅ Workspace: Individual / Team / Organization
- ✅ Org name + slug
- ✅ Policies: N scanners enabled, thresholds set
- ✅ Providers: M added (OpenAI, Anthropic, …)
- ✅ Teams: K created (if applicable)
- ✅ Members invited: L (if applicable)
- ✅ Notification channels: N configured

A "Finish" button which:

1. `POST /api/users/me/onboarding/complete` → flips `users.onboarding_complete = true`
2. Redirects to `/dashboard` (the chat)
3. Fires a `POST /api/auth/handoff` call so the new token + freshly-configured org are written to the shared file for extensions

### 4.3 State management

- Onboarding state lives in a dedicated Redux slice `web/src/store/slices/onboardingSlice.ts`.
- Each step writes to the server immediately on "Continue" so a browser refresh preserves progress (restored from server state on reload).
- A new route `/onboarding/step/:n` is used so users can bookmark where they left off.
- If the user backs out to `/` mid-onboarding, the gate redirects them back to `/onboarding/step/:n`.

### 4.4 Can onboarding be re-run?

Yes. After the first pass, a "Re-run setup" action is added under `Settings → Workspace → Re-run onboarding wizard`. It clears `users.onboarding_complete` but does **not** delete the org, policies, or providers — the wizard repopulates its fields from the current state.

### 4.5 Visual design

- Same `AnimatedBackdrop` + `BrandShield` used on the landing page and login page (already built last turn).
- Each step is a glass card, centered, max-width 640 px.
- Progress indicator at the top (dots or bar) showing "N of 7".
- Emerald→cyan gradient primary button.
- "Back" is a ghost button to the left; "Continue" is the gradient button to the right.
- Smooth cross-fade transition between steps via `afw-animate-fade-up`.

---

## 5. Phases & deliverables

### Phase 0 — Shared auth package (groundwork)

- [ ] New package `packages/shared-auth/` with `loadAuth` / `saveAuth` / `deleteAuth` / `watchAuthFile` / `isAuthValid`
- [ ] Kotlin port `extensions/intellij/.../auth/SharedAuthStore.kt`
- [ ] Unit tests for read, write, watch, invalid formats, permission errors

### Phase 1 — Proxy handoff endpoints

- [ ] `proxy/src/routes/authHandoff.route.ts`
- [ ] Loopback-only gate
- [ ] `AI_FIREWALL_LOCAL_HANDOFF` env flag
- [ ] Register in `proxy/src/server.ts`
- [ ] Unit + integration tests (local handoff writes file, remote request refused)

### Phase 2 — Schema migration & onboarding endpoints

- [ ] Migration: add `users.onboarding_complete BOOLEAN DEFAULT 0`
- [ ] `POST /api/users/me/onboarding/complete`
- [ ] `PUT /api/users/me` (profile update) if missing
- [ ] Make sure `POST /api/orgs`, `POST /api/teams`, `POST /api/orgs/:id/members`, `POST /api/orgs/:id/invites`, `POST /api/providers`, `POST /api/policy`, `POST /api/notifications/channels` all return the full updated record (needed by the wizard for the review step)

### Phase 3 — web/: sign-in integration

- [ ] `web/src/pages/auth/LoginPage.tsx`: call `POST /api/auth/handoff` after any successful sign-in
- [ ] `web/src/components/layout/AppShell.tsx`: check `onboardingComplete` on user, redirect to `/onboarding/step/1` if false
- [ ] `web/src/components/layout/TopBar.tsx`: add Sign Out button that does the 3-step logout sequence
- [ ] Toast on successful handoff: "Signed in everywhere — token shared with VS Code, CLI, JetBrains"

### Phase 4 — web/: onboarding wizard

- [ ] `web/src/pages/onboarding/OnboardingRoot.tsx` — parent component with gate and step router
- [ ] `web/src/pages/onboarding/Step1WorkspaceType.tsx`
- [ ] `web/src/pages/onboarding/Step2Profile.tsx`
- [ ] `web/src/pages/onboarding/Step3Teams.tsx`
- [ ] `web/src/pages/onboarding/Step4Policy.tsx`
- [ ] `web/src/pages/onboarding/Step5Providers.tsx`
- [ ] `web/src/pages/onboarding/Step6Notifications.tsx`
- [ ] `web/src/pages/onboarding/Step7Review.tsx`
- [ ] `web/src/store/slices/onboardingSlice.ts`
- [ ] Add routes in `web/src/App.tsx` (`/onboarding/step/:n`)
- [ ] Reuse `AnimatedBackdrop` + `BrandShield` for consistent look

### Phase 5 — CLI: web-first login via loopback callback

- [ ] `extensions/cli/src/commands/login.ts`: remove device-auth, remove the interactive email/pw prompt, remove the WorkOS fallback. Replace with:
  1. Start loopback server on 127.0.0.1:19836 using `startLoopbackTokenServer()` from `packages/shared-auth`
  2. Build URL via `buildWebLoginUrl({ proxyUrl, return: "cli", port: 19836 })` → `${proxyUrl}/web-login-start?return=cli&port=19836`
  3. Open in browser via `open` package
  4. Await token from loopback
  5. Write `~/.ai-firewall/auth.json` via `saveAuthFile()`
  6. Print "✓ Signed in as <email>"
- [ ] `extensions/cli/src/commands/login.ts`: add `--proxy <url>` flag that temporarily overrides the proxy URL (useful for first-time sign-in when the user hasn't configured `aiFirewall.proxyUrl` yet)
- [ ] `extensions/cli/src/commands/logout.ts`: 3-step logout (proxy revoke + delete handoff if local + delete local file)
- [ ] `extensions/cli/src/auth/workos.ts`: split — keep filesystem helpers (now importing from `@ai-firewall/shared-auth`), delete WorkOS HTTP code
- [ ] `extensions/cli/src/onboarding.ts`: replace interactive terminal menu with a one-liner "Not signed in. Run `cn login`."
- [ ] Update `extensions/cli/README.md`

### Phase 6 — VS Code: URI handler + commands

- [ ] `extensions/vscode/src/auth/aiFirewallAuthService.ts` (new) — holds in-memory token, reads/writes `SecretStorage` under `aiFirewall.token`, exposes `onDidChangeAuth` event, reads the shared file once on startup as a fallback when `SecretStorage` is empty
- [ ] `extensions/vscode/src/auth/aiFirewallUriHandler.ts` (new) — implements `vscode.UriHandler`, path `/authCallback`, extracts `token` query param, validates against the proxy via `GET /api/auth/me`, calls `aiFirewallAuthService.setToken`
- [ ] `extensions/vscode/src/extension/VsCodeExtension.ts`: register URI handler on activate: `vscode.window.registerUriHandler(aiFirewallUriHandler)`, instantiate `AiFirewallAuthService` and call `init()` (reads `SecretStorage` + optionally adopts shared file)
- [ ] `extensions/vscode/src/commands.ts`: add commands:
  - `aiFirewall.login` — builds `${proxyUrl}/web-login-start?return=vscode&callback=vscode://${publisher}.${name}/authCallback` and opens via `vscode.env.openExternal`
  - `aiFirewall.logout` — 3-step sequence + `aiFirewallAuthService.clear()`
- [ ] `extensions/vscode/package.json`: register both commands + titles + categories (`AI Firewall: Sign In`, `AI Firewall: Sign Out`). Also add a new setting `aiFirewall.proxyUrl` (default `http://localhost:8080`) alongside the existing `aiFirewall.webDashboardUrl`
- [ ] `extensions/vscode/src/extension/VsCodeMessenger.ts`: handle `aiFirewall.getAuthState`, `aiFirewall.login`, `aiFirewall.logout` messages from gui/ webview
- [ ] Neutralize `extensions/vscode/src/stubs/WorkOsAuthProvider.ts` — remove WorkOS HTTP calls. Keep the `AuthenticationProvider` shell registration so any downstream code calling `vscode.authentication.getSession(AUTH_TYPE)` gets a session synthesized from `AiFirewallAuthService` instead of WorkOS

### Phase 7 — JetBrains: loopback callback + Kotlin port

- [ ] `extensions/intellij/.../auth/SharedAuthStore.kt` (new) — reads/writes `~/.ai-firewall/auth.json`, same format as shared-auth Node package
- [ ] `extensions/intellij/.../auth/SharedAuthWatcher.kt` (new, `java.nio.file.WatchService`)
- [ ] `extensions/intellij/.../auth/LoopbackTokenServer.kt` (new, `com.sun.net.httpserver.HttpServer` on port 19837)
- [ ] `extensions/intellij/.../auth/ContinueAuthService.kt`: rewrite
  - `startAuthFlow(project)` → start LoopbackTokenServer, open `${proxyUrl}/web-login-start?return=jetbrains&port=19837` via `BrowserUtil.open`, await token, store in PasswordSafe, shut down server
  - `signOut()` → 3-step
  - On init, read from `PasswordSafe`; if empty, try `SharedAuthStore.load()` and adopt if valid
- [ ] `extensions/intellij/.../actions/AiFirewallLoginAction.kt` (new) → calls `ContinueAuthService.startAuthFlow`
- [ ] `extensions/intellij/.../actions/AiFirewallLogoutAction.kt` (new) → calls `ContinueAuthService.signOut`
- [ ] `extensions/intellij/src/main/resources/META-INF/plugin.xml`: register both actions under `<actions>` in the menu + add new setting `aiFirewall.proxyUrl`
- [ ] **Delete** the old `ContinueAuthDialog.kt` paste-token dialog — replaced by the loopback flow
- [ ] Migration: if `PasswordSafe` has an old WorkOS token (detectable by format) and `SharedAuthStore` is empty, show a one-time notification "Please sign in again — we switched to web-based login"

### Phase 8 — gui/: remove onboarding + login

- [ ] **Delete** `gui/src/pages/onboarding/index.tsx`
- [ ] **Delete** `gui/src/pages/setup/index.tsx`
- [ ] **Delete** `gui/src/components/onboarding/` (entire folder)
- [ ] **Rewrite** `gui/src/pages/login/index.tsx` into an ~80-line redirect screen: "Sign in via the web dashboard" + "Open Web Dashboard" button + waiting spinner
- [ ] Add top-level auth gate in `gui/src/App.tsx`: poll extension host messenger for auth state, render login screen if unauthed
- [ ] Remove `/onboarding` and `/setup` routes from `gui/src/App.tsx`
- [ ] Add a Sign Out item in the chat header menu that messages the host to run `aiFirewall.logout`

### Phase 9 — Documentation & migration notes

- [ ] Update `CLAUDE.md` architecture section
- [ ] Update `docs/developer/onboarding.mdx` to describe the new wizard
- [ ] New `docs/developer/shared-auth.mdx` describing the file format, security model, env flags
- [ ] Migration note in `CHANGELOG.md`: _"First release with unified web-based auth. Existing VS Code / JetBrains keychain sessions will be invalidated — users must sign in again via the web dashboard."_
- [ ] Update `SECURITY.md` with the chmod 600 file caveat

### Phase 10 — Cleanup (follow-up)

- [ ] Delete dead WorkOS HTTP code in `workos.ts` (CLI) once Phase 5 is stable
- [ ] Delete `stubs/WorkOsAuthProvider.ts` device-auth code once Phase 6 is stable
- [ ] Delete `ContinueAuthDialog.kt` once Phase 7 is stable

---

## 6. File-change summary (estimated)

| Area                    | New                                              | Modified                                                                                                 | Deleted                                                           |
| ----------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `packages/shared-auth/` | +1 package, ~4 files                             | 0                                                                                                        | 0                                                                 |
| `proxy/`                | 1 route file, 1 migration                        | 2 (`server.ts`, existing routes for return shape)                                                        | 0                                                                 |
| `web/`                  | 8 wizard files + slice + animated backdrop reuse | `App.tsx`, `AppShell.tsx`, `LoginPage.tsx`, `TopBar.tsx`, `routes.ts`                                    | 0                                                                 |
| `gui/`                  | 0                                                | `App.tsx`, `pages/login/index.tsx`                                                                       | 3 (`pages/onboarding/`, `pages/setup/`, `components/onboarding/`) |
| `extensions/cli/`       | 0                                                | `commands/login.ts`, `commands/logout.ts`, `auth/workos.ts`, `onboarding.ts`, README                     | 0                                                                 |
| `extensions/vscode/`    | 2 (`sharedAuthService.ts`, alias file)           | `commands.ts`, `package.json`, `VsCodeExtension.ts`, `VsCodeMessenger.ts`, `stubs/WorkOsAuthProvider.ts` | 0 initial, dead code later                                        |
| `extensions/intellij/`  | 4 Kotlin files                                   | `ContinueAuthService.kt`, `plugin.xml`                                                                   | 0 initial, dialog later                                           |
| `docs/`                 | 1 new MDX + this plan                            | `CLAUDE.md`, `onboarding.mdx`, `SECURITY.md`, `CHANGELOG.md`                                             | 0                                                                 |

**Totals:** ~20 new files, ~18 modified files, ~3 deleted files (plus follow-up deletes in Phase 10).

---

## 7. Risks & open questions

1. **Remote proxy deployments — resolved.** The hybrid design (per-extension callback primary, shared file bonus) handles both cases cleanly. No second design needed.
2. **File watching cross-platform quirks.** `fs.watch` on macOS can miss rapid writes; the Kotlin `WatchService` has its own latency. Shared-auth watcher will debounce + fall back to a 2-second `stat` poll. Only matters for the local-proxy bonus channel; per-extension callback doesn't rely on file watching.
3. **VS Code URI handler publisher name.** `vscode://<publisher>.<name>/authCallback` needs the exact publisher ID from `package.json`. Must be hardcoded in both the extension URI handler registration and in the `/web-login-start` redirect builder. Add a server-side validation of the callback scheme to prevent open-redirect attacks (whitelist `vscode://` + known publishers).
4. **Loopback port collisions.** If two copies of the CLI run `cn login` at once, or VS Code and CLI both want port 19836, one fails. Mitigation: port range 19836–19846, pick the first available, pass the chosen port in the URL.
5. **JetBrains existing keychain tokens.** Do not silently migrate WorkOS tokens — that would defeat the "all login via web" rule. Require fresh sign-in with a one-time toast.
6. **Headless CI.** `cn login` opens a browser. For CI, fallback is the `AI_FIREWALL_API_KEY` env var (already supported). Document this clearly in `extensions/cli/README.md`.
7. **Onboarding wizard scope creep.** Step 4 (Policy) and Step 5 (Providers) could each become a big screen. Keep them focused: sensible defaults, advanced options collapsed, link to the full Settings page for anything not covered.
8. **Skip-ability.** Steps 3 (Teams), 6 (Notifications) are skippable. Step 1, 2, 4, 5, 7 are not. Step 5 can be deferred but the user gets a banner on the dashboard until at least one provider is added.
9. **Existing users.** Users created before this migration have `onboarding_complete = 0` after the migration runs, which would force them through the wizard on next login. Fix: migration sets `onboarding_complete = 1` for any user that already has a row in `organizations` (they're effectively onboarded).
10. **Concurrent browser tabs.** If the user opens the web dashboard in two tabs during onboarding, Redux state is duplicated. Use server state as the source of truth so both tabs converge.
11. **Individual users and teams.** An individual is still the admin of a one-person "personal" org. We do **not** create a separate "personal" mode in the proxy — every user always has exactly one `orgId`. This keeps the RBAC engine simple.
12. **Invite flow assumption.** The plan assumes `POST /api/orgs/:id/invites` already exists or will be added. Check during Phase 2; if missing, add a minimal implementation: generate a signed invite token, email it (or print the link in dev mode), `GET /invite/:token` accepts it, creates the user row, and signs them in.
13. **Dashboard URL derivation.** In dev the dashboard is on 5174 (separate from proxy 8080). In prod the dashboard should be served from the proxy on the same port (via `fastify-static`). The `buildWebLoginUrl` helper needs to know which. Proposal: proxy exposes `GET /api/public/config` returning `{ webDashboardUrl: "https://firewall.acme.com" }` that extensions read once at first use, and CLI `--proxy` flag derives it.

---

## 8. Approval checklist (please confirm before implementation)

- [ ] **Hybrid token delivery approved:** per-extension callback (CLI + JetBrains loopback, VS Code URI handler) is the primary channel; `~/.ai-firewall/auth.json` shared file is an auto-enabled bonus for local-proxy setups only
- [ ] **Remote proxy support included:** same auth flow works for `http://localhost:8080`, `https://firewall.team.internal`, and `https://firewall.mycompany.com`
- [ ] **`aiFirewall.proxyUrl` setting added** to each extension (VS Code, JetBrains, CLI config) so users can point at a remote proxy
- [ ] **Neutralize (not delete) WorkOS code** in this pass; delete in a follow-up (Phase 10)
- [ ] **Port the onboarding wizard into `web/`** with 7 steps as described in §4
- [ ] **Individual workspaces automatically get admin role** (no extra flow)
- [ ] **Invite flow:** admin invites users by email; invited users click a link, set password or sign in with SSO, land on the dashboard with the org's policies already active
- [ ] **JetBrains existing keychain tokens:** require fresh sign-in (no silent migration)
- [ ] **Every surface gets a Sign Out command** with the 3-step sequence (proxy revoke + delete handoff if local + local cleanup)
- [ ] **gui/'s onboarding + login pages get deleted** (918 lines) and replaced with a minimal redirect screen that opens the web dashboard via extension-host messenger
- [ ] **Users created before this change** get `onboarding_complete = 1` if they already have an org
- [ ] **Extension-to-proxy config:** each extension has a configurable `proxyUrl` setting; derive the dashboard URL from a `GET /api/public/config` endpoint on first contact

Once this list is signed off, implementation proceeds phase-by-phase as in §5.

---

## 9. End-to-end user journeys (concrete walkthroughs)

These are the scenarios the final system should support. Every journey ends with "it just works" — no hidden configuration, no per-user setup beyond the initial sign-in.

### 9.1 Individual — solo developer, local proxy

1. Dev installs the proxy locally: `git clone ... && cd proxy && npm install && npm start`
2. Dev opens `http://localhost:5174/` in browser → sees landing page → clicks **Sign Up**
3. Fills email + password → `POST /api/auth/register` → lands on `/onboarding/step/1`
4. **Step 1:** picks "Individual". Proxy auto-creates an org `personal-<random>` with the dev as admin. Steps 3 and 6 will be skipped.
5. **Step 2:** confirms profile name + timezone.
6. **Step 4:** accepts default scanner thresholds (can tweak later). Leaves response scanning off, MCP gateway on.
7. **Step 5:** adds their OpenAI API key + Anthropic key. Both encrypted into the vault.
8. **Step 7:** reviews summary, clicks **Finish**. Proxy flips `onboarding_complete = true` and writes `~/.ai-firewall/auth.json` via handoff (proxy is local).
9. Dev opens VS Code. Extension activates, sees `SecretStorage` empty, adopts shared file silently. Extension shows "Signed in as <email>" in status bar.
10. Dev runs `cn` in terminal. CLI finds `~/.ai-firewall/auth.json`, validates, starts chat.
11. **Total sign-ins:** 1 (on the web dashboard). No more for the life of that token.

### 9.2 Team — 5-person startup, proxy on a shared dev server

1. Lead developer installs the proxy on `firewall.startup.internal:8080` (shared Linux box behind VPN). Web dashboard is served from the same host at `firewall.startup.internal/` (fastify-static from `proxy/`).
2. Lead opens the dashboard → **Sign Up** → goes through onboarding Steps 1–7. Picks "Team", invites the other 4 devs by email in Step 3, adds the team's shared OpenAI key in Step 5.
3. Each invited dev receives an email: _"Lead invited you to AI Firewall — click to accept"_.
4. Each dev clicks the link → opens `https://firewall.startup.internal/invite/<signedToken>` → sets their own password → signs in → lands on `/dashboard`. **No onboarding wizard for them** — they inherit the org's configuration.
5. Each dev configures their extensions:
   - **VS Code:** sets `aiFirewall.proxyUrl` to `https://firewall.startup.internal:8080` in settings, runs `AI Firewall: Sign In` command. Browser opens dashboard (already signed in from step 4), URL `vscode://publisher.aiFirewall/authCallback?token=...` fires, token lands in SecretStorage.
   - **CLI:** `cn login --proxy https://firewall.startup.internal:8080` → browser opens → token comes back via loopback port 19836 → written to local `~/.ai-firewall/auth.json` (the file only lives on each dev's own laptop since proxy is remote, so no cross-pollination).
   - **JetBrains:** Settings → AI Firewall → set proxy URL → click **Sign In** → browser opens → token comes back via loopback port 19837 → stored in PasswordSafe.
6. Every dev uses the same org's policies and provider keys. Admin sees their usage, costs, and audit logs in the dashboard.
7. **Admin per-user config:** zero.
8. **Dev per-surface sign-ins:** 1 per extension (after the initial invite accept), and that's only because the shared file is not reachable across machines.

### 9.3 Organization — Fortune 500, proxy on cloud VM, SSO

1. IT runs the proxy in their cloud (Docker on GCP/AWS), exposed at `https://firewall.acme.com`. SSO is configured in proxy env vars (`SSO_GOOGLE_CLIENT_ID`, etc.) via the admin's existing identity provider.
2. IT admin opens `https://firewall.acme.com/` → clicks **Continue with Google** on the login page → lands on `/onboarding`. Picks "Organization" in Step 1. Creates teams in Step 3 ("Backend", "Frontend", "Data"). Adds the company's central Anthropic + Azure OpenAI keys in Step 5. Configures Slack webhook for approval alerts in Step 6.
3. IT admin uses RBAC in `/rbac` to assign team leads. Team leads can create per-team policies via a separate `/policy` page (outside the wizard).
4. Engineers get the extension from the company's internal VS Code Marketplace or IntelliJ plugin repo. The extension ships with `aiFirewall.proxyUrl` preset to `https://firewall.acme.com` via organization policy.
5. Engineer opens VS Code → "AI Firewall: Sign In" → browser redirects to Google SSO (since the proxy has it enabled) → signs in → token delivered via `vscode://` URI handler.
6. Engineer types a prompt. Every request is scanned against the org's policy; audit log in the dashboard shows who sent what. Cost is attributed to the engineer's team.

### 9.4 Sign-out journeys

- **Dev wants to sign out of just VS Code:** Command palette → "AI Firewall: Sign Out". Current token is revoked on the proxy (`POST /api/auth/logout`), SecretStorage is cleared, webview drops to "Sign In" screen. CLI and the web dashboard (on other tabs) are unaffected until their cached token hits 401 on the next request.
- **Admin wants to revoke a compromised device:** `/rbac/users/<user>/tokens` in the dashboard shows all active tokens per user. Admin clicks "Revoke" next to the suspect row. That token's next request returns 401, the extension shows "Signed out" toast and prompts for re-login.
- **Dev wants to sign out everywhere:** Dashboard → Profile menu → "Sign out of all devices" → `POST /api/auth/logout/all`. Every cached token across all surfaces fails its next call.

### 9.5 Key takeaways

- **Admin-centric setup** (policies, providers, teams) happens **once in web/**. Invited users never see that configuration.
- **Invited users** only ever sign in and use the tool. No policy choices, no provider setup.
- **Proxy location is transparent.** Same flow for localhost, LAN, and public cloud.
- **Shared file is a local-only shortcut**, never a requirement. Remote-proxy teams lose nothing; they just sign into each extension once.

---

## 10. Appendix — affected proxy routes (reference)

The onboarding wizard reuses or lightly extends the following already-implemented endpoints. No new business logic is needed outside the handoff + onboarding-complete endpoints.

| Route                                            | Module                  | Step(s) using it             |
| ------------------------------------------------ | ----------------------- | ---------------------------- |
| `POST /api/auth/register`                        | `auth.route.ts`         | Pre-step (signup)            |
| `POST /api/auth/login`                           | `auth.route.ts`         | Pre-step (signin)            |
| `GET /api/auth/me`                               | `auth.route.ts`         | Gate + restore               |
| `POST /api/auth/logout`                          | `auth.route.ts`         | Logout everywhere            |
| `POST /api/auth/sso/login`                       | `sso.route.ts`          | Web sign-in                  |
| `POST /api/auth/handoff` _(new)_                 | `authHandoff.route.ts`  | After every successful login |
| `GET /api/auth/handoff/status` _(new)_           | `authHandoff.route.ts`  | Extension polling            |
| `DELETE /api/auth/handoff` _(new)_               | `authHandoff.route.ts`  | Logout                       |
| `POST /api/users/me/onboarding/complete` _(new)_ | `auth.route.ts`         | Step 7                       |
| `POST /api/orgs`                                 | `org.route.ts`          | Step 1                       |
| `PUT /api/orgs/:id`                              | `org.route.ts`          | Step 2                       |
| `POST /api/orgs/:id/members`                     | `org.route.ts`          | Step 1 + Step 3              |
| `POST /api/orgs/:id/invites` _(add if missing)_  | `org.route.ts`          | Step 3                       |
| `POST /api/teams`                                | `team.route.ts`         | Step 3                       |
| `POST /api/policy` (upsert)                      | `policy.route.ts`       | Step 4                       |
| `POST /api/providers`                            | `provider.route.ts`     | Step 5                       |
| `POST /api/notifications/channels`               | `notification.route.ts` | Step 6                       |

All of these exist in the proxy today (see `proxy/src/routes/`) except the three routes marked _(new)_ and the invites endpoint if it's missing — which adds minimal new server logic.

---

_End of plan. Awaiting approval to execute._
