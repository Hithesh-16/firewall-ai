# Complete Testing Plan — AI Firewall

## Prerequisites

```bash
# 1. Build and start proxy
cd proxy && npm run build && npm start
# Proxy should be running on http://localhost:8080

# 2. Get an auth token (register + login if first time)
curl -s -X POST http://localhost:8080/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"TestPass123!","name":"Tester"}' | jq .

curl -s -X POST http://localhost:8080/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"TestPass123!"}' | jq .token

# Set the token
export TOKEN="afw_<token_from_login>"

# 3. Start GUI dev server (separate terminal)
cd gui && npm run dev
# GUI should be running on http://localhost:3000
```

---

## Automated Tests

```bash
cd proxy && npm run test:unit
# Expected: 532 passed, 1 failed (pre-existing), 533 total

# Type-check proxy
cd proxy && npx tsc --noEmit
# Expected: no errors

# Type-check GUI
cd gui && npx tsc --noEmit --skipLibCheck
# Expected: no errors
```

### Test Breakdown (532 tests)

| Suite                                                              | Count | File                                             |
| ------------------------------------------------------------------ | ----- | ------------------------------------------------ |
| Policy engine + injection + STRICT_LOCAL + model policy + BlindMI  | 14    | run-tests.ts (inline)                            |
| Token Intelligence (tokenCounter, contextWindow, costEstimator)    | 20    | tokenCounter/contextWindow/costEstimator.test.ts |
| File Scanning (fileScanService, fileScanCache)                     | 9     | fileScan.test.ts                                 |
| MCP Gateway (mcpScanPipeline, mcpAuditLogger)                      | 9     | mcpGateway.test.ts                               |
| Control Plane (approvals, sessions, notifications, WebSocket)      | 10    | controlPlane.test.ts                             |
| Enterprise (cache, license, webhook queue)                         | 13    | enterprise.test.ts                               |
| Unicode Normalizer                                                 | 16    | unicodeNormalizer.test.ts                        |
| Rule File Scanning                                                 | 7     | ruleFileScan.test.ts                             |
| Response Scanner                                                   | 10    | responseScanner.test.ts                          |
| Tasks (CRUD, state machine, progress, kill, lifecycle)             | ~50   | tasks.test.ts                                    |
| Memory (frontmatter, index, CRUD, extraction, truncation)          | ~40   | memory.test.ts                                   |
| Tool Permissions (deny/allow/ask, plan mode, wildcards, dangerous) | ~30   | toolPermissions.test.ts                          |
| Agent Service (spawn, kill, worktree, messaging)                   | ~25   | agentService.test.ts                             |
| Commands (10 built-in, loader, execution, search)                  | ~30   | commands.test.ts                                 |
| Coordinator + Worker Pool (sessions, workers, pool, formatting)    | 30    | coordinator.test.ts                              |
| Cost Tracker (session, per-model, format, purge)                   | 12    | cronAndFlags.test.ts                             |
| Feature Flags (CRUD, rollout, include/exclude)                     | 12    | cronAndFlags.test.ts                             |
| Cron Service (schedule parsing, CRUD, enable/disable)              | 9     | cronAndFlags.test.ts                             |
| Hook Service (register, event filtering, history)                  | 5     | cronAndFlags.test.ts                             |

---

## Phase 1: Task Framework — Manual Testing

### 1.1 Create a Task

```bash
curl -s -X POST http://localhost:8080/api/tasks \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"type":"local_agent","description":"Test task creation"}' | jq .
```

- [ ] Response: `201`
- [ ] `id` starts with `a_`
- [ ] `status` is `"pending"`
- [ ] `type` is `"local_agent"`
- [ ] `startedAt` is a positive timestamp

### 1.2 List Tasks

```bash
curl -s http://localhost:8080/api/tasks \
  -H "Authorization: Bearer $TOKEN" | jq .
```

- [ ] Response: array containing the task from 1.1
- [ ] Each task has `id`, `type`, `status`, `description`

### 1.3 Start the Task

```bash
TASK_ID="<id from 1.1>"
curl -s -X PATCH http://localhost:8080/api/tasks/$TASK_ID \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"running"}' | jq .
```

- [ ] `status` is `"running"`

### 1.4 Report Progress

```bash
curl -s -X POST http://localhost:8080/api/tasks/$TASK_ID/progress \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"toolUseCount":3,"inputTokens":500,"outputTokens":200,"recentActivities":[]}' | jq .
```

- [ ] Response: `{"updated": true}`

### 1.5 Complete the Task

