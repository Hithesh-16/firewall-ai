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
 *   /diff     — Show git diff
 *   /share    — Export session as JSON snapshot
 *   /resume   — Resume a previous session
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
import {
  disablePlugin,
  enablePlugin,
  listPlugins,
} from "../plugins/pluginLoader";
import { migrateConfigKeys } from "../services/keyMigrationService";

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

// ── /plan ──────────────────────────────────────────────────────

const planCommand: PromptCommand = {
  name: "plan",
  description:
    "Force the agent to propose an approval-gated plan before touching anything",
  type: "prompt",
  source: "builtin",
  progressMessage: "Drafting plan...",

  async getPrompt(args: string, _context: CommandContext): Promise<string> {
    const task =
      args.trim().length > 0
        ? args.trim()
        : "(no task provided — ask the user to describe what they want planned)";
    return [
      "The user invoked /plan. You are now in structured planning mode for this turn.",
      "",
      "Rules:",
      "  1. Call the `propose_plan` tool BEFORE any other tool call. Do not read files, run commands, or edit anything first.",
      "  2. After `propose_plan`, STOP and wait for the user to approve or revise. Do not chain additional tool calls in the same turn.",
      "  3. The plan must include: a short title, a 1-3 sentence summary (intent + impact + files/areas touched), and an ordered task list with {content, status: 'pending'} entries.",
      "  4. Set an honest risk level: 'high' for auth/schema/CI/deletes, 'medium' for multi-file refactors, 'low' for isolated changes.",
      "  5. Do NOT write code in this turn. If the task is trivial enough that a plan is overkill, say so in one sentence and ask the user to re-send without /plan.",
      "",
      `Task: ${task}`,
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

// ── /diff ──────────────────────────────────────────────────────

const diffCommand: LocalCommand = {
  name: "diff",
  description: "Show git diff (staged, unstaged, or between refs)",
  type: "local",
  source: "builtin",

  async call(
    args: string,
    _context: CommandContext,
  ): Promise<LocalCommandResult> {
    const { execSync } = await import("node:child_process");
    const scope = args.trim() || "";

    try {
      // Build the git diff command
      let cmd: string;
      if (scope === "staged" || scope === "--staged") {
        cmd = "git diff --staged";
      } else if (scope === "head" || scope === "HEAD") {
        cmd = "git diff HEAD";
      } else if (scope) {
        // Allow arbitrary refs: e.g. "main..HEAD", "abc123"
        cmd = `git diff ${scope}`;
      } else {
        // Default: show both staged and unstaged
        cmd = "git diff HEAD";
      }

      const output = execSync(cmd, {
        encoding: "utf-8",
        maxBuffer: 1024 * 1024, // 1MB
        timeout: 10_000,
      }).trim();

      if (!output) {
        return {
          output: "No changes found.",
          success: true,
          data: { linesChanged: 0 },
        };
      }

      // Count changed lines
      const additions = (output.match(/^\+[^+]/gm) ?? []).length;
      const deletions = (output.match(/^-[^-]/gm) ?? []).length;

      return {
        output: `${output}\n\n+${additions} -${deletions} lines changed`,
        success: true,
        data: { additions, deletions },
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("not a git repository")) {
        return { output: "Not a git repository.", success: false };
      }
      return { output: `git diff failed: ${msg}`, success: false };
    }
  },
};

// ── /share ─────────────────────────────────────────────────────

const shareCommand: LocalCommand = {
  name: "share",
  description: "Export current session as a shareable JSON snapshot",
  type: "local",
  source: "builtin",

  async call(
    args: string,
    context: CommandContext,
  ): Promise<LocalCommandResult> {
    const { writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");

    const messages = context.extra?.messages as unknown[] | undefined;
    if (!messages || messages.length === 0) {
      return {
        output:
          "No conversation messages to share. Pass messages via the API:\n  POST /api/commands/execute { input: '/share', extra: { messages } }",
        success: true,
      };
    }

    const snapshot = {
      version: 1,
      exportedAt: new Date().toISOString(),
      model: context.model,
      messageCount: messages.length,
      messages,
    };

    const format = args.trim().toLowerCase();

    if (format === "json" || format === "") {
      // Write to file
      const fileName = `session-${Date.now()}.json`;
      const filePath = join(context.projectPath || process.cwd(), fileName);
      writeFileSync(filePath, JSON.stringify(snapshot, null, 2), "utf-8");

      return {
        output: `Session exported to ${filePath} (${messages.length} messages)`,
        success: true,
        data: { filePath, messageCount: messages.length },
      };
    }

    if (format === "clipboard") {
      // Return JSON for the client to copy
      return {
        output: JSON.stringify(snapshot, null, 2),
        success: true,
        data: { format: "clipboard", messageCount: messages.length },
      };
    }

    return {
      output:
        "Usage: /share [json|clipboard]\n  json — save to file (default)\n  clipboard — output JSON for copy",
      success: true,
    };
  },
};

// ── /resume ────────────────────────────────────────────────────

const resumeCommand: LocalCommand = {
  name: "resume",
  description: "Resume a previous session from an exported snapshot",
  type: "local",
  source: "builtin",

  async call(
    args: string,
    context: CommandContext,
  ): Promise<LocalCommandResult> {
    const { readdirSync, readFileSync } = await import("node:fs");
    const { join } = await import("node:path");

    const dir = context.projectPath || process.cwd();
    const target = args.trim();

    if (target) {
      // Resume specific file
      try {
        const filePath = target.startsWith("/") ? target : join(dir, target);
        const raw = readFileSync(filePath, "utf-8");
        const snapshot = JSON.parse(raw) as {
          version: number;
          exportedAt: string;
          model: string;
          messageCount: number;
          messages: unknown[];
        };

        return {
          output: `Loaded session from ${filePath}\n  ${snapshot.messageCount} messages, exported ${snapshot.exportedAt}\n  Model: ${snapshot.model}`,
          success: true,
          data: {
            messages: snapshot.messages,
            model: snapshot.model,
            source: filePath,
          },
        };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return { output: `Failed to load session: ${msg}`, success: false };
      }
    }

    // List available session files
    try {
      const files = readdirSync(dir)
        .filter((f) => f.startsWith("session-") && f.endsWith(".json"))
        .sort()
        .reverse()
        .slice(0, 10);

      if (files.length === 0) {
        return {
          output:
            "No saved sessions found. Use /share to export a session first.",
          success: true,
        };
      }

      const lines = files.map((f) => `  ${f}`);
      return {
        output: `Available sessions:\n${lines.join("\n")}\n\nUsage: /resume <filename>`,
        success: true,
        data: { files },
      };
    } catch {
      return {
        output: "Could not scan for session files.",
        success: false,
      };
    }
  },
};

// ── /security-audit ───────────────────────────────────────────

const securityAuditCommand: ActionCommand = {
  name: "security-audit",
  aliases: ["audit", "sec-audit"],
  description:
    "Full-repo security audit — secrets, vulnerabilities, weak code, attack surface",
  type: "action",
  source: "builtin",

  async call(
    args: string,
    context: CommandContext,
  ): Promise<LocalCommandResult> {
    const { runSecurityAudit } =
      await import("../scanner/securityAuditScanner");

    const projectPath = args.trim() || context.projectPath || process.cwd();

    try {
      const result = await runSecurityAudit(projectPath, {
        maxFiles: 5000,
        maxFileSize: 1024 * 1024,
        includeInfoFindings: false,
      });

      const s = result.summary;

      // Build severity breakdown
      const severityLine = [
        s.bySeverity.critical > 0 ? `${s.bySeverity.critical} critical` : null,
        s.bySeverity.high > 0 ? `${s.bySeverity.high} high` : null,
        s.bySeverity.medium > 0 ? `${s.bySeverity.medium} medium` : null,
        s.bySeverity.low > 0 ? `${s.bySeverity.low} low` : null,
      ]
        .filter(Boolean)
        .join(", ");

      // Build top findings (up to 20)
      const topFindings = result.findings.slice(0, 20).map((f, i) => {
        const sev = f.severity.toUpperCase();
        const loc = f.lineNumber ? `${f.filePath}:${f.lineNumber}` : f.filePath;
        return `  ${i + 1}. [${sev}] ${f.title}\n     ${loc}\n     ${f.recommendation}`;
      });

      const output = [
        `Security Audit Report`,
        `${"=".repeat(50)}`,
        `Risk Score: ${s.riskScore}/100 (Grade: ${s.grade})`,
        `Files scanned: ${result.filesScanned} | Skipped: ${result.filesSkipped}`,
        `Tech stack: ${result.techStack.join(", ") || "unknown"}`,
        `Duration: ${result.scanDuration}ms`,
        ``,
        `Findings: ${s.totalFindings} total (${severityLine || "none"})`,
        ``,
        ...(topFindings.length > 0
          ? [`Top findings:`, ...topFindings]
          : ["No security issues found."]),
        ...(result.findings.length > 20
          ? [
              ``,
              `... and ${result.findings.length - 20} more. Use the API (POST /api/security-audit) for full results.`,
            ]
          : []),
      ];

      return {
        output: output.join("\n"),
        success: true,
        data: {
          grade: s.grade,
          riskScore: s.riskScore,
          totalFindings: s.totalFindings,
          bySeverity: s.bySeverity,
          techStack: result.techStack,
          filesScanned: result.filesScanned,
        },
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return { output: `Security audit failed: ${msg}`, success: false };
    }
  },
};

// ── /security-review ──────────────────────────────────────────

const securityReviewCommand: ActionCommand = {
  name: "security-review",
  aliases: ["sec-review"],
  description:
    "Security review on changed files — scans git diff for vulnerabilities",
  type: "action",
  source: "builtin",

  async call(
    args: string,
    context: CommandContext,
  ): Promise<LocalCommandResult> {
    const { execSync } = await import("node:child_process");
    const { writeFileSync, unlinkSync, mkdtempSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const { runSecurityAudit } =
      await import("../scanner/securityAuditScanner");

    const projectPath = context.projectPath || process.cwd();

    // Get changed files from git
    let changedFiles: string[];
    try {
      const scope = args.trim() || "HEAD";
      const raw = execSync(`git diff --name-only ${scope}`, {
        cwd: projectPath,
        encoding: "utf-8",
        timeout: 10_000,
      }).trim();

      if (!raw) {
        return {
          output: "No changed files found. Nothing to review.",
          success: true,
          data: { filesReviewed: 0 },
        };
      }

      changedFiles = raw.split("\n").filter(Boolean);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("not a git repository")) {
        return { output: "Not a git repository.", success: false };
      }
      return {
        output: `Failed to get changed files: ${msg}`,
        success: false,
      };
    }

    // Create a temp dir with only the changed files (symlinked)
    const tmpDir = mkdtempSync(join(tmpdir(), "afw-sec-review-"));
    try {
      for (const file of changedFiles) {
        const srcPath = join(projectPath, file);
        const destPath = join(tmpDir, file);
        try {
          const { mkdirSync, copyFileSync } = await import("node:fs");
          const { dirname } = await import("node:path");
          mkdirSync(dirname(destPath), { recursive: true });
          copyFileSync(srcPath, destPath);
        } catch {
          // File might have been deleted in the diff
        }
      }

      const result = await runSecurityAudit(tmpDir, {
        maxFiles: 500,
        maxFileSize: 1024 * 1024,
        includeInfoFindings: false,
      });

      // Remap file paths back to project-relative
      const findings = result.findings.map((f) => ({
        ...f,
        filePath: f.filePath,
      }));

      if (findings.length === 0) {
        return {
          output: [
            `Security Review: ${changedFiles.length} changed file(s) scanned`,
            `No security issues found in changed files.`,
            `Grade: A`,
          ].join("\n"),
          success: true,
          data: { filesReviewed: changedFiles.length, grade: "A" },
        };
      }

      const s = result.summary;
      const severityLine = [
        s.bySeverity.critical > 0 ? `${s.bySeverity.critical} critical` : null,
        s.bySeverity.high > 0 ? `${s.bySeverity.high} high` : null,
        s.bySeverity.medium > 0 ? `${s.bySeverity.medium} medium` : null,
        s.bySeverity.low > 0 ? `${s.bySeverity.low} low` : null,
      ]
        .filter(Boolean)
        .join(", ");

      const topFindings = findings.slice(0, 15).map((f, i) => {
        const sev = f.severity.toUpperCase();
        const loc = f.lineNumber ? `${f.filePath}:${f.lineNumber}` : f.filePath;
        return `  ${i + 1}. [${sev}] ${f.title}\n     ${loc}\n     ${f.recommendation}`;
      });

      const output = [
        `Security Review: ${changedFiles.length} changed file(s)`,
        `${"=".repeat(45)}`,
        `Risk Score: ${s.riskScore}/100 (Grade: ${s.grade})`,
        `Findings: ${s.totalFindings} (${severityLine || "none"})`,
        ``,
        ...topFindings,
        ...(findings.length > 15
          ? [``, `... and ${findings.length - 15} more.`]
          : []),
      ];

      return {
        output: output.join("\n"),
        success: s.bySeverity.critical === 0,
        data: {
          grade: s.grade,
          riskScore: s.riskScore,
          totalFindings: s.totalFindings,
          filesReviewed: changedFiles.length,
        },
      };
    } finally {
      // Cleanup temp dir
      try {
        const { rmSync } = await import("node:fs");
        rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // Best effort cleanup
      }
    }
  },
};

// ── /login ────────────────────────────────────────────────────

const loginCommand: ActionCommand = {
  name: "login",
  description: "Sign in to AI Firewall (opens login page)",
  type: "action",
  source: "builtin",
  userInvocable: true,

  async call(
    _args: string,
    _context: CommandContext,
  ): Promise<LocalCommandResult> {
    return {
      output: "Navigating to login page...",
      success: true,
      data: { navigate: "/login" },
    };
  },
};

// ── /logout ───────────────────────────────────────────────────

const logoutCommand: ActionCommand = {
  name: "logout",
  aliases: ["signout"],
  description: "Sign out of AI Firewall and revoke current session",
  type: "action",
  source: "builtin",
  userInvocable: true,

  async call(
    args: string,
    context: CommandContext,
  ): Promise<LocalCommandResult> {
    const token = context.extra?.token as string | undefined;

    if (!token) {
      return {
        output: "Not authenticated. Use /login to sign in.",
        success: true,
        data: { navigate: "/login" },
      };
    }

    try {
      const res = await fetch("http://localhost:8080/api/auth/logout", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!res.ok) {
        return {
          output: "Logout failed. Clearing local session anyway.",
          success: true,
          data: { navigate: "/login", clearToken: true },
        };
      }

      const revokeAll = args.trim() === "all";
      if (revokeAll) {
        await fetch("http://localhost:8080/api/auth/logout/all", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
      }

      return {
        output: revokeAll
          ? "Logged out from all devices."
          : "Logged out successfully.",
        success: true,
        data: { navigate: "/login", clearToken: true },
      };
    } catch {
      return {
        output: "Could not reach proxy. Clearing local session.",
        success: true,
        data: { navigate: "/login", clearToken: true },
      };
    }
  },
};

// ── /mcp ────────────────────────────────────────────────────────
//
// Phase J.J3 (SECURITY_HARDENING_PLAN.md) — discoverable slash
// command for MCP server management. Sub-commands:
//   /mcp                  — list every loaded plugin and its MCP servers
//   /mcp list             — alias for the above
//   /mcp enable <name>    — enable a plugin (writes its MCP server config + reloads)
//   /mcp disable <name>   — disable a plugin (removes the config)
//   /mcp install <slug>   — install a bundled or remote plugin (NOT YET IMPLEMENTED)
//
// All MCP tool calls still route through `/v1/mcp/tools/call` so the
// firewall's MCP Security Gateway scans every input/output regardless
// of which server the agent is calling. This command only manages
// which servers are available; it does not bypass the gateway.

const mcpCommand: LocalCommand = {
  name: "mcp",
  description:
    "Manage MCP servers (list / enable / disable / install). Every MCP tool call routes through the firewall's MCP Security Gateway.",
  type: "local",
  source: "builtin",

  async call(args: string): Promise<LocalCommandResult> {
    const tokens = args.trim().split(/\s+/).filter(Boolean);
    const sub = (tokens[0] ?? "list").toLowerCase();
    const target = tokens[1] ?? "";

    if (sub === "list" || sub === "") {
      const plugins = listPlugins();
      if (plugins.length === 0) {
        return {
          success: true,
          output:
            "No plugins loaded. Bundled plugins live in `proxy/src/plugins/bundled/` " +
            "and are auto-discovered at proxy start.",
        };
      }
      const lines = plugins.map((p) => {
        const status = p.enabled ? "enabled " : "disabled";
        return `  [${status}] ${p.name}@${p.version}  —  ${p.description}`;
      });
      return {
        success: true,
        output:
          `MCP-capable plugins (${plugins.length} loaded):\n` +
          lines.join("\n") +
          `\n\nUse '/mcp enable <name>' or '/mcp disable <name>' to toggle.`,
        data: { plugins },
      };
    }

    if (sub === "enable") {
      if (!target) {
        return {
          success: false,
          output: "Usage: /mcp enable <plugin-name>",
        };
      }
      const ok = enablePlugin(target);
      return {
        success: ok,
        output: ok
          ? `Plugin '${target}' enabled. Its MCP server(s) will be available on the next chat.`
          : `Plugin '${target}' not found. Run '/mcp list' to see loaded plugins.`,
      };
    }

    if (sub === "disable") {
      if (!target) {
        return { success: false, output: "Usage: /mcp disable <plugin-name>" };
      }
      const ok = disablePlugin(target);
      return {
        success: ok,
        output: ok
          ? `Plugin '${target}' disabled. Its MCP server config has been removed.`
          : `Plugin '${target}' not found. Run '/mcp list' to see loaded plugins.`,
      };
    }

    if (sub === "install") {
      // Phase J.J5 follow-up — installer wiring lives there.
      return {
        success: false,
        output:
          "/mcp install is not yet implemented. For now, drop a plugin.json into " +
          "`proxy/src/plugins/bundled/<name>/` and restart the proxy. " +
          "Tracked under SECURITY_HARDENING_PLAN.md Phase J.",
      };
    }

    return {
      success: false,
      output:
        `Unknown subcommand '${sub}'.\n` +
        `Usage: /mcp [list | enable <name> | disable <name> | install <slug>]`,
    };
  },
};

// ── /migrate-keys ───────────────────────────────────────────────
//
// Phase C follow-up — migrates plaintext `apiKey:` entries in
// `~/.ai-firewall/config.yaml` to vault-backed `apiKeyRef: vault://`
// references. Safe to run multiple times — already-migrated entries
// are skipped. The keys are POSTed to `POST /api/providers` (the
// same vault path the onboarding wizard uses) and the YAML file is
// rewritten in place.

const migrateKeysCommand: LocalCommand = {
  name: "migrate-keys",
  description:
    "Migrate plaintext API keys in config.yaml to encrypted vault references",
  type: "local",
  source: "builtin",

  async call(
    _args: string,
    context: CommandContext,
  ): Promise<LocalCommandResult> {
    const os = await import("node:os");
    const path = await import("node:path");
    const configPath = path.join(os.homedir(), ".ai-firewall", "config.yaml");

    const result = migrateConfigKeys(configPath);

    if (result.errors.length > 0) {
      return {
        success: false,
        output:
          `Migration had ${result.errors.length} error(s):\n` +
          result.errors.map((e) => `  - ${e}`).join("\n") +
          `\n\nMigrated: ${result.migrated}, Skipped: ${result.skipped}`,
        data: { ...result } as Record<string, unknown>,
      };
    }

    if (result.migrated === 0) {
      return {
        success: true,
        output:
          "No plaintext API keys found — config.yaml is already clean. " +
          `(${result.skipped} entries skipped)`,
        data: { ...result } as Record<string, unknown>,
      };
    }

    const detailLines = result.details
      .filter((d) => d.action === "migrated")
      .map(
        (d) =>
          `  ${d.modelName} (${d.provider}) → apiKeyRef: vault://${d.slug}` +
          (d.reason ? ` (${d.reason})` : ""),
      );

    return {
      success: true,
      output:
        `Migrated ${result.migrated} key(s) to vault:\n` +
        detailLines.join("\n") +
        `\nSkipped: ${result.skipped}` +
        `\n\nConfig.yaml has been rewritten. Plaintext keys are gone from the file. ` +
        `The vault stores them encrypted (AES-256-GCM). ` +
        `Restart the IDE/CLI to pick up the new config.`,
      data: { ...result } as Record<string, unknown>,
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
  planCommand,
  diffCommand,
  helpCommand,
  shareCommand,
  resumeCommand,
  securityAuditCommand,
  securityReviewCommand,
  loginCommand,
  logoutCommand,
  mcpCommand,
  migrateKeysCommand,
];
