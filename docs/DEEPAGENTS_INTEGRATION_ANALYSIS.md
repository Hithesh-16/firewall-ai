# DeepAgents Integration Analysis

> Research notes mapping LangChain `deepagents` (Python / LangGraph) primitives to AI Firewall (TypeScript / Node) capabilities, with a concrete plan for what to adopt, adapt, or skip.
>
> Sources: `https://docs.langchain.com/oss/python/deepagents/*` (overview, models, context-engineering, backends, subagents, async-subagents, HITL, permissions, memory, skills, sandboxes, streaming, frontend, acp, cli/\*) and the source repo `langchain-ai/deepagents` (`libs/deepagents`, `libs/cli`, `libs/acp`).

---

## 1. Executive Summary

`deepagents` is a Python "agent harness" on top of LangChain + LangGraph (~21k stars). It bundles a fixed middleware stack — `TodoListMiddleware`, `FilesystemMiddleware`, `SubAgentMiddleware`, `SummarizationMiddleware`, `MemoryMiddleware`, `HumanInTheLoopMiddleware`, `_PermissionMiddleware` — behind one factory `create_deep_agent(...)`. Its CLI (`deepagents`) is a Textual TUI with config in `~/.deepagents/`, MCP discovery via `.mcp.json`, and provider plug-ins through `langchain-*` packages. There is also an ACP (Agent Client Protocol) server that lets editors like Zed embed it over stdio.

We already have the architectural equivalents of most of it — `agentService`, `taskService`, `memoryService`, `compactService`, `commandLoader`, `MCPConnection`, worktree isolation, approvals, hooks, a 3-level permission chain, and a Firewall scanning chokepoint that deepagents has no answer for. Their lead is in: (a) the `task` tool semantics (declarative subagent specs in-prompt vs our explicit `spawn` tool), (b) `write_todos`/`offload`/`summarize` middleware run automatically on every turn, (c) `provider:model-id` string parsing, (d) async subagent state channel separate from messages, (e) skills as auto-loaded `SKILL.md` directories, and (f) a polished React `useStream` SDK. We should pull the patterns, not the runtime — staying TS/Node-native and keeping the proxy as the security boundary.

What's worth taking: planning middleware (`/todos` + auto-injected todo tool), unified `provider:model-id` resolver, async subagent state channel, ACP stdio adapter for Zed/IntelliJ-shaped editors, expanded MCP transport list & per-project `.mcp.json` discovery in the proxy, and a `useStream`-style React hook for the GUI. What's not worth taking: LangGraph store (replace with our SQLite + memdir), Modal/Daytona sandboxes (worktrees already do isolation), the Python ACP server (rewrite as a TS Fastify route), `_PermissionMiddleware` (we already have a stricter 3-level chain through `core/tools/toolPermissions.ts` plus the scanner pipeline).

---

## 2. Side-by-Side Feature Matrix