```bash
curl -s -X PATCH http://localhost:8080/api/tasks/$TASK_ID \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"completed","resultSummary":"Done"}' | jq .
```

- [ ] `status` is `"completed"`
- [ ] `completedAt` is set

### 1.6 Verify Invalid Transition Blocked

```bash
curl -s -X PATCH http://localhost:8080/api/tasks/$TASK_ID \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"running"}' | jq .
```

- [ ] Response: `409` "Invalid state transition"

### 1.7 Kill an Active Task

```bash
curl -s -X POST http://localhost:8080/api/tasks \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"type":"bash","description":"Kill test"}' | jq .

NEW_ID="<id from above>"
curl -s -X DELETE http://localhost:8080/api/tasks/$NEW_ID \
  -H "Authorization: Bearer $TOKEN" | jq .
```

- [ ] Response: `{"killed": true}`

### 1.8 Unauthenticated Access Blocked

```bash
curl -s http://localhost:8080/api/tasks | jq .
```

- [ ] Response: `401` "Missing or invalid API token"

---

## Phase 1: Memory System — Manual Testing

### 2.1 Create a Memory

```bash
curl -s -X POST http://localhost:8080/api/memory \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"User Role","description":"Senior engineer","type":"user","body":"Hithesh is a senior engineer working on AI security."}' | jq .
```

- [ ] Response: `201`
- [ ] `fileName` is generated (e.g., `user_user_role.md`)

### 2.2 List Memories

```bash
curl -s http://localhost:8080/api/memory \
  -H "Authorization: Bearer $TOKEN" | jq .
```

- [ ] Array contains the created memory

### 2.3 Filter by Type

```bash
curl -s "http://localhost:8080/api/memory?type=user" \
  -H "Authorization: Bearer $TOKEN" | jq .
```

- [ ] Only `"user"` type memories returned

### 2.4 Read Index

```bash
curl -s http://localhost:8080/api/memory/index \
  -H "Authorization: Bearer $TOKEN" | jq .
```

- [ ] MEMORY.md content contains "User Role" entry

### 2.5 Read Single Memory

```bash
FILENAME="<fileName from 2.1>"
curl -s http://localhost:8080/api/memory/$FILENAME \
  -H "Authorization: Bearer $TOKEN" | jq .
```

- [ ] Contains frontmatter (name, type, description) and body

### 2.6 Delete Memory

```bash
curl -s -X DELETE http://localhost:8080/api/memory/$FILENAME \
  -H "Authorization: Bearer $TOKEN" | jq .
```

- [ ] Response: `{"deleted": true}`

### 2.7 Verify Index Updated

```bash
curl -s http://localhost:8080/api/memory/index \
  -H "Authorization: Bearer $TOKEN" | jq .
```

- [ ] "User Role" entry is removed

### 2.8 Auto-Extract from Conversation

```bash
curl -s -X POST http://localhost:8080/api/memory/extract \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"conversationText":"I am a data scientist. Don'\''t use console.log in production. The deadline is April 15th. Bugs are tracked in Linear project INGEST."}' | jq .
```

- [ ] Extracted >= 2 memories (user + feedback or project + reference)

---

## Phase 1: Agent Service — Manual Testing

### 3.1 Spawn Agent

```bash
curl -s -X POST http://localhost:8080/api/agents/spawn \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"description":"Research auth patterns","prompt":"Find all authentication-related files"}' | jq .
```

- [ ] Response: `201`
- [ ] Contains `taskId`

### 3.2 List Agents

```bash
curl -s http://localhost:8080/api/agents \
  -H "Authorization: Bearer $TOKEN" | jq .
```

- [ ] Array contains the spawned agent
- [ ] `runningCount` >= 1

### 3.3 Send Message to Agent

```bash
AGENT_ID="<taskId from 3.1>"
curl -s -X POST http://localhost:8080/api/agents/$AGENT_ID/message \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message":"Focus on the proxy directory"}' | jq .
```

- [ ] Response: `{"sent": true}`

### 3.4 Kill Agent

```bash
curl -s -X DELETE http://localhost:8080/api/agents/$AGENT_ID \
  -H "Authorization: Bearer $TOKEN" | jq .
```

- [ ] Response: `{"killed": true}`

### 3.5 Kill All Agents

```bash
curl -s -X POST http://localhost:8080/api/agents/kill-all \
  -H "Authorization: Bearer $TOKEN" | jq .
```

- [ ] Response: `{"killed": <count>}`

---

## Phase 2: Command System — Manual Testing

### 4.1 List Commands

