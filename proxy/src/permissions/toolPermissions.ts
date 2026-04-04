/**
 * Tool Permission Layer
 *
 * 3-level permission check for every tool call:
 *   1. Config rules — pattern-based allow/deny from settings
 *   2. Auto-classifier — read-only tools auto-allowed, destructive tools escalated
 *   3. Interactive dialog — push to client via WebSocket, await decision
 *
 * Modeled after claude-code's useCanUseTool but adapted for our proxy-centric
 * architecture where RBAC lives in the proxy and dialogs are pushed via WebSocket.
 *
 * SECURITY: This layer sits BETWEEN the agent/LLM and tool execution.
 * It does NOT replace the proxy's policyEnforcer (which scans content).
 * Both layers must pass for a tool call to succeed.
 */

// ── Types ──────────────────────────────────────────────────────

export type PermissionBehavior = "allow" | "deny" | "ask";

export interface PermissionDecision {
  readonly behavior: PermissionBehavior;
  readonly reason: string;
  readonly source: "rule" | "auto" | "dialog" | "default";
  readonly updatedInput?: Record<string, unknown>;
}

export interface PermissionRule {
  readonly toolName: string;
  readonly pattern?: string; // e.g. "git *" for Bash, "**/*.md" for Read
  readonly behavior: PermissionBehavior;
  readonly source: "settings" | "project" | "session" | "policy";
}

export interface ToolMetadata {
  readonly name: string;
  readonly isReadOnly: boolean;
  readonly isDestructive: boolean;
  readonly isConcurrencySafe: boolean;
}

export type PermissionMode = "default" | "auto" | "plan" | "bypass";

export interface PermissionContext {
  readonly mode: PermissionMode;
  readonly allowRules: readonly PermissionRule[];
  readonly denyRules: readonly PermissionRule[];
  readonly askRules: readonly PermissionRule[];
}

// ── Default context ────────────────────────────────────────────

export function createDefaultPermissionContext(): PermissionContext {
  return {
    mode: "default",
    allowRules: [],
    denyRules: [],
    askRules: [],
  };
}

// ── Core decision logic ────────────────────────────────────────

/**
 * Check if a tool call is permitted.
 *
 * Decision flow:
 *   1. Check deny rules → immediate deny
 *   2. Check allow rules → immediate allow
 *   3. Plan mode → only read-only tools allowed
 *   4. Auto-classify → read-only tools auto-allowed
 *   5. Bypass mode → allow everything
 *   6. Default → ask (push dialog to client)
 */
export function checkToolPermission(
  tool: ToolMetadata,
  input: Record<string, unknown>,
  context: PermissionContext,
): PermissionDecision {
  // 1. Check deny rules (highest priority — explicit deny always wins)
  const denyRule = findMatchingRule(context.denyRules, tool.name, input);
  if (denyRule) {
    return {
      behavior: "deny",
      reason: `Denied by ${denyRule.source} rule: ${denyRule.toolName}${denyRule.pattern ? `(${denyRule.pattern})` : ""}`,
      source: "rule",
    };
  }

  // 2. Check allow rules
  const allowRule = findMatchingRule(context.allowRules, tool.name, input);
  if (allowRule) {
    return {
      behavior: "allow",
      reason: `Allowed by ${allowRule.source} rule: ${allowRule.toolName}${allowRule.pattern ? `(${allowRule.pattern})` : ""}`,
      source: "rule",
    };
  }

  // 3. Plan mode — only read-only tools pass
  if (context.mode === "plan") {
    if (tool.isReadOnly) {
      return {
        behavior: "allow",
        reason: "Read-only tool allowed in plan mode",
        source: "auto",
      };
    }
    return {
      behavior: "deny",
      reason: "Write operations are not allowed in plan mode",
      source: "auto",
    };
  }

  // 4. Bypass mode — allow everything (dangerous, requires explicit opt-in)
  if (context.mode === "bypass") {
    return {
      behavior: "allow",
      reason: "Bypass mode enabled",
      source: "auto",
    };
  }

  // 5. Auto-classify: read-only tools are safe
  if (tool.isReadOnly) {
    return {
      behavior: "allow",
      reason: `Auto-allowed: ${tool.name} is read-only`,
      source: "auto",
    };
  }

  // 6. Check ask rules
  const askRule = findMatchingRule(context.askRules, tool.name, input);
  if (askRule) {
    return {
      behavior: "ask",
      reason: `Requires approval per ${askRule.source} rule`,
      source: "rule",
    };
  }

  // 7. Auto mode — auto-allow non-destructive tools
  if (context.mode === "auto" && !tool.isDestructive) {
    return {
      behavior: "allow",
      reason: `Auto-allowed: ${tool.name} is non-destructive in auto mode`,
      source: "auto",
    };
  }

  // 8. Default — ask user for destructive or unknown tools
  return {
    behavior: "ask",
    reason: `Tool ${tool.name} requires user approval`,
    source: "default",
  };
}

// ── Dangerous file detection ───────────────────────────────────

const DANGEROUS_FILES = new Set([
  ".gitconfig",
  ".bashrc",
  ".bash_profile",
  ".zshrc",
  ".profile",
  ".npmrc",
  ".env",
  ".env.local",
  ".env.production",
  "id_rsa",
  "id_ed25519",
  ".ssh/config",
  ".claude/settings.json",
]);

const DANGEROUS_DIRS = new Set([
  ".git",
  ".ssh",
  ".gnupg",
  ".claude",
  ".vscode",
  ".idea",
  "node_modules",
]);

export function isDangerousPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  const basename = normalized.split("/").pop() ?? "";

  if (DANGEROUS_FILES.has(basename)) return true;

  const parts = normalized.split("/");
  for (const part of parts) {
    if (DANGEROUS_DIRS.has(part)) return true;
  }

  return false;
}