| Feature                     | LangChain deepagents                                                                                                                                                                                           | AI Firewall today                                                                                                                                                                       | Gap                                                                                                                      | Effort | Priority |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------ | -------- |
| Model abstraction           | `provider:model-id` parsed by `init_chat_model`; `resolve_model` in `libs/deepagents/deepagents/_models.py`; default `claude-sonnet-4-6`                                                                       | Per-provider classes in `core/llm/llms/<Provider>.ts` + `packages/openai-adapters`                                                                                                      | No unified parser; CLI uses model registry per package                                                                   | S      | High     |
| `task` tool / sync subagent | `SubAgent` TypedDict, auto-registered via `SubAgentMiddleware`; `task(name, task)` tool injected                                                                                                               | `core/tools/implementations/spawnAgent.ts` (3-cap); `proxy/src/services/agentService.ts` w/ git-worktree                                                                                | We have spawn but no declarative subagent registry surfaced in the prompt                                                | M      | High     |
| Async subagent              | `AsyncSubAgent` w/ `graph_id`/`url`; 5 tools (`start_async_task`, `check_async_task`, `update_async_task`, `cancel_async_task`, `list_async_tasks`); state channel `async_tasks` separate from messages        | `agentService` is sync (request/response over WS); polling `/api/agents` every 5s in CLI+GUI                                                                                            | No mid-task steering, no separate state channel, no WS event bus for task lifecycle                                      | M      | High     |
| `write_todos`               | `TodoListMiddleware` injects `write_todos` tool; persisted in agent state; agent re-reads on each turn                                                                                                         | `core/tools/implementations/planTool.ts` exists in IDE only, not in CLI                                                                                                                 | No CLI parity; not auto-injected as a system reminder                                                                    | S      | Med      |
| Virtual filesystem          | `read_file`/`write_file`/`edit_file`/`ls`/`glob`/`grep` via `FilesystemMiddleware`; pluggable backends (`StateBackend`, `FilesystemBackend`, `StoreBackend`, `LocalShellBackend`, `CompositeBackend`, sandbox) | `core/util/scanning/ScanningIde.ts` decorator wraps `IDE.readFile`/etc.; CLI mirror in `extensions/cli/src/services/ScanningFileIo.ts`; tools in `core/tools/implementations/`          | We don't expose backend swap; we don't have a `glob`/`grep` tool in CLI; filesystem is rooted in workspace not pluggable | S/M    | Med      |
| Sandboxes                   | Modal / Daytona / Runloop / AgentCore / LangSmith via `BaseSandbox.execute()`; sandbox is also the FS backend                                                                                                  | `proxy/src/services/agentService.ts` git-worktree isolation; `packages/terminal-security` sandboxing                                                                                    | Worktrees are equivalent for our threat model; we don't have remote sandboxes                                            | L      | Low      |
| Permissions                 | `FilesystemPermission(operations, paths, mode)` first-match-wins; permissive default; subagents inherit (replace, no merge); only built-in tools                                                               | `core/tools/toolPermissions.ts` + `proxy/src/permissions/toolPermissions.ts` 3-level chain; pattern matching, dangerous file/cmd auto-classify, user dialog; covers all tools incl. MCP | We're stricter and cover more surface area                                                                               | —      | None     |
| Memory                      | `MemoryMiddleware` reads `AGENTS.md` files at startup, injects into system prompt, edited via `edit_file`; persisted via `LangGraph Store` (in-memory / Redis / Postgres)                                      | `proxy/src/memory/memdir.ts` + MEMORY.md index; 4 types (user/feedback/project/reference); SQLite-backed; auto-extraction                                                               | We have a richer schema but we don't auto-load AGENTS.md into the system prompt                                          | S      | Med      |
| Skills                      | `SkillsMiddleware`: directory of `SKILL.md` files w/ YAML frontmatter; "progressive disclosure" — frontmatter at startup, full body when matched                                                               | `proxy/src/skills/` with `skillLoader.ts` + bundled `commit`, `explain`; same `SKILL.md` format already                                                                                 | We have the loader but no progressive-disclosure middleware that injects matched skill text mid-turn                     | S      | Med      |
| Human-in-the-loop           | `interrupt_on={"tool": True}`; `Command(resume={...})`; decisions: `approve` / `edit` / `reject`; requires checkpointer                                                                                        | `proxy/src/services/approvalService.ts` + `approval_requests`/`approval_rules` tables; WebSocket `approval_needed`; default-deny on timeout; remembered Allow/Deny rules                | We have approve/deny but not "edit" decision (modifying tool args before exec)                                           | S      | Med      |
| Streaming                   | LangGraph `stream()` with `subgraphs=True`, `version="v2"`; modes `updates`/`messages`/`custom`; namespaces `("tools:uuid",)` mark subagent origin                                                             | OpenAI SDK streaming + Anthropic delta + Gemini single-block + Ollama no-stream; per-provider streaming in `core/llm/llms/*`                                                            | No unified subagent stream namespacing; no token/tool-call event taxonomy at the proxy                                   | M      | High     |
| Frontend SDK                | React `useStream<typeof agent>({apiUrl, assistantId})`; exposes `stream.subagents`, `stream.values?.todos`, `filterSubagentMessages`                                                                           | `gui/src/components/agents/CoordinatorView.tsx` + `AgentManagerPage`; polls `/api/agents` 5s                                                                                            | No real-time hook; no WS-driven subagent sub-stream                                                                      | M      | High     |
| ACP                         | `deepagents_acp.server.AgentServerACP` over stdio; Zed registers via `agent_servers` in `settings.json`                                                                                                        | None — JetBrains plugin uses our own LSP-shaped IPC; CLI is direct                                                                                                                      | No protocol for embedding our agent in Zed/Cursor/etc.                                                                   | M      | Low/Med  |
| CLI MCP                     | Auto-discovers `~/.deepagents/.mcp.json`, `<proj>/.deepagents/.mcp.json`, `<proj>/.mcp.json`; stdio + SSE + HTTP; SHA-256 trust prompt                                                                         | `core/context/mcp/MCPConnection.ts` supports stdio/ws/sse/http + OAuth; only `filesystem` plugin bundled in proxy; CLI `/mcp` slash command unimplemented in proxy `builtinCommands.ts` | No `.mcp.json` discovery; no project-trust fingerprinting; no `/mcp` command                                             | S      | High     |

