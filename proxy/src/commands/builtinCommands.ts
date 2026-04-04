/**
 * Built-in Commands
 *
 * Core slash commands available out of the box. Each command is a
 * self-contained function following the Command interface.
 *
 * Commands implemented:
 *   /doctor   — Diagnostic health check
 *   /compact  — Compact conversation context
 *   /cost     — Show session cost breakdown
 *   /stats    — Show usage statistics
 *   /memory   — List/manage persistent memories
 *   /tasks    — List/manage running tasks
 *   /review   — Code review on current diff
 *   /share    — Share session (placeholder)
 *   /resume   — Resume previous session (placeholder)
 *   /help     — List available commands
 */

import type {
  Command,
  LocalCommand,
  PromptCommand,
  ActionCommand,
  CommandContext,
  LocalCommandResult,
} from "./commandTypes";
import {
  compactConversation,
  type CompactMessage,
} from "../services/compactService";
import { getMemoryIndex, listMemories } from "../services/memoryService";
import { getUserActiveTasks, getUserTasks } from "../services/taskService";

// ── /doctor ────────────────────────────────────────────────────

const doctorCommand: LocalCommand = {
  name: "doctor",
  description: "Diagnostic health check — proxy, DB, config, environment",
  type: "local",
  source: "builtin",

  async call(
    _args: string,
    context: CommandContext,
  ): Promise<LocalCommandResult> {
    const checks: Array<{
      name: string;
      status: "ok" | "warn" | "fail";
      detail: string;
    }> = [];

    // Check 1: Proxy reachable
    try {
      const resp = await fetch("http://localhost:8080/health");
      checks.push({
        name: "Proxy",
        status: resp.ok ? "ok" : "fail",
        detail: resp.ok ? "Running on :8080" : `Status ${resp.status}`,
      });
    } catch {
      checks.push({
        name: "Proxy",
        status: "fail",
        detail: "Not reachable on :8080",
      });
    }

    // Check 2: Node version
    const nodeVersion = process.version;
    const major = parseInt(nodeVersion.slice(1), 10);
    checks.push({
      name: "Node.js",
      status: major >= 18 ? "ok" : "warn",
      detail: nodeVersion,
    });

    // Check 3: Database
    try {
      const { db } = await import("../db/index");
      const row = db.select().from(require("../db/schema").logs).limit(1).all();
      checks.push({
        name: "Database",
        status: "ok",
        detail: "SQLite connected",
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      checks.push({ name: "Database", status: "fail", detail: msg });
    }

    // Check 4: Policy file
    try {
      const { loadPolicyConfig } = await import("../config");
      const policy = loadPolicyConfig();
      checks.push({
        name: "Policy",
        status: "ok",
        detail: `v${policy.version}, threshold: ${policy.severity_threshold}`,
      });
    } catch {
      checks.push({
        name: "Policy",
        status: "warn",
        detail: "policy.json not found or invalid",
      });
    }

    // Check 5: Memory directory
    try {
      const dir = (await import("../memory/memdir")).getMemoryDir(
        context.projectPath,
      );
      const { existsSync } = await import("node:fs");
      checks.push({
        name: "Memory",
        status: existsSync(dir) ? "ok" : "warn",
        detail: existsSync(dir) ? `Dir exists: ${dir}` : "Not initialized yet",
      });
    } catch {
      checks.push({
        name: "Memory",
        status: "warn",
        detail: "Could not check",
      });
    }

    // Format output
    const lines = checks.map((c) => {
      const icon =
        c.status === "ok" ? "[OK]" : c.status === "warn" ? "[WARN]" : "[FAIL]";
      return `${icon} ${c.name}: ${c.detail}`;
    });

    const failCount = checks.filter((c) => c.status === "fail").length;
    const warnCount = checks.filter((c) => c.status === "warn").length;
    const summary =
      failCount > 0
        ? `${failCount} issue(s) found`
        : warnCount > 0
          ? `Healthy with ${warnCount} warning(s)`
          : "All systems healthy";

    return {
      output: `AI Firewall Health Check\n${"=".repeat(30)}\n${lines.join("\n")}\n\n${summary}`,
      success: failCount === 0,
      data: { checks },
    };
  },
};

// ── /compact ───────────────────────────────────────────────────

const compactCommand: ActionCommand = {
  name: "compact",
  aliases: ["c"],
  description: "Compact conversation context to save tokens",
  type: "action",
  source: "builtin",

  async call(
    args: string,
    context: CommandContext,
  ): Promise<LocalCommandResult> {
    const maxTokens = args ? parseInt(args, 10) : undefined;

    // In a real implementation, the caller would pass messages from the
    // current conversation. For now, return instructions.
    if (!context.extra?.messages) {
      return {
        output:
          "Usage: /compact [maxTokens]\n\nPass conversation messages via the API to compact them.\nExample: POST /api/compact with { messages, model, maxTokens }",
        success: true,
      };
    }

    const messages = context.extra.messages as CompactMessage[];
    const result = await compactConversation({
      messages,
      model: context.model,
      maxTokens,
    });

    return {
      output: [
        `Compacted: ${result.originalTokens} -> ${result.compactedTokens} tokens (${result.savingsPercent}% saved)`,
        `Strategies: ${result.strategiesApplied.join(", ") || "none needed"}`,
        `Tool results cleared: ${result.toolResultsCleared}`,
        `Messages summarized: ${result.messagesSummarized}`,
        `Messages removed: ${result.messagesRemoved}`,
      ].join("\n"),
      success: true,
      data: {
        originalTokens: result.originalTokens,
        compactedTokens: result.compactedTokens,
        savingsPercent: result.savingsPercent,
        messages: result.messages,
      },
    };
  },
};

// ── /cost ──────────────────────────────────────────────────────

const costCommand: LocalCommand = {
  name: "cost",
  description: "Show session cost and token usage",
  type: "local",
  source: "builtin",

  async call(
    _args: string,
    _context: CommandContext,
  ): Promise<LocalCommandResult> {
    // Session cost is tracked client-side (GUI/CLI) via X-AF-* headers.
    // This command provides a formatted summary.
    return {
      output: [
        "Session cost tracking is available in the GUI (Cost Badge) and CLI.",
        "Use the /api/usage/summary endpoint for detailed cost data.",
        "",
        "Response headers on every request:",
        "  X-AF-Input-Tokens: real token count",
        "  X-AF-Estimated-Cost: pre-request cost estimate",
        "  X-AF-Token-Method: tiktoken or heuristic",
      ].join("\n"),
      success: true,
    };
  },
};

// ── /stats ─────────────────────────────────────────────────────

const statsCommand: LocalCommand = {
  name: "stats",
  description: "Show firewall statistics (scanned, blocked, redacted)",
  type: "local",
  source: "builtin",

  async call(
    _args: string,
    _context: CommandContext,
  ): Promise<LocalCommandResult> {
    try {
      const { db } = await import("../db/index");
      const { logs } = await import("../db/schema");
      const { sql } = await import("drizzle-orm");

      const totalsRow = db
        .select({
          total: sql<number>`COUNT(*)`,
          blocked: sql<number>`SUM(CASE WHEN ${logs.action} = 'BLOCK' THEN 1 ELSE 0 END)`,
          redacted: sql<number>`SUM(CASE WHEN ${logs.action} = 'REDACT' THEN 1 ELSE 0 END)`,
          allowed: sql<number>`SUM(CASE WHEN ${logs.action} = 'ALLOW' THEN 1 ELSE 0 END)`,
          avgRisk: sql<number>`COALESCE(AVG(${logs.riskScore}), 0)`,
        })
        .from(logs)
        .get();

      const t = totalsRow ?? {
        total: 0,
        blocked: 0,
        redacted: 0,
        allowed: 0,
        avgRisk: 0,
      };

      const lines = [
        `Total requests: ${t.total}`,
        `Blocked: ${t.blocked}`,
        `Redacted: ${t.redacted}`,
        `Allowed: ${t.allowed}`,
        `Avg risk score: ${Math.round(Number(t.avgRisk) * 100) / 100}`,
      ];

      return {
        output: lines.join("\n"),
        success: true,
        data: t as Record<string, unknown>,
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { output: `Stats query failed: ${msg}`, success: false };
    }
  },
};

// ── /memory ────────────────────────────────────────────────────

const memoryCommand: LocalCommand = {
  name: "memory",
  aliases: ["mem"],
  description: "List and manage persistent memories",
  type: "local",
  source: "builtin",

  async call(
    args: string,
    context: CommandContext,
  ): Promise<LocalCommandResult> {
    const subcommand = args.trim().split(/\s+/)[0]?.toLowerCase() ?? "list";

    if (subcommand === "index") {
      const index = getMemoryIndex(context.projectPath);
      return {
        output: index.content || "(No memories yet)",
        success: true,
        data: { lineCount: index.lineCount, wasTruncated: index.wasTruncated },
      };
    }

    // Default: list memories
    const typeFilter = args.trim() as
      | "user"
      | "feedback"
      | "project"
      | "reference"
      | undefined;
    const validTypes = ["user", "feedback", "project", "reference"];
    const filter = validTypes.includes(typeFilter ?? "")
      ? typeFilter
      : undefined;

    const memories = listMemories(context.projectPath, filter as any);

    if (memories.length === 0) {
      return {
        output: filter
          ? `No ${filter} memories found.`
          : "No memories yet. They'll be created as you work.",
        success: true,
      };
    }

    const lines = memories.map(
      (m) =>
        `[${m.frontmatter.type}] ${m.frontmatter.name} — ${m.frontmatter.description}`,
    );

    return {
      output: `${memories.length} memories:\n${lines.join("\n")}`,
      success: true,
      data: { count: memories.length },
    };
  },
};

// ── /tasks ─────────────────────────────────────────────────────

const tasksCommand: LocalCommand = {
  name: "tasks",
  description: "List active and recent tasks",
  type: "local",
  source: "builtin",

  async call(
    args: string,
    context: CommandContext,
  ): Promise<LocalCommandResult> {
    const userId = context.userId;
    if (!userId) {
      return { output: "Not authenticated", success: false };
    }

    const showAll = args.trim() === "all";
    const taskList = showAll
      ? getUserTasks(userId, 20)
      : getUserActiveTasks(userId);

    if (taskList.length === 0) {
      return {
        output: showAll
          ? "No tasks found."
          : "No active tasks. Use /tasks all to see history.",
        success: true,
      };
    }

    const lines = taskList.map((t) => {
      const status = t.status.toUpperCase();
      const elapsed = t.completedAt
        ? `${Math.round((t.completedAt - t.startedAt) / 1000)}s`
        : `${Math.round((Date.now() - t.startedAt) / 1000)}s`;
      return `[${status}] ${t.id} — ${t.description} (${elapsed})`;
    });

    return {
      output: `${taskList.length} task(s):\n${lines.join("\n")}`,
      success: true,
      data: { count: taskList.length },
    };
  },
};

// ── /review ────────────────────────────────────────────────────

const reviewCommand: PromptCommand = {
  name: "review",
  description: "Code review on current git diff",
  type: "prompt",
  source: "builtin",
  progressMessage: "Reviewing code changes...",

  async getPrompt(args: string, _context: CommandContext): Promise<string> {
    const scope = args.trim() || "staged";
    return [
      "Review the following code changes. For each issue found, provide:",
      "1. File and line number",
      "2. Severity (critical/high/medium/low)",
      "3. Description of the issue",
      "4. Suggested fix",
      "",
      `Focus on: security vulnerabilities, bugs, performance issues, and code quality.`,
      `Scope: ${scope} changes (use git diff ${scope === "staged" ? "--staged" : ""})`,
      "",
      "Be concise. Only flag real issues, not style preferences.",
    ].join("\n");
  },
};

// ── /help ──────────────────────────────────────────────────────

const helpCommand: LocalCommand = {
  name: "help",
  aliases: ["?", "commands"],
  description: "List available commands",
  type: "local",
  source: "builtin",
  userInvocable: true,

  async call(
    _args: string,
    _context: CommandContext,
  ): Promise<LocalCommandResult> {
    // This will be populated by the command registry at runtime
    return {
      output: "Use the command registry API: GET /api/commands",
      success: true,
    };
  },
};

// ── /share (placeholder) ───────────────────────────────────────

const shareCommand: LocalCommand = {
  name: "share",
  description: "Share current session (coming soon)",
  type: "local",
  source: "builtin",

  async call(
    _args: string,
    _context: CommandContext,
  ): Promise<LocalCommandResult> {
    return {
      output: "Session sharing is not yet implemented. Coming in Phase 2.",
      success: false,
    };
  },
};

// ── /resume (placeholder) ──────────────────────────────────────

const resumeCommand: LocalCommand = {
  name: "resume",
  description: "Resume a previous session (coming soon)",
  type: "local",
  source: "builtin",

  async call(
    _args: string,
    _context: CommandContext,
  ): Promise<LocalCommandResult> {
    return {
      output: "Session resume is not yet implemented. Coming in Phase 2.",
      success: false,
    };
  },
};

// ── Export all built-in commands ────────────────────────────────

export const BUILTIN_COMMANDS: readonly Command[] = [
  doctorCommand,
  compactCommand,
  costCommand,
  statsCommand,
  memoryCommand,
  tasksCommand,
  reviewCommand,
  helpCommand,
  shareCommand,
  resumeCommand,
];