// ── Destructive command detection ──────────────────────────────

const DESTRUCTIVE_COMMANDS = [
  /^rm\s/,
  /^git\s+(reset|clean|checkout\s+--)\s/,
  /^git\s+push\s+--force/,
  /^git\s+branch\s+-[dD]/,
  /^chmod\s/,
  /^chown\s/,
  /^kill\s/,
  /^pkill\s/,
  /^sudo\s/,
  /^docker\s+(rm|rmi|system\s+prune)/,
  /^npm\s+publish/,
  /^npx\s/,
  /^curl\s.*-X\s*(DELETE|PUT|POST)/,
  /^wget\s/,
  /^dd\s/,
  /^mkfs/,
  /^format\s/,
];

export function isDestructiveCommand(command: string): boolean {
  const trimmed = command.trim();
  return DESTRUCTIVE_COMMANDS.some((re) => re.test(trimmed));
}

// ── Read-only command detection ────────────────────────────────

const READ_ONLY_COMMANDS = [
  /^(ls|dir|cat|head|tail|less|more|wc|file|stat|du|df)\s/,
  /^(grep|rg|ag|find|locate|which|whereis|type)\s/,
  /^(git\s+(status|log|diff|show|branch|tag|remote)\s)/,
  /^(git\s+(status|log|diff|show|branch|tag|remote)$)/,
  /^(echo|printf|date|whoami|hostname|uname|env|printenv)\s/,
  /^(node|python|ruby|php)\s+-e\s/,
  /^(npm\s+(ls|list|outdated|audit|info|view))/,
  /^(pwd|id|groups)$/,
];

export function isReadOnlyCommand(command: string): boolean {
  const trimmed = command.trim();
  return READ_ONLY_COMMANDS.some((re) => re.test(trimmed));
}

// ── Pattern matching ───────────────────────────────────────────

function findMatchingRule(
  rules: readonly PermissionRule[],
  toolName: string,
  input: Record<string, unknown>,
): PermissionRule | null {
  for (const rule of rules) {
    if (matchesRule(rule, toolName, input)) return rule;
  }
  return null;
}

function matchesRule(
  rule: PermissionRule,
  toolName: string,
  input: Record<string, unknown>,
): boolean {
  // Exact tool name match (case-insensitive)
  if (rule.toolName.toLowerCase() !== toolName.toLowerCase()) return false;

  // No pattern means blanket match for this tool
  if (!rule.pattern) return true;

  // Pattern matching depends on tool type
  const inputStr = extractInputString(toolName, input);
  if (!inputStr) return true; // No input to check → blanket match

  return matchWildcard(rule.pattern, inputStr);
}

function extractInputString(
  toolName: string,
  input: Record<string, unknown>,
): string | null {
  const lower = toolName.toLowerCase();

  // Bash/shell tools → match against command
  if (lower === "bash" || lower === "terminal" || lower === "shell") {
    return typeof input.command === "string" ? input.command : null;
  }

  // File tools → match against file_path or path
  if (
    lower.includes("file") ||
    lower === "read" ||
    lower === "edit" ||
    lower === "write"
  ) {
    return typeof input.file_path === "string"
      ? input.file_path
      : typeof input.path === "string"
        ? input.path
        : null;
  }

  // Glob/grep → match against pattern
  if (lower === "glob" || lower === "grep") {
    return typeof input.pattern === "string" ? input.pattern : null;
  }

  // MCP tools → match against full tool name
  if (lower.startsWith("mcp__")) {
    return toolName;
  }

  return null;
}

/**
 * Simple wildcard matcher (supports * and **).
 * "git *" matches "git status", "git push --force"
 * "**.md" matches "README.md", "docs/guide.md"
 */
function matchWildcard(pattern: string, text: string): boolean {
  // Convert wildcard to regex
  // For tool permissions, * should match anything (including spaces)
  // because command patterns like "rm *" need to match "rm -rf /tmp"
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "§§") // Preserve ** for later
    .replace(/\*/g, ".*") // * matches anything (including spaces and /)
    .replace(/§§/g, ".*"); // ** also matches anything

  const re = new RegExp(`^${escaped}$`, "i");
  return re.test(text);
}

// ── Rule parsing from settings ─────────────────────────────────

/**
 * Parse a rule string like "Bash(git *)" or "Read" or "mcp__server__*"
 *
 * Format: ToolName or ToolName(pattern)
 */
export function parseRuleString(
  ruleStr: string,
  behavior: PermissionBehavior,
  source: PermissionRule["source"],
): PermissionRule | null {
  const match = ruleStr.match(/^(\w+)(?:\((.+)\))?$/);
  if (!match) return null;

  return {
    toolName: match[1],
    pattern: match[2] ?? undefined,
    behavior,
    source,
  };
}

/**
 * Build a PermissionContext from settings objects.
 */
export function buildPermissionContext(
  mode: PermissionMode,
  allowRuleStrings: readonly string[],
  denyRuleStrings: readonly string[],
  askRuleStrings: readonly string[],
  source: PermissionRule["source"] = "settings",
): PermissionContext {
  const allowRules = allowRuleStrings
    .map((s) => parseRuleString(s, "allow", source))
    .filter((r): r is PermissionRule => r !== null);

  const denyRules = denyRuleStrings
    .map((s) => parseRuleString(s, "deny", source))
    .filter((r): r is PermissionRule => r !== null);

  const askRules = askRuleStrings
    .map((s) => parseRuleString(s, "ask", source))
    .filter((r): r is PermissionRule => r !== null);

  return { mode, allowRules, denyRules, askRules };
}