---

## 3. Per-Feature Deep Dive

### 3.1 Model abstraction

deepagents resolves models with `resolve_model()` in `libs/deepagents/deepagents/_models.py`:

```python
def resolve_model(model: str | BaseChatModel) -> BaseChatModel:
    if isinstance(model, BaseChatModel):
        return model
    profile = _get_harness_profile(model)
    kwargs = {**profile.init_kwargs}
    if profile.init_kwargs_factory is not None:
        kwargs.update(profile.init_kwargs_factory())
    return init_chat_model(model, **kwargs)
```

Default fallback: `ChatAnthropic(model_name="claude-sonnet-4-6")` (`get_default_model()` in `graph.py`). Strings look like `openai:gpt-5`, `anthropic:claude-sonnet-4-6`, `google_genai:gemini-3.1-pro-preview`. Provider-specific quirks (e.g. OpenAI Responses API by default) live in `_HarnessProfile`.

**Our equivalent:** `core/llm/llms/<Provider>.ts` plus `packages/openai-adapters/src/apis/<Provider>.ts`. We don't have a single `resolve("openai:gpt-4o")` helper; the closest is `core/llm/llms/index.ts`.

**Take:** add `proxy/src/gateway/modelResolver.ts` that parses `provider:model-id` into our existing provider classes — useful for the CLI `/model` command and for the future ACP route.

### 3.2 Subagents (sync)

`SubAgent` is a `TypedDict` with `name`, `description`, `system_prompt`, optional `tools`, `model`, `middleware`, `interrupt_on`, `skills`, `permissions`, `response_format`. Registered via `subagents=[…]` to `create_deep_agent`. `SubAgentMiddleware` materializes a `task(name, task)` tool that `create_agent`-s a child graph and returns its final message as a `ToolMessage` to the parent. Skills and permissions are isolated; runtime context propagates.

**Our equivalent:** `core/tools/implementations/spawnAgent.ts` is the LLM-callable spawn (3-concurrent cap), `proxy/src/services/agentService.ts` does worktree isolation, and `coordinatorService.ts` orchestrates. Critically, our model is "spawn arbitrary worker", while deepagents' is "delegate to one of N pre-declared specialists". Their pattern compresses prompt budget — the parent only sees declarations + final answer.

**Take:** introduce a declarative `subagents.yaml` (or extend `proxy/src/agents/`) with `name`, `description`, `system_prompt`, optional tool/model overrides — and inject the `task` tool that maps onto `agentService.spawn()`. Keep `spawnAgent` as the escape hatch for ad-hoc workers.

### 3.3 Subagents (async)

`AsyncSubAgent(name, description, graph_id, url?, headers?)` registered alongside sync agents. `AsyncSubAgentMiddleware` injects 5 tools: `start_async_task`, `check_async_task`, `update_async_task`, `cancel_async_task`, `list_async_tasks`. Crucially the metadata lives in a dedicated state channel `async_tasks`, separate from the message history — survives summarization. Mid-task steering via `update_async_task` is the differentiator over our sync model.

**Our equivalent:** `agentService.ts` spawn is fire-and-forget but messaging is `POST /api/agents/:taskId/message` (one-way). `taskService` tracks state (pending → running → completed/failed/killed). No mid-task steering.

**Take:** add `update` to the spawn tool surface and an `async_tasks` field on session state that's preserved across `compactService` runs. Will need WebSocket `task_event` (already declared in CLAUDE.md) to actually flow through both extension and CLI.

### 3.4 Planning (`write_todos`)

`TodoListMiddleware` (in `langchain.agents.middleware`) injects a `write_todos(todos: list[Todo])` tool and prepends a system reminder telling the agent to use it. Todos are stored in agent state and re-presented on every turn. There is no separate persistence — the LangGraph checkpointer handles it.