```bash
curl -s http://localhost:8080/api/commands \
  -H "Authorization: Bearer $TOKEN" | jq .
```

- [ ] Array of 10 commands
- [ ] Contains: doctor, compact, cost, stats, memory, tasks, review, help, share, resume

### 4.2 Execute /doctor

```bash
curl -s -X POST http://localhost:8080/api/commands/execute \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"input":"/doctor"}' | jq .
```

- [ ] Returns health check with [OK]/[WARN]/[FAIL] per subsystem

### 4.3 Execute /stats

```bash
curl -s -X POST http://localhost:8080/api/commands/execute \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"input":"/stats"}' | jq .
```

- [ ] Returns "Total requests:", "Blocked:", etc.

### 4.4 Execute /cost

```bash
curl -s -X POST http://localhost:8080/api/commands/execute \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"input":"/cost"}' | jq .
```

- [ ] Returns cost tracking info

### 4.5 Execute /memory

```bash
curl -s -X POST http://localhost:8080/api/commands/execute \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"input":"/memory"}' | jq .
```

- [ ] Returns memory listing or "No memories yet"

### 4.6 Execute /tasks

```bash
curl -s -X POST http://localhost:8080/api/commands/execute \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"input":"/tasks"}' | jq .
```

- [ ] Returns task listing or "No active tasks"

### 4.7 Execute /help

```bash
curl -s -X POST http://localhost:8080/api/commands/execute \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"input":"/help"}' | jq .
```

- [ ] Returns command list

### 4.8 Execute /compact

```bash
curl -s -X POST http://localhost:8080/api/commands/execute \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"input":"/compact 4000"}' | jq .
```

- [ ] Returns compaction usage info

### 4.9 Execute /review

```bash
curl -s -X POST http://localhost:8080/api/commands/execute \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"input":"/review"}' | jq .
```

- [ ] Returns type `"prompt"` (generates prompt for LLM)

### 4.10 Unknown Command — 404

```bash
curl -s -X POST http://localhost:8080/api/commands/execute \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"input":"/nonexistent"}' | jq .
```

- [ ] Response: `404` "Command not found"

### 4.11 Unauthenticated — 401

```bash
curl -s http://localhost:8080/api/commands | jq .
```

- [ ] Response: `401`

---

## Phase 2: Skills System — Manual Testing

### 5.1 List Skills

```bash
curl -s http://localhost:8080/api/skills \
  -H "Authorization: Bearer $TOKEN" | jq .
```

- [ ] Array with "commit" and "explain" skills

### 5.2 Invoke Commit Skill

```bash
curl -s -X POST http://localhost:8080/api/skills/invoke \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"commit","args":"Fix auth timeout"}' | jq .
```

- [ ] Returns expanded prompt

### 5.3 Invoke Explain Skill

```bash
curl -s -X POST http://localhost:8080/api/skills/invoke \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"explain","args":"How does the scanner pipeline work?"}' | jq .
```

- [ ] Returns expanded prompt

### 5.4 Unknown Skill — 404

```bash
curl -s -X POST http://localhost:8080/api/skills/invoke \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"nonexistent"}' | jq .
```

- [ ] Response: `404` "Skill not found"

---

## Phase 3: Cron Service — Manual Testing

### 6.1 Create Cron Job

```bash
curl -s -X POST http://localhost:8080/api/cron \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Status check","schedule":"5m","agentConfig":{"description":"Check status","prompt":"Run health checks"}}' | jq .
```

- [ ] Response: `201`
- [ ] `id` starts with `cron_`
- [ ] `enabled` is `true`
- [ ] `nextRunAt` is a future timestamp

### 6.2 List Cron Jobs

```bash
curl -s http://localhost:8080/api/cron \
  -H "Authorization: Bearer $TOKEN" | jq .
```

- [ ] Array contains the created job

### 6.3 Get Cron Job

```bash
CRON_ID="<id from 6.1>"
curl -s http://localhost:8080/api/cron/$CRON_ID \
  -H "Authorization: Bearer $TOKEN" | jq .
```

- [ ] Returns full job object

### 6.4 Disable Cron Job

```bash
curl -s -X POST http://localhost:8080/api/cron/$CRON_ID/disable \
  -H "Authorization: Bearer $TOKEN" | jq .
```

- [ ] Response: `{"disabled": true}`
- [ ] Verify: GET the job, `enabled` is `false`

### 6.5 Enable Cron Job

```bash
curl -s -X POST http://localhost:8080/api/cron/$CRON_ID/enable \
  -H "Authorization: Bearer $TOKEN" | jq .
```

