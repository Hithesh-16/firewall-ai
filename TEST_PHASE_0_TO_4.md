# Manual Test Plan — Phases 0–4

**Scope:** the shared-auth package, proxy handoff + onboarding endpoints,
and the `web/` dashboard's landing → login → onboarding → dashboard flow.
Extensions (VS Code / CLI / JetBrains) are Phase 5–7 and are **not** part of
this test plan.

**Prerequisites:**

- Node 18+, npm 9+
- `~/.ai-firewall/` directory writable by the current user
- A valid Gemini / OpenAI / Anthropic / Ollama endpoint for Step 5 (or pick
  Ollama and point it at `http://localhost:11434` if you have nothing else)
- No proxy, no web server, no existing auth tokens on startup
  (clean state — see [0.1](#01-reset-to-a-clean-state))

---

## 0. One-time setup

### 0.1 Reset to a clean state

```bash
# Stop any running proxy / web dev server first, then:
cd /Users/hitheshreddy/Desktop/Recycle/extra/continue-main

# Nuke existing auth + onboarding state (OPTIONAL but recommended)
rm -f ~/.ai-firewall/auth.json
rm -f ~/.ai-firewall/.onboarding_complete

# Also clear the proxy's SQLite DB if you want a clean user table:
#   WARNING: this wipes ALL users, orgs, logs, policies, providers, etc.
#   Skip unless you want a fully fresh slate.
# rm -f proxy/data/firewall.db
```

### 0.2 Build everything

```bash
# shared-auth package (tests + build in one command)
cd packages/shared-auth && npm install && npm run build && npm test
# Expected: "# tests 14  # pass 14  # fail 0"

# proxy
cd ../../proxy && npm install && npm run build
# Expected: exit 0, no TypeScript errors

# web dashboard
cd ../web && npm install && npx tsc -p tsconfig.json --noEmit
# Expected: exit 0
```

### 0.3 Start proxy + web in dev mode

Use two terminals:

```bash
# Terminal A — proxy
cd proxy && npm run dev
# Expected: "server listening at http://127.0.0.1:8080" or similar.
# Proxy hot-reloads on save (nodemon).
```

```bash
# Terminal B — web
cd web && npm run dev
# Expected: "VITE vX.X.X  ready in … ms  ➜  Local:  http://localhost:5174/"
```

---

## 1. Phase 0 — shared-auth package

### 1.1 Run the test suite

```bash
cd packages/shared-auth && npm test
```

**Expected:**
- `# tests 14`
- `# pass 14`
- `# fail 0`
- Coverage report shows `loopbackServer.js`, `authFile.js`, `webLoginUrl.js`

### 1.2 Inspect the shared file helpers at runtime

The automated tests already cover this, but if you want to touch it manually:

```bash
node -e "
const sa = require('./packages/shared-auth/dist/index.js');
console.log('path:', sa.getAuthFilePath());
console.log('valid(null):', sa.isAuthValid(null));
sa.saveAuthFile({
  version: 1,
  proxyUrl: 'http://localhost:8080',
  accessToken: 'afw_manual_test',
  user: { id: 999, email: 'manual@test.com', role: 'admin' },
  savedAt: Date.now(),
  savedBy: 'cli'
});
console.log('loaded:', sa.loadAuthFile());
sa.deleteAuthFile();
console.log('after delete:', sa.loadAuthFile());
"
```

**Expected:** path ends in `/.ai-firewall/auth.json`, save then load returns the
same object, delete then load returns `null`.

> **Don't commit the `afw_manual_test` file** — delete it after.

---

## 2. Phase 1 — proxy handoff + web-login bridge

All tests below are HTTP calls. Use `curl` or Postman. Replace `$PROXY` with
`http://localhost:8080` throughout.

### 2.1 Public config discovery

```bash
curl -s http://localhost:8080/api/public/config | jq
```

**Expected:**
```json
{
  "proxyUrl": "http://localhost:8080",
  "dashboardUrl": "http://localhost:5174",
  "version": "0.0.0-dev",
  "sso": { "enabled": true, "providers": ["google"] },   // only if SSO env vars set
  "features": { "localHandoff": true, "webOnlyAuth": true }
}
```

### 2.2 Web-login bridge — happy paths

```bash
# CLI return — expect a 302 redirect to /login?from=extension + a signed cookie
curl -s -i "http://localhost:8080/web-login-start?return=cli&port=19836" | head -10

# VS Code return — expect 302 + cookie
curl -s -i "http://localhost:8080/web-login-start?return=vscode&callback=vscode%3A%2F%2Fpublisher.aiFirewall%2FauthCallback" | head -10
```

**Expected:** `HTTP/1.1 302 Found`, `set-cookie: afw_ext_return=…`, `location: /login?from=extension`.

### 2.3 Web-login bridge — negative paths

```bash
# Missing return
curl -s "http://localhost:8080/web-login-start"
# Expected: {"error":"invalid_return",…}

# CLI without port
curl -s "http://localhost:8080/web-login-start?return=cli"
# Expected: {"error":"missing_port",…}

# VS Code without callback
curl -s "http://localhost:8080/web-login-start?return=vscode"
# Expected: {"error":"invalid_callback",…}

# VS Code with non-allowed scheme (open-redirect attack)
curl -s "http://localhost:8080/web-login-start?return=vscode&callback=https%3A%2F%2Fevil.com"
# Expected: {"error":"invalid_callback",…}
```

### 2.4 Handoff status from loopback

```bash
curl -s http://localhost:8080/api/auth/handoff/status | jq
```

**Expected:**
- If no user has signed in since `auth.json` was deleted: `{"present": false, "email": null, "savedAt": null, …}`
- After a successful web sign-in: `{"present": true, "email": "…", "savedAt": <epoch>, "savedBy": "web", "proxyUrl": "http://localhost:8080"}`

### 2.5 Handoff POST requires Bearer + loopback

```bash
# No auth — expect 401
curl -s -X POST http://localhost:8080/api/auth/handoff
# Expected: {"error":"Missing or invalid API token"}

# With a valid token from a later step (or from auth.json):
TOKEN=$(jq -r .accessToken ~/.ai-firewall/auth.json)
curl -s -X POST http://localhost:8080/api/auth/handoff \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"source":"web"}' | jq
# Expected: {"ok": true, "path": "…/.ai-firewall/auth.json", "savedBy": "web", …}
ls -l ~/.ai-firewall/auth.json
# Expected: -rw-------  (chmod 600)
```

---

## 3. Phase 2 — onboarding endpoints + invite flow

### 3.1 Register a fresh admin user

```bash
EMAIL="manual-$(date +%s)@example.com"
curl -s -X POST http://localhost:8080/api/auth/register \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"name\":\"Manual Tester\",\"password\":\"testpw12345\"}" | jq
```

**Expected:**
```json
{
  "user": {
    "id": N,
    "email": "manual-…@example.com",
    "name": "Manual Tester",
    "role": "admin",                    // ← MUST be admin, NOT developer
    "orgId": M,                         // ← auto-created org
    "onboardingComplete": false         // ← triggers wizard
  },
  "token": "afw_…"
}
```

Save `token` and `orgId` into shell vars for the next tests:

```bash
TOKEN="afw_…"
ORG_ID="M"
```

### 3.2 Profile update

```bash
curl -s -X PUT -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Renamed Person"}' \
  http://localhost:8080/api/users/me | jq
```

**Expected:** user object with `"name": "Renamed Person"`.

### 3.3 Org rename (Phase 4 prerequisite)

```bash
curl -s -X PUT -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"My New Co","slug":"my-new-co"}' \
  "http://localhost:8080/api/orgs/$ORG_ID" | jq
```

**Expected:** `{"org": {"id": M, "name": "My New Co", "slug": "my-new-co", …}}`.

Try a duplicate slug — should 409:

```bash
# Create another user with the same pattern, then try to steal the slug
curl -s -X PUT -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"slug":"my-new-co"}' \
  "http://localhost:8080/api/orgs/$ORG_ID"
# Expected: 200 (no-op, same slug as before)

# Now make another user and try to take my-new-co
# … (pattern: register 2nd user → PUT /api/orgs/:id {slug:"my-new-co"} → expect 409)
```

### 3.4 Onboarding complete flag

```bash
# Before:
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8080/api/auth/me | jq '.user.onboardingComplete'
# Expected: false

# Flip it:
curl -s -X POST -H "Authorization: Bearer $TOKEN" \
  http://localhost:8080/api/users/me/onboarding/complete | jq '.user.onboardingComplete'
# Expected: true

# After:
curl -s -H "Authorization: Bearer $TOKEN" http://localhost:8080/api/auth/me | jq '.user.onboardingComplete'
# Expected: true
```

### 3.5 Invite flow

```bash
INVITEE="teammate-$(date +%s)@example.com"

# Create invite
INVITE=$(curl -s -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$INVITEE\",\"role\":\"developer\"}" \
  "http://localhost:8080/api/orgs/$ORG_ID/invites")
echo "$INVITE" | jq

INVITE_TOKEN=$(echo "$INVITE" | jq -r .invite.token)

# Public peek (no auth)
curl -s "http://localhost:8080/api/auth/invites/$INVITE_TOKEN" | jq
# Expected: { email, role:"developer", orgId, orgName, expiresAt }

# Accept the invite (creates the invitee user)
curl -s -X POST http://localhost:8080/api/auth/invites/accept \
  -H "Content-Type: application/json" \
  -d "{\"token\":\"$INVITE_TOKEN\",\"name\":\"Invitee\",\"password\":\"newpw12345\"}" | jq
# Expected: { user: { role:"developer", orgId:<same as admin>, onboardingComplete:true }, token }
```

**Key property:** invitees have `onboardingComplete: true` immediately — they
inherit the admin's setup and never see the wizard.

### 3.6 Logout revokes the token

```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" http://localhost:8080/api/auth/logout
# Expected: {"ok":true,"message":"Logged out successfully"}

# Reuse the same token — must now fail
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer $TOKEN" http://localhost:8080/api/auth/me
# Expected: 401
```

---

## 4. Phase 3 — web/ sign-in integration (browser UI)

Open `http://localhost:5174/` in a browser. Do NOT use the old `http://localhost:5173/`.

### 4.1 Landing page

- You should see the animated dark AI Firewall landing page with aurora blobs.
- Hero text: "The open-source security layer for every AI request".
- Nav: Features · Extensions · Docs · GitHub · **Sign in** · **Get Started**.
- Click **Features** — scrolls to the 6 feature cards.
- Click **Extensions** — scrolls to the 4 extensions grid.
- Click **Get Started** — takes you to `/register`.
- Click **Sign in** — takes you to `/login`.

### 4.2 Register form

- You should see the login/register card on top of the animated backdrop.
- The two-tab switcher defaults to **Sign In**. Click **Create Account**.
- If the proxy has SSO enabled you'll see a **Continue with Google** button
  above the email form.
- Enter:
  - Name: `Browser Tester`
  - Email: `browser-test-<timestamp>@example.com`
  - Password: `testpw12345`
- Click **Create Account**.

**Expected:**
- Brief loading spinner on the button.
- You are **redirected to `/onboarding`** (NOT `/dashboard`), because
  `onboardingComplete` is false for fresh signups.
- In the browser DevTools → Network:
  - `POST /api/auth/register` → 201
  - `POST /api/auth/handoff` → 200 (or 403 if proxy is non-loopback; the
    flow continues either way)
  - Navigation to `/onboarding`

### 4.3 Refresh resilience

While on the onboarding wizard, **hard-refresh the browser** (⌘-Shift-R or
Ctrl-Shift-R).

**Expected:**
- The wizard briefly shows a loading spinner (hydration).
- It lands back on a sensible step with previously-saved server state
  (org name, any providers/teams already created). State you had only in
  Redux but hadn't saved to the server yet (e.g. half-filled Step 5
  form fields) resets — that's expected.

### 4.4 Logout via the top bar

Once onboarding is complete and you're on the dashboard:

- Click your avatar in the top-right.
- Click **Sign out** from the dropdown.

**Expected:**
- You're redirected to `/login`.
- In Network: `POST /api/auth/logout` → 200, `DELETE /api/auth/handoff` → 200.
- `localStorage["afw-token"]` is gone (check DevTools → Application → Local Storage).
- `cat ~/.ai-firewall/auth.json` → "No such file".

### 4.5 `web/` gate enforcement

- While signed out, try to visit `http://localhost:5174/dashboard` directly.
- **Expected:** redirect to `/login`.
- Sign in as the same user.
- **Expected:** lands on `/dashboard` (since `onboardingComplete` is now true).

### 4.6 `gui/` IDE-only gate (smoke)

Open `http://localhost:5173/` in the same browser.

**Expected:** the dark "AI Firewall — IDE UI" page with the "Open Web
Dashboard" button. You do NOT see the chat/onboarding UI.

---

## 5. Phase 4 — onboarding wizard end-to-end

This is the most interactive test. **Sign out first** and **register a brand
new user** (§4.2 recipe) before each full walkthrough so you hit a clean
`onboardingComplete: false` state.

### 5.1 Step 1 — Workspace type

**Try all three paths:**

1. **Individual** → click, then **Continue**.
   - Network: `POST /api/orgs` → 201, `POST /api/orgs/:id/members` → 200, `GET /api/auth/me` → 200.
   - UI: jumps to Step 2.
   - Progress bar: "Step 1 of 5" becomes "Step 2 of 5" (individuals skip 3 and 6).

2. **Team** → Continue.
   - Same network calls, but the progress bar shows "of 7".

3. **Organization** → Continue.
   - Same as Team but Step 3 will show the "Teams" sub-panel.

### 5.2 Step 2 — Profile

- Change name to `Wizard Manual`.
- Change workspace name to `Manual Co`. Slug auto-updates to `manual-co`.
- Industry: `Testing`.
- Timezone: pre-populated from browser.
- Click **Continue**.

**Expected:** `PUT /api/users/me` → 200, `PUT /api/orgs/:id` → 200.
Go back to Step 1, pick again, return — the name + slug persist.

### 5.3 Step 3 — Teams (Team/Org only)

- Add a team called `Frontend` (slug auto-fills `frontend`). Click **Add**.
  - Network: `POST /api/teams` → 201.
  - UI: the team appears in a row with an X button.
- Add another: `Backend`.
- Invite a member: email `dev1@example.com`, role `developer`. Click **Invite**.
  - Network: `POST /api/orgs/:id/invites` → 200.
  - UI: row appears with the email + role + a **Copy link** button.
- Click **Copy link** → clipboard gets the invite URL. Paste it elsewhere to
  confirm it's shaped like `http://localhost:5174/invite/<token>`.
- Remove one team and one invite (X buttons) — UI updates instantly.
- Click **Continue**.

### 5.4 Step 4 — Policy

- **Secrets** scanner: toggle off then on. Sliders hide/show correctly.
- Drag the **Block ≥** slider for Secrets to `80`.
- Drag **Redact ≥** to `50`.
- Disable the **Entropy** scanner entirely.
- Toggle **Scan LLM responses** on.
- Leave **MCP gateway scanning** and **MCP audit log** on.
- Toggle **Cost-aware routing** on → a "Max USD per request" input appears.
  Enter `2.5`.
- Click **Continue**.

**Expected:** `POST /api/policy/wizard` → 200 `{ok:true}`.

**Verify the proxy actually merged the policy:**

```bash
grep -A2 "prompt_injection\|unicode_normalization\|cost_routing" proxy/policy.json | head -20
```

You should see the `prompt_injection.threshold`, `unicode_normalization.block_on_anomaly`,
and `cost_routing.maxCostPerRequest: 2.5` reflecting your UI choices.

### 5.5 Step 5 — Providers (CRITICAL — chat won't work without this)

Add at least one provider. Verify the conditional fields update correctly as
you click between kinds:

- **OpenAI** → only asks for API key. No base URL, no deployment. Paste a
  real or fake key, click **Add provider**.
  - Expected: row appears under "Added" with `✓ OpenAI`.
  - `POST /api/providers` → 201 (baseUrl auto-derived to `https://api.openai.com/v1`).
- **Anthropic** → same as OpenAI.
- **Google Gemini** → same.
- **Mistral** → same.
- **Azure OpenAI** → shows API key + base URL + deployment name.
- **Ollama** → only asks for base URL, defaults to `http://localhost:11434`.
  NO API key field. Click **Add provider** without a key.
  - Expected: 201.
- **Custom** → asks for API key + base URL.

**At least one provider must be added** before the **Continue** button enables.
Click the X next to one to verify removal. Click **Continue** when ready.

### 5.6 Step 6 — Notifications (Team/Org only)

All four fields are optional. Fill in a webhook URL to verify persistence:

- Webhook URL: `https://example.com/test-hook`
- Click **Continue**.

**Expected:** `POST /api/notifications/channels` → 200 with
`{"id": 1, "channelType": "webhook"}` (or similar).

### 5.7 Step 7 — Review & Finish

- The card shows a summary: workspace type, workspace name, scanners enabled
  ("N of 5"), MCP gateway on/off, teams count (org only), members invited (org
  only), **Providers added** ("1" or more).
- If `Providers added` is 0, you'll see an amber warning row and another
  warning below — the Finish button still works but you shouldn't hit it
  until you add a provider.
- Click **Finish setup**.

**Expected:**
1. `POST /api/users/me/onboarding/complete` → 200 `{ok:true}`
2. `POST /api/auth/handoff` → 200 `{ok:true}`
3. Browser navigates to `/dashboard`.
4. `cat ~/.ai-firewall/auth.json` on disk shows the latest token,
   `"savedBy": "web"`, and `"onboardingComplete": true`.
5. Hard-refresh `/dashboard` — you stay on the dashboard (onboarding gate
   stops redirecting).
6. Manually navigate to `/onboarding` — redirects back to `/dashboard`.

### 5.8 Sign out then sign back in (the full loop)

- Click Sign out from the top bar.
- On `/login`, enter the same email + password you registered with.
- **Expected:** lands directly on `/dashboard`, NOT `/onboarding` (because
  `onboardingComplete` is true now).

### 5.9 Invite acceptance (another browser / incognito)

Copy one of the invite URLs you generated in Step 3 (it should look like
`http://localhost:5174/invite/<token>`). Open it in an **incognito window**
so you're not signed in.

> **Note:** the `/invite/:token` landing page in the web dashboard is not
> yet implemented — Phase 4 only shipped the backend routes + the wizard's
> copy-link button. You can still verify the backend accepts the invite via
> curl (see §3.5). Phase 5+ will add the UI.

---

## 6. Phase 4 — guards & edge cases

### 6.1 Admin-only policy endpoint

An invited developer user should NOT be able to POST `/api/policy/wizard`:

```bash
# Accept an invite to get a developer token
DEV_TOKEN="afw_…"   # from §3.5

curl -s -o /dev/null -w "%{http_code}\n" \
  -X POST -H "Authorization: Bearer $DEV_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"scanners":{"secrets":{"enabled":false,"block":0,"redact":0},"pii":{"enabled":false,"block":0,"redact":0},"promptInjection":{"enabled":false,"block":0,"redact":0},"entropy":{"enabled":false,"block":0,"redact":0},"unicode":{"enabled":false,"block":0,"redact":0}},"responseScanning":false,"mcpGateway":false,"mcpAudit":false,"costRouting":{"enabled":false}}' \
  http://localhost:8080/api/policy/wizard
# Expected: 403
```

### 6.2 Shared file permissions

After any handoff write:

```bash
stat -f "%OLp" ~/.ai-firewall/auth.json
# Expected: 600

cat ~/.ai-firewall/auth.json | jq '.proxyUrl, .user.email, .onboardingComplete, .savedBy'
# Expected: the current proxy URL, your email, true, "web"
```

### 6.3 Handoff refused for remote requests

```bash
# Simulate a non-loopback request (requires reverse proxy or fake X-Forwarded-For)
# Easiest: temporarily export AI_FIREWALL_LOCAL_HANDOFF=0 and restart proxy.
AI_FIREWALL_LOCAL_HANDOFF=0 npm run dev
# Then:
curl -s http://localhost:8080/api/auth/handoff/status
# Expected: {"error":"handoff_disabled",…}
# Remember to unset and restart after testing.
```

### 6.4 Invite token ≥ 100 chars

This tests the Fastify `maxParamLength` fix from the verification pass:

```bash
# Any fresh invite token is ~208 chars. If /api/auth/invites/:token
# returns 404, maxParamLength wasn't raised. Should now return 200.
curl -s -o /dev/null -w "%{http_code}\n" \
  "http://localhost:8080/api/auth/invites/$INVITE_TOKEN"
# Expected: 200
```

---

## 7. Known gaps / not-in-scope

These are intentionally NOT wired up in Phases 0–4 and are **not** failures
of this test plan:

| Surface | Status |
|---|---|
| CLI (`cn login`) | Still uses the legacy WorkOS device-auth flow. Phase 5. |
| VS Code extension sign-in | Still uses legacy WorkOS. Phase 6. |
| JetBrains plugin sign-in | Still uses legacy WorkOS. Phase 7. |
| `gui/` login/onboarding pages (918 lines) | Still present, just gated behind `isInIde()`. Phase 8 deletes them. |
| `/invite/:token` landing page in `web/` | Backend works, no UI yet. Phase 9 or later. |
| Entropy scanner toggle in policy | UI exists, no proxy field to toggle (stored in Redux only). |
| MCP gateway toggles | UI exists, MCP is enabled at route-registration time, not via policy. |
| Per-org policies | `policy.json` is still global. `PUT /api/policies/org` exists for overrides (not wired to wizard yet). |

---

## 8. If something breaks

### 8.1 Collect diagnostics

```bash
# Proxy logs (Terminal A)
# → Copy any stack traces

# Browser DevTools → Console + Network tabs
# → Note the exact failing request URL and response

# Database state
sqlite3 proxy/data/firewall.db \
  "SELECT id, email, role, org_id, onboarding_complete FROM users;"

# Shared file state
ls -l ~/.ai-firewall/auth.json 2>&1
cat ~/.ai-firewall/auth.json 2>&1
```

### 8.2 Common issues

| Symptom | Cause | Fix |
|---|---|---|
| Wizard stuck on "Step 1 of 5" after picking Individual and clicking Continue | `POST /api/orgs` returned 409 (slug conflict) | Delete the stale org row in `organizations`, or use a different workspace name |
| `POST /api/policy/wizard` → 403 | User is not admin/security_lead | Make sure you registered fresh. Legacy users may be `developer`. |
| Handoff endpoints 401 | Missing Bearer header | Add `-H "Authorization: Bearer $TOKEN"` |
| Handoff endpoints 403 `handoff_disabled` | Proxy running on non-loopback host OR `AI_FIREWALL_LOCAL_HANDOFF=0` | Restart proxy on `127.0.0.1`, unset the env var |
| `POST /api/providers` 400 `apiKey is required` | Missing `kind: "ollama"` AND missing apiKey | Either pass `kind: "ollama"` OR include an `apiKey` |
| `GET /api/auth/invites/:token` 404 | Fastify `maxParamLength` not raised | Check `proxy/src/server.ts` has `maxParamLength: 1024` and restart |
| `POST /api/notifications/channels` 400 "channelType required" | Wizard sent `type` not `channelType` | Should be fixed in `Step6Notifications.tsx` — rebuild web |
| Onboarding loops forever between `/onboarding` and `/dashboard` | `user.onboardingComplete` out of sync between Redux and proxy | Force `POST /api/users/me/onboarding/complete` via curl, hard-refresh |

### 8.3 Resetting the proxy DB

```bash
# WARNING: wipes everything
rm -f proxy/data/firewall.db
# Restart proxy — the schema + migrations rebuild on startup
```

---

## 9. Acceptance checklist

Tick each one to declare Phases 0–4 "done":

- [ ] §1.1 — shared-auth `npm test` shows 14/14 passing
- [ ] §2.1 — `/api/public/config` returns proxy URL, dashboard URL, and SSO list
- [ ] §2.2 — `/web-login-start?return=cli&port=19836` redirects 302 with cookie
- [ ] §2.3 — all three web-login negative paths return 400
- [ ] §2.4 — `/api/auth/handoff/status` reports the correct presence
- [ ] §2.5 — `POST /api/auth/handoff` writes chmod 600
- [ ] §3.1 — fresh register returns `role: admin` and `onboardingComplete: false`
- [ ] §3.2 — `PUT /api/users/me` updates the display name
- [ ] §3.3 — `PUT /api/orgs/:id` updates name + slug, 409 on duplicate slug
- [ ] §3.4 — onboarding flag flips via POST endpoint
- [ ] §3.5 — invite peek works, invite accept creates a developer user with onboardingComplete:true
- [ ] §3.6 — logout revokes the token (subsequent /me returns 401)
- [ ] §4.1 — landing page animates and all nav links work
- [ ] §4.2 — register redirects to `/onboarding`
- [ ] §4.3 — onboarding wizard survives a hard refresh
- [ ] §4.4 — Sign Out clears localStorage + proxy token + shared file
- [ ] §4.5 — auth gate redirects signed-out users to `/login`
- [ ] §4.6 — `gui/` browser visits show the IDE-only gate
- [ ] §5.1 — all three workspace-type paths work
- [ ] §5.2 — Step 2 persists name/slug
- [ ] §5.3 — teams create, invites generate URLs, copy-link works
- [ ] §5.4 — policy sliders/toggles persist into `policy.json`
- [ ] §5.5 — at least one provider added, kind → baseUrl defaults work, Ollama skips API key
- [ ] §5.6 — at least one notification channel saved
- [ ] §5.7 — Finish flips the onboarding flag, navigates to `/dashboard`, writes shared file
- [ ] §5.8 — signed-out re-sign-in goes straight to `/dashboard` (no wizard replay)
- [ ] §6.1 — developer users blocked (403) on `POST /api/policy/wizard`
- [ ] §6.2 — shared file has permission `0600`
- [ ] §6.4 — Fastify `maxParamLength` is ≥1024 (no 404 on real invite tokens)

When all 27 boxes tick, Phases 0–4 ship as expected.