**Our equivalent:** `core/tools/implementations/planTool.ts` exists for the IDE side; CLI is missing it. `taskService` is for spawned worker tracking, not for the agent's own running plan.

**Take:** wire `planTool` into the CLI tool registry, and add a system-prompt fragment auto-injected by the proxy that nudges the agent to call it for multi-step requests.

### 3.5 Virtual filesystem

`FilesystemMiddleware` injects `ls`, `read_file`, `write_file`, `edit_file`, `glob`, `grep`. The data store is a backend implementing `BackendProtocol`:

- `StateBackend()` — files live in agent state, ephemeral per thread (default).
- `FilesystemBackend(root_dir, virtual_mode=True)` — real disk with path sandboxing (`..`/`~`/absolute outside root blocked).
- `StoreBackend(namespace=lambda rt: (rt.server_info.user.identity,))` — LangGraph Store, durable cross-thread.
- `LocalShellBackend(root_dir, env)` — disk + `execute` shell tool, untrusted.
- `CompositeBackend(default, routes={"/memories/": StoreBackend(...)})` — longest-prefix routing.

Read paths over 20k tokens are auto-offloaded to the FS and replaced with a reference in the message history.

**Our equivalent:** `core/util/scanning/ScanningIde.ts` is the central decorator wrapping `IDE.readFile`/`readRangeInFile`/`getCurrentFile` — every IDE tool, context provider, indexing pass, and autocomplete read flows through it; the `ScanPurpose` enum (`llm`/`indexing`/`autocomplete`/`config`/`raw`) drives the decision matrix. CLI gets the same chokepoint via `extensions/cli/src/services/ScanningFileIo.ts`. We don't currently expose `glob` and `grep` tools to the CLI agent. We have no auto-offload — but our scanning decorator could grow that.

**Take:** add `glob` and `grep` tools to `extensions/cli/src/tools/` (already in IDE). Optional: implement auto-offload in `ScanningIde.ts` (write large reads into `proxy/data/projects/<proj>/scratch/` and substitute a reference), gated by a new `policy.json` `auto_offload_threshold_tokens`.

### 3.6 Sandboxes

deepagents ships partner adapters: `langchain-modal`, `langchain-daytona`, `langchain-runloop`, AWS AgentCore, LangSmith. Each implements `SandboxBackendProtocol.execute(cmd) -> {output, exit_code, truncated}`. The same backend then provides the FS tools — i.e. `read_file` reads inside the sandbox, not on the host.