- [ ] Response: `{"enabled": true}`

### 6.6 Delete Cron Job

```bash
curl -s -X DELETE http://localhost:8080/api/cron/$CRON_ID \
  -H "Authorization: Bearer $TOKEN" | jq .
```

- [ ] Response: `{"deleted": true}`

### 6.7 Invalid Schedule Rejected

```bash
curl -s -X POST http://localhost:8080/api/cron \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Bad","schedule":"abc","agentConfig":{"description":"test","prompt":"test"}}' | jq .
```

- [ ] Response: `400` validation error

---

## Phase 3: WebSocket Events — Manual Testing

```bash
# Install wscat: npm i -g wscat
wscat -c "ws://localhost:8080/ws?token=$TOKEN"
```

Then in another terminal, create/update/kill tasks via curl:

- [ ] On task create: receive `task_event` with `eventType: "task_created"`
- [ ] On task start (PATCH to running): receive `task_event` with `eventType: "task_started"`
- [ ] On progress report: receive `task_event` with `eventType: "task_progress"`
- [ ] On task complete: receive `task_event` with `eventType: "task_completed"`
- [ ] On task kill: receive `task_event` with `eventType: "task_killed"`

---

## Phase 3: Scan-Aware Fetch Headers — Manual Testing

### 8.1 Send a Chat Request and Check Headers

```bash
curl -sv -X POST http://localhost:8080/v1/chat/completions \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model":"gpt-4","messages":[{"role":"user","content":"Hello world"}]}' 2>&1 | grep -i "x-af-"
```

- [ ] `X-AF-Action`: ALLOW/BLOCK/REDACT
- [ ] `X-AF-Risk-Score`: 0-100
- [ ] `X-AF-Secrets-Count`: number
- [ ] `X-AF-PII-Count`: number
- [ ] `X-AF-Input-Tokens`: number (real tiktoken count)
- [ ] `X-AF-Estimated-Cost`: number
- [ ] `X-AF-Token-Method`: tiktoken or heuristic

### 8.2 Trigger Context Overflow Header

Send a very large message (>128K tokens worth) and check:

- [ ] `X-AF-Context-Overflow`: true
- [ ] `X-AF-Context-Tokens`: number
- [ ] `X-AF-Context-Max`: number

### 8.3 MCP Tool Call Headers

```bash
curl -sv -X POST http://localhost:8080/v1/mcp/tools/call \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"server":"test","tool":"read_file","arguments":{"path":"README.md"}}' 2>&1 | grep -i "x-af-mcp"
```

- [ ] `X-AF-MCP-Action`: ALLOW/BLOCK/REDACT
- [ ] `X-AF-MCP-Risk-Score`: 0-100
- [ ] `X-AF-MCP-Server`: server ID
- [ ] `X-AF-MCP-Tool`: tool name

---

## GUI Manual Testing — Web Dashboard

Open http://localhost:3000 in browser.

### 9.1 Chat Page

- [ ] Chat loads without errors
- [ ] Send a message → firewall activity indicator appears
- [ ] After response → `ScanResultBanner` shows ALLOW/BLOCK/REDACT
- [ ] Latest assistant message shows `MessageCostBadge` (token count + cost)
- [ ] `SessionCostBadge` visible in header (session total)

### 9.2 PreflightPanel

- [ ] Open browser console
- [ ] Dispatch: `store.dispatch({type:'security/setPreflightResult', payload:{action:'REDACT',secretsFound:2,piiFound:1,riskScore:65,reasons:['AWS key detected']}})`
- [ ] PreflightPanel appears above input with yellow REDACT badge
- [ ] Shows: Secrets: 2, PII: 1, Risk: 65
- [ ] "Send Redacted", "Send Anyway", "Cancel" buttons visible
- [ ] Click "Cancel" → panel disappears

### 9.3 Tasks Page

- [ ] Navigate to `/tasks`
- [ ] Page loads with header "Tasks" and back button
- [ ] Empty state: "No active tasks" message
- [ ] Create a task via curl (1.1) → page shows TaskCard
- [ ] TaskCard shows: status badge, description, progress (if running), kill button

### 9.4 Memory Page

- [ ] Navigate to `/memory`
- [ ] Page loads with header and type filter
- [ ] Empty state: "No memories" message
- [ ] Create a memory via curl (2.1) → page shows MemoryEditor
- [ ] Editor shows frontmatter fields (name, type, description) and markdown body

### 9.5 Agent Manager Page

- [ ] Navigate to `/agents`
- [ ] 4 tabs visible: Active Agents, Coordinator, Pending Approvals, History
- [ ] "Active Agents" tab: shows agents or empty state
- [ ] "Coordinator" tab: shows CoordinatorView with sessions or empty state
- [ ] Spawn agent via curl (3.1) → ActiveAgentCard appears with progress bar
- [ ] Cancel button works on running agents

### 9.6 Setup Wizard

- [ ] Navigate to `/setup`
- [ ] Step 1 (Environment): 3 checks (proxy, DB, scanner) show green/yellow/red
- [ ] If proxy running → all green, Next button enabled
- [ ] If proxy down → checks show red, Next button DISABLED
- [ ] Step 2 (Provider): dropdown (OpenAI/Anthropic/Gemini/Ollama), API key input, base URL input
- [ ] Empty API key → "API key is required" error (except Ollama)
- [ ] Invalid base URL → "API Base must be a valid URL" error
- [ ] Step 3 (Security): 4 green "Enabled" cards (secrets, PII, injection, response)
- [ ] Step 4 (First Scan): spinner → scan result grid (Decision, Risk, Secrets, PII)
- [ ] Step 5 (Complete): green checkmark, "Start Chatting" button → navigates to `/`

### 9.7 Diff Components

- [ ] InlineDiff and SideBySideDiff render in permission dialogs (if triggered)
- [ ] Added lines show green, removed lines show red, context lines default

### 9.8 Redux Store

Open browser console at http://localhost:3000:

```javascript
// Check all slices are registered
const state = store.getState();
console.log(Object.keys(state));
```

- [ ] Contains: `session`, `ui`, `editModeState`, `config`, `indexing`, `tabs`, `profiles`, `security`, `agent`, `tasks`, `memory`, `permissions`

---

## CLI Manual Testing

### 10.1 Doctor Command

```bash
cd extensions/cli
npx ts-node src/commands/doctor.ts
```

- [ ] Shows proxy health status with green/red indicators
- [ ] Shows subsystem checks

### 10.2 Memory Command

```bash
npx ts-node src/commands/memory.ts list
```

- [ ] Lists memories with type badges

### 10.3 CLI UI Components (visual check)

For each Ink component, verify it renders in the terminal:

- [ ] `ScanBanner` — colored ALLOW/BLOCK/REDACT banner
- [ ] `TaskProgress` — spinner + status + token count
- [ ] `PermissionPrompt` — tool name + risk + Allow/Deny buttons
- [ ] `MemoryBrowser` — grouped by type with colored badges
- [ ] `CostDisplay` — total cost + per-model table
- [ ] `AgentStatus` — running agents with progress bars
- [ ] `DiffView` — red/green colored diff lines

---

## Security Checks — Every Phase

- [ ] All API endpoints return `401` without auth token
- [ ] No raw secrets stored in any DB table
- [ ] Memory files written ONLY to `proxy/data/projects/` directory
- [ ] Task state transitions enforced (cannot go `completed → running`)
- [ ] Cron job schedule minimum is 1 minute (< 60s rejected)
- [ ] Hook commands run in sandboxed environment (PATH, HOME, LANG only)
- [ ] Feature flag exclude lists override 100% rollout
- [ ] Agent workers cannot spawn sub-workers (WORKER_DENIED_TOOLS enforced)
- [ ] Each worker agent gets independent scan context

---

## Regression Matrix

Run after EVERY change:

| Suite            | Command                                     | Expected                      |
| ---------------- | ------------------------------------------- | ----------------------------- |
| Full proxy       | `cd proxy && npm run test:unit`             | 532 pass, 1 pre-existing fail |
| Type-check proxy | `cd proxy && npx tsc --noEmit`              | No errors                     |
| Type-check GUI   | `cd gui && npx tsc --noEmit --skipLibCheck` | No errors                     |
| Health check     | `curl http://localhost:8080/health`         | `{"status":"ok"}`             |
| Auth check       | `curl http://localhost:8080/api/tasks`      | `401`                         |

---

## Severity Classification

| Severity          | Meaning                                          | Action                  |
| ----------------- | ------------------------------------------------ | ----------------------- |
| **P0 — Blocker**  | Existing tests fail, security bypass, data loss  | Stop. Fix immediately.  |
| **P1 — Critical** | New feature doesn't work, wrong auth enforcement | Fix before next feature |
| **P2 — Major**    | Edge case failure, wrong error code              | Fix before phase end    |
| **P3 — Minor**    | Formatting issue, non-blocking edge case         | Fix when convenient     |