**Our equivalent:** `proxy/src/services/agentService.ts` already does git-worktree isolation per sub-agent (cheap and fast). `packages/terminal-security` sandboxes terminal commands. Modal/Daytona would be redundant (same threat model: isolate untrusted writes from the user's checkout) and costly (paid services) and Python-side.

**Don't take:** the sandbox backend zoo. Worktrees are a better fit for our self-hosted deployment.

### 3.7 Permissions

`FilesystemPermission(operations=["read","write"], paths=["/workspace/**"], mode="allow")` — first-match-wins, permissive default, subagents inherit by reference (specifying replaces, no merge), and **only covers built-in FS tools** (custom & MCP tools bypass it).

**Our equivalent:** `core/tools/toolPermissions.ts` + `proxy/src/permissions/toolPermissions.ts` — 3-level chain (config rules → auto-classifier dangerous file/command → user dialog), default-deny on timeout, covers every tool including MCP via the gateway, and integrates with `approvalService` for HITL. We're already strictly better.

**Don't take.** Mention in docs as a parity item we have already solved more rigorously.

### 3.8 Memory

`MemoryMiddleware(memory=["/memory/AGENTS.md"])` reads at startup and prepends to system prompt. Updates happen through the same `edit_file` tool. Persistence is delegated to the agent state + `BaseStore` (Redis / Postgres / `InMemoryStore`). Three scoping patterns: agent-scoped (`(assistant_id,)`), user-scoped (`(user_id,)`), org (typically read-only via app code).

**Our equivalent:** `proxy/src/memory/` is more developed — 4 types (user/feedback/project/reference), `MEMORY.md` index, auto-extraction from conversation in `memoryExtractor.ts`, persisted in `proxy/data/projects/<proj>/memory/`, REST API at `/api/memory`. We do NOT auto-prepend memory into the system prompt — the GUI/CLI surfaces it as context items.

**Take:** add an opt-in `memory_in_system_prompt: true` policy switch that prepends the project's `MEMORY.md` (or selected memories) at chat-start. Don't take LangGraph Store — our SQLite + flat files already work and avoid a Python dep.

### 3.9 Skills

`SkillsMiddleware(skills=["/skills/"])` — directory of folders, each with `SKILL.md` (frontmatter + body). At startup the middleware reads only frontmatter; when the user prompt matches a skill description, it loads the full body and exposes referenced files. "Progressive disclosure."

**Our equivalent:** `proxy/src/skills/` already implements the same `SKILL.md` format with `skillLoader.ts` and bundled `commit`/`explain`. We have a `/api/skills/invoke` route. We do NOT have the auto-match middleware that injects skill content mid-turn.

**Take:** add a `skillMatcher` middleware in `proxy/src/middleware/` that scans the latest user message against skill `description` frontmatter and, on match, injects the skill body as a system message. Should be tightly bounded (max 1 skill per turn, max 4k tokens, opt-in via `policy.json`).

### 3.10 Human-in-the-loop

```python
agent = create_deep_agent(
    model=...,
    tools=[delete_file, send_email],
    interrupt_on={
        "delete_file": True,
        "send_email": {"allowed_decisions": ["approve", "reject"]},
    },
    checkpointer=MemorySaver(),
)

# When interrupted:
result = agent.invoke(Command(resume={"decisions": [
    {"type": "edit", "edited_action": {"name": "send_email", "args": {...}}}
]}), config={"configurable": {"thread_id": tid}}, version="v2")
```

Three decision types: `approve`, `edit` (modify args), `reject`. Decisions list ordering must match `action_requests`.

**Our equivalent:** `approvalService.ts` + `approval_requests` table + WS `approval_needed`. Supports allow/deny + remembered "allow_always" / "deny_always". We do **not** support `edit` (modifying tool args before exec).

**Take:** add an `edit` decision type to `approvalService.resolve()` that returns modified args back to the caller; surface in GUI `ApprovalDialog` and CLI prompt.

### 3.11 Streaming

LangGraph's `agent.stream(input, stream_mode="updates"|"messages"|"custom", subgraphs=True, version="v2")`. Each chunk: `{type, ns, data}`. Subagent events carry `ns=("tools:abc123",)` so the consumer can route them. Tool-call streaming arrives in-band as `token.tool_call_chunks` with incremental JSON arg deltas. Custom events emitted from inside tools via `langgraph.config.get_stream_writer()`.

**Our equivalent:** Per-provider streaming in `core/llm/llms/*.ts` (OpenAI SDK / Anthropic delta / Gemini block / Ollama none). No unified subagent namespacing at the proxy. No `tool_call_chunks` taxonomy — adapters reconstitute final tool calls.

**Take:** define an `X-AF-Stream-Event` SSE channel on `/v1/chat/completions` that carries `{type: "subagent.start"|"subagent.token"|"todo.update"|"tool.call.delta", ns, data}` events alongside the OpenAI-shaped `data:` lines, and adopt deepagents' namespacing for subagent lineage.

### 3.12 Frontend (Agent Chat UI)

```ts
const stream = useStream<typeof agent>({
  apiUrl: "http://localhost:2024",
  assistantId: "agent",
});

stream.subagents; // specialist subagent data
stream.values?.todos; // live planning state
filterSubagentMessages(stream.messages, ns);
```

Three patterns documented: collapsible subagent cards, live todo list, IDE-like sandbox view. Real-time, WS-driven. The `useStream` hook is from `@langchain/langgraph-sdk` (TypeScript — they ship it).

**Our equivalent:** `gui/src/components/agents/CoordinatorView.tsx` polls `/api/agents` every 5s. `AgentManagerPage` for spawn UI. No real-time stream hook.

**Take:** add a `gui/src/hooks/useAgentStream.ts` that connects to a new `/api/agents/stream` SSE endpoint, mirroring the `useStream` shape. Subagent collapsible cards in `CoordinatorView.tsx` should subscribe to it. Drop the 5s polling.

### 3.13 ACP (Agent Client Protocol)

Stdio-based: server reads JSON-RPC requests on stdin, writes responses on stdout. Editor (Zed) registers via `settings.json`:

```json
{
  "agent_servers": {
    "DeepAgents": {
      "type": "custom",
      "command": "/path/to/deepagents/libs/acp/run_demo_agent.sh"
    }
  }
}
```

Server boilerplate uses `AgentServerACP(agent)` and `await run_agent(server)`.

**Our equivalent:** none. JetBrains uses our own LSP-shaped IPC; VS Code uses the in-process webview.

**Take (optional):** a `extensions/acp-server/` Node binary that wraps the existing CLI agent (or a thin proxy client) and speaks ACP over stdio. Useful for Zed and any future ACP-compatible editor (Cursor has hinted). Low priority unless user demand emerges.

### 3.14 CLI

Architecture: Textual TUI + persistent threads + per-agent dirs in `~/.deepagents/<agent_name>/`. Slash commands documented: `/model`, `/remember`, `/skill:name`, `/offload`, `/trace`. Subcommands: `deepagents agents list`, `deepagents skills create NAME`, `deepagents threads list`, `deepagents update`. Provider list = 24 (Azure, Vertex, Bedrock, HF, Groq, Mistral, Cohere, Fireworks, DeepSeek, Ollama, Baseten, IBM, Nvidia, xAI, Perplexity, OpenRouter, LiteLLM, Together, plus the big 3). Config in `~/.deepagents/config.toml` with `[models]`, `[models.providers.<name>]`, `[ui]`, `[update]`, `[skills]`, plus `~/.deepagents/.env` and `~/.deepagents/hooks.json`.

MCP: auto-discovers three locations (`~/.deepagents/.mcp.json`, `<proj>/.deepagents/.mcp.json`, `<proj>/.mcp.json`); transports `stdio` (default) / `sse` / `http`; project servers gated by SHA-256 fingerprint trust prompt; `--trust-project-mcp` for CI; `--no-mcp` to disable.

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
    },
    "remote-api": {
      "type": "sse",
      "url": "https://api.example.com/mcp",
      "headers": { "Authorization": "Bearer token" }
    }
  }
}
```

**Our equivalent:** CLI uses `extensions/cli/src/commands.ts` (19 commands); MCP via `core/context/mcp/MCPConnection.ts` (transports parity). Proxy `builtinCommands.ts` doesn't yet ship `/mcp`, `/agents`, `/spawn`, `/skills` as commands. Bundled MCP plugins: only `filesystem`.

**Take:** (a) add `.mcp.json` discovery in proxy startup with the same precedence chain, (b) implement `/mcp` and `/agents` slash commands in `proxy/src/commands/builtinCommands.ts`, (c) add a SHA-256 fingerprint trust store for project MCP configs in a new `proxy/src/services/mcpTrustService.ts`.

---

## 4. Concrete Integration Plan

Four phases proposed for `SECURITY_HARDENING_PLAN.md`. Each is independently shippable; do them in order.

### Phase I — Agent Harness Parity (effort: M, ~2 weeks)

**I1. Unified model resolver**

- Add `proxy/src/gateway/modelResolver.ts` with `resolveModel("provider:model-id") → LLMConfig`.
- Wire into `core/llm/llms/index.ts` and CLI `/model` command.
- Default fallback to current org default (mirrors `get_default_model()`).
- Acceptance: `curl localhost:8080/v1/chat/completions -d '{"model":"openai:gpt-4o",...}'` resolves correctly across all 60+ existing providers.

**I2. Declarative subagent registry**

- Add `proxy/src/agents/registry.ts` reading `<workspace>/.ai-firewall/subagents.yaml` with the deepagents `SubAgent` shape (`name`, `description`, `system_prompt`, optional `tools`/`model`/`skills`).
- Inject `task(name, instructions)` tool into the model request when subagents are registered. Implementation calls `agentService.spawn()` with the subagent's prompt/model/tools.
- Files: `core/tools/implementations/taskTool.ts`, `proxy/src/agents/registry.ts`, GUI `AgentRegistryPage`.
- Acceptance: agent calls `task(name="researcher", instructions="...")` → child worker spawns with researcher's system prompt + scoped tools, parent gets only the final result.

**I3. Async subagent state channel**

- Extend `proxy/src/services/agentService.ts` with `async_tasks` state field persisted on session.
- Add 5 tools mirroring deepagents: `start_async_task`, `check_async_task`, `update_async_task`, `cancel_async_task`, `list_async_tasks`.
- Survive `compactService` runs by living outside the message log.
- Acceptance: parent can spawn 3 background tasks, ask for status while they run, cancel one, and see the surviving 2 finish.

**I4. Planning middleware in CLI**

- Move `core/tools/implementations/planTool.ts` into the shared CLI tool registry (`extensions/cli/src/tools/`).
- Inject a system-prompt fragment from `proxy/src/middleware/planningPrompt.ts` that nudges multi-step plan creation.
- Acceptance: CLI agent autonomously calls `planTool` for tasks ≥3 steps; todos visible via `/todos`.

### Phase J — MCP & Commands Parity (effort: S/M, ~1 week)

**J1. `.mcp.json` discovery**

- New `proxy/src/services/mcpDiscoveryService.ts` scanning `~/.ai-firewall/.mcp.json`, `<proj>/.ai-firewall/.mcp.json`, `<proj>/.mcp.json` (Claude-compatible).
- Merge with longer-precedence overriding; expose registered servers via `GET /api/mcp/servers`.
- Acceptance: dropping a `.mcp.json` in workspace root auto-loads the server on next chat without restart.

**J2. Project MCP trust store**

- `proxy/src/services/mcpTrustService.ts` storing SHA-256 of each project config in `proxy/data/mcp_trust.db` (table `mcp_trust(fingerprint, project_path, decision, decided_at)`).
- Prompt user on first encounter (CLI dialog + GUI banner). `--trust-project-mcp` env flag for CI.
- Acceptance: changing the `.mcp.json` content invalidates trust and re-prompts.

**J3. Missing slash commands in proxy**

- Add `/mcp`, `/agents`, `/spawn`, `/skills` to `proxy/src/commands/builtinCommands.ts`.
- `/mcp` lists discovered servers + tools; `/agents` lists registry + active workers; `/spawn <name>` triggers async subagent; `/skills` lists loaded skills.
- Acceptance: GUI command palette shows all 4 in addition to existing 15.

**J4. CLI tool parity**

- Port missing tools to `extensions/cli/src/tools/`: `spawnAgent`, `planTool`, `memory`, `skillTool`, `readSkill`, `worktree`, `globSearch`, `grepSearch` (the 8 most useful).
- Acceptance: CLI tool count rises from 14 to 22; coverage matches IDE for the planning/memory/spawn surface.

### Phase K — Streaming, Frontend, HITL (effort: M, ~1.5 weeks)

**K1. Unified streaming taxonomy**

- Define `proxy/src/gateway/streamEvents.ts` with `{type, ns, data}` events: `subagent.start`/`subagent.token`/`subagent.end`/`tool.call.delta`/`tool.call.final`/`todo.update`/`memory.update`.
- Emit alongside existing OpenAI SSE on `/v1/chat/completions` via a new `X-AF-Stream` opt-in header (default off for back-compat).
- Acceptance: `curl … -H 'X-AF-Stream: events'` returns interleaved event lines parseable by a JS consumer.

**K2. `useAgentStream` React hook**

- New `gui/src/hooks/useAgentStream.ts` modelled on `useStream`: `{messages, subagents, todos, status}`.
- Backed by a new `GET /api/agents/stream` SSE endpoint (or upgrade the existing WS).
- Migrate `CoordinatorView.tsx` and `AgentManagerPage.tsx` off the 5s poll.
- Acceptance: subagent events appear in the GUI within 100ms of emission; CPU usage on idle drops vs polling baseline.

**K3. HITL `edit` decision**

- Extend `approvalService.resolve(decision: "allow" | "deny" | "edit", editedArgs?)`.
- Plumb through `approval_requests.action` enum + WS `approval_resolved` payload.
- GUI `ApprovalDialog`: show editable JSON of args when `edit` is allowed.
- Acceptance: user can intercept a tool call, modify its arguments, approve the edited form; downstream tool sees the modified args.

### Phase L — ACP Adapter & Skill Auto-match (effort: M, ~1 week)

**L1. ACP server binary**

- New `extensions/acp-server/` Node project speaking ACP over stdio. Wraps the proxy HTTP API.
- Ships a `run_acp_server.sh` registration snippet for Zed `settings.json`.
- Acceptance: Zed `Agents` panel can run AI Firewall as a custom agent; one-turn chat works.

**L2. Skill auto-match middleware**

- New `proxy/src/middleware/skillMatcher.ts`: at chat-start, scan latest user message against loaded skills' frontmatter `description`, inject best match (max 1, max 4k tokens) as a system message.
- Opt-in via `policy.json` `skills.auto_match: true`. Defense: skills already pass through scanner pipeline at load.
- Acceptance: prompting "make me a commit" auto-injects the bundled `commit` skill body; metric `X-AF-Skill-Matched` header set.

**L3. Memory auto-prepend**

- Opt-in `memory.auto_prepend_in_system_prompt: true` policy switch.
- Reads `MEMORY.md` index + selected entries (≤ 8k tokens), prepends to system prompt.
- Acceptance: enabling the flag and adding a memory makes it visible to the next assistant turn without an explicit `@memory` reference.

---

## 5. What We Should NOT Take

| Item                                                                | Why not                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| LangGraph `BaseStore` (Redis / Postgres / InMemoryStore) for memory | Adds a Python dep (or a TS port). Our SQLite + memdir already works, is encrypted at rest, and integrates with our 4-type memory schema. Replacing would be a regression.                                                                              |
| Modal / Daytona / Runloop / AgentCore sandboxes                     | Threat model overlap with our git-worktree isolation; those are paid third-party services that defeat self-hosted positioning. Worktrees are local, free, and instant.                                                                                 |
| `_PermissionMiddleware` filesystem rules                            | Our `core/tools/toolPermissions.ts` 3-level chain is strictly stronger (covers MCP, dangerous-command auto-classify, default-deny on timeout, remembered rules). Permissive default + first-match-wins is _less_ safe than what we ship.               |
| Python ACP server runtime                                           | A Node binary in `extensions/acp-server/` keeps the monorepo single-language. No need to bundle a Python process.                                                                                                                                      |
| LangGraph runtime itself (the agent loop)                           | We already have a working agent loop in `core/`. Adopting LangGraph would mean a months-long rewrite for no security gain. We adopt **patterns**, not the runtime.                                                                                     |
| `langchain-mcp-adapters` Python lib                                 | We already have `core/context/mcp/MCPConnection.ts` with all 4 transports + OAuth. Their lib is a Python client; ours is TS.                                                                                                                           |
| Auto-summarization at 85% context                                   | We deliberately don't truncate per principle #3 in CLAUDE.md (proxy informs via `X-AF-Context-Overflow`, client decides). Adopting auto-summarization would violate that. We can OFFER it as an opt-in `compactService` strategy, but never auto-fire. |
| `Tavily` web search as a built-in CLI tool                          | We can wrap web search via MCP if needed; baking a paid-API key into the CLI weakens our self-hosted story.                                                                                                                                            |

---

## 6. Open Questions for the Owner

1. **Subagent declaration source** — should `subagents.yaml` live in `<workspace>/.ai-firewall/` (project-scoped) or `~/.ai-firewall/` (user-scoped) or both with merge? deepagents uses programmatic registration; we need a file format.
2. **ACP priority** — is Zed/Cursor support a real ask, or speculative? Phase L1 is wasted work if nobody's asking.
3. **Streaming back-compat** — adding `X-AF-Stream: events` opt-in keeps existing clients working, but eventually we'll want to push GUI to event-mode by default. Acceptable timeline?
4. **HITL `edit` UX** — for tool-arg editing, do we want a structured JSON editor in the GUI, or a free-form textarea? Structured is safer (schema-validated against the tool's Zod) but takes more work.
5. **Memory auto-prepend default** — should this flip ON by default for new installs? Risk: leaks project-specific memory into prompts the user didn't expect to receive it.
6. **`provider:model-id` parser scope** — do we standardize this string format across all monorepo entry points (CLI, IDE, REST, JetBrains), or only at the proxy boundary?
7. **Skill matcher model** — frontmatter description matching can be (a) regex/keyword, (b) embedding similarity (we have `embeddingDetector.ts`), or (c) the LLM itself decides. Embedding is the deepagents-style choice; cheaper than LLM but adds an inference step.
8. **Async subagent persistence** — should `async_tasks` survive process restart (write to SQLite) or only the current proxy uptime? Cross-restart durability means agents can resume background work after crash, but adds DB write traffic.
9. **CLI `.mcp.json` trust UX** — do we mirror deepagents' SHA-256 fingerprint exactly, or extend with proxy-side scanning of the spawned MCP server's manifest (so policy can deny)?
10. **Worktree vs sandbox-as-tool naming** — deepagents calls it "sandbox", we call it "worktree". For docs/marketing parity, do we adopt their terminology in user-facing surfaces?

---

_End of analysis. Total ~3,400 words._
