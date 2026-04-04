/**
 * Tool Permission Layer Tests
 *
 * Tests the 3-level permission check, pattern matching, dangerous file
 * detection, destructive command detection, and rule parsing.
 */

import assert from "node:assert";
import {
  checkToolPermission,
  isDangerousPath,
  isDestructiveCommand,
  isReadOnlyCommand,
  parseRuleString,
  buildPermissionContext,
  createDefaultPermissionContext,
  type ToolMetadata,
  type PermissionContext,
} from "../permissions/toolPermissions";

// ── Helpers ────────────────────────────────────────────────────

function readOnlyTool(name = "Read"): ToolMetadata {
  return {
    name,
    isReadOnly: true,
    isDestructive: false,
    isConcurrencySafe: true,
  };
}

function writeTool(name = "Edit"): ToolMetadata {
  return {
    name,
    isReadOnly: false,
    isDestructive: false,
    isConcurrencySafe: false,
  };
}

function destructiveTool(name = "Bash"): ToolMetadata {
  return {
    name,
    isReadOnly: false,
    isDestructive: true,
    isConcurrencySafe: false,
  };
}

// ── Default context ────────────────────────────────────────────

export function testDefaultContextAllowsReadOnly() {
  const ctx = createDefaultPermissionContext();
  const decision = checkToolPermission(readOnlyTool(), {}, ctx);
  assert.strictEqual(
    decision.behavior,
    "allow",
    "Read-only tools should be auto-allowed",
  );
  assert.strictEqual(decision.source, "auto");
}

export function testDefaultContextAsksForWrite() {
  const ctx = createDefaultPermissionContext();
  const decision = checkToolPermission(writeTool(), {}, ctx);
  assert.strictEqual(
    decision.behavior,
    "ask",
    "Write tools should require approval in default mode",
  );
}

export function testDefaultContextAsksForDestructive() {
  const ctx = createDefaultPermissionContext();
  const decision = checkToolPermission(destructiveTool(), {}, ctx);
  assert.strictEqual(
    decision.behavior,
    "ask",
    "Destructive tools should require approval",
  );
}

// ── Deny rules ─────────────────────────────────────────────────

export function testDenyRuleTakesPrecedence() {
  const ctx = buildPermissionContext(
    "default",
    ["Bash"],
    ["Bash"],
    [],
    "settings",
  );
  const decision = checkToolPermission(destructiveTool("Bash"), {}, ctx);
  assert.strictEqual(
    decision.behavior,
    "deny",
    "Deny rule should override allow rule",
  );
  assert.strictEqual(decision.source, "rule");
}

export function testDenyRuleWithPattern() {
  const ctx = buildPermissionContext(
    "default",
    [],
    ["Bash(rm *)"],
    [],
    "settings",
  );
  const decision = checkToolPermission(
    destructiveTool("Bash"),
    { command: "rm -rf /tmp/test" },
    ctx,
  );
  assert.strictEqual(
    decision.behavior,
    "deny",
    "Deny pattern should block matching command",
  );
}

export function testDenyRuleDoesNotBlockNonMatch() {
  const ctx = buildPermissionContext(
    "default",
    [],
    ["Bash(rm *)"],
    [],
    "settings",
  );
  const decision = checkToolPermission(
    destructiveTool("Bash"),
    { command: "git status" },
    ctx,
  );
  assert.notStrictEqual(
    decision.behavior,
    "deny",
    "Deny pattern should not block non-matching command",
  );
}

// ── Allow rules ────────────────────────────────────────────────

export function testAllowRuleGrantsAccess() {
  const ctx = buildPermissionContext("default", ["Edit"], [], [], "settings");
  const decision = checkToolPermission(writeTool("Edit"), {}, ctx);
  assert.strictEqual(
    decision.behavior,
    "allow",
    "Allow rule should grant access",
  );
  assert.strictEqual(decision.source, "rule");
}

export function testAllowRuleWithPattern() {
  const ctx = buildPermissionContext(
    "default",
    ["Bash(git *)"],
    [],
    [],
    "settings",
  );
  const decision = checkToolPermission(
    destructiveTool("Bash"),
    { command: "git status" },
    ctx,
  );
  assert.strictEqual(
    decision.behavior,
    "allow",
    "Allow pattern should match git commands",
  );
}

export function testAllowRuleDoesNotMatchDifferentTool() {
  const ctx = buildPermissionContext("default", ["Read"], [], [], "settings");
  const decision = checkToolPermission(writeTool("Edit"), {}, ctx);
  assert.notStrictEqual(
    decision.source,
    "rule",
    "Allow rule for Read should not affect Edit",
  );
}

// ── Plan mode ──────────────────────────────────────────────────

export function testPlanModeAllowsReadOnly() {
  const ctx = buildPermissionContext("plan", [], [], [], "settings");
  const decision = checkToolPermission(readOnlyTool("Glob"), {}, ctx);
  assert.strictEqual(
    decision.behavior,
    "allow",
    "Plan mode should allow read-only tools",
  );
}

export function testPlanModeDeniesWrite() {
  const ctx = buildPermissionContext("plan", [], [], [], "settings");
  const decision = checkToolPermission(writeTool("Edit"), {}, ctx);
  assert.strictEqual(
    decision.behavior,
    "deny",
    "Plan mode should deny write tools",
  );
  assert.ok(
    decision.reason.includes("plan mode"),
    "Reason should mention plan mode",
  );
}

export function testPlanModeDeniesDestructive() {
  const ctx = buildPermissionContext("plan", [], [], [], "settings");
  const decision = checkToolPermission(destructiveTool("Bash"), {}, ctx);
  assert.strictEqual(
    decision.behavior,
    "deny",
    "Plan mode should deny destructive tools",
  );
}

// ── Bypass mode ────────────────────────────────────────────────

export function testBypassModeAllowsEverything() {
  const ctx = buildPermissionContext("bypass", [], [], [], "settings");
  const destructive = checkToolPermission(destructiveTool(), {}, ctx);
  assert.strictEqual(
    destructive.behavior,
    "allow",
    "Bypass mode should allow destructive tools",
  );

  const write = checkToolPermission(writeTool(), {}, ctx);
  assert.strictEqual(
    write.behavior,
    "allow",
    "Bypass mode should allow write tools",
  );
}

// ── Auto mode ──────────────────────────────────────────────────

export function testAutoModeAllowsNonDestructive() {
  const ctx = buildPermissionContext("auto", [], [], [], "settings");
  const decision = checkToolPermission(writeTool("Edit"), {}, ctx);
  assert.strictEqual(
    decision.behavior,
    "allow",
    "Auto mode should allow non-destructive writes",
  );
}

export function testAutoModeAsksForDestructive() {
  const ctx = buildPermissionContext("auto", [], [], [], "settings");
  const decision = checkToolPermission(destructiveTool("Bash"), {}, ctx);
  assert.strictEqual(
    decision.behavior,
    "ask",
    "Auto mode should ask for destructive tools",
  );
}

// ── Ask rules ──────────────────────────────────────────────────

export function testAskRuleTriggersDialog() {
  const ctx = buildPermissionContext("auto", [], [], ["Edit"], "settings");
  const decision = checkToolPermission(writeTool("Edit"), {}, ctx);
  assert.strictEqual(
    decision.behavior,
    "ask",
    "Ask rule should override auto-allow",
  );
}

// ── Dangerous path detection ───────────────────────────────────

export function testDangerousPathBashrc() {
  assert.ok(
    isDangerousPath("/home/user/.bashrc"),
    ".bashrc should be dangerous",
  );
}

export function testDangerousPathEnv() {
  assert.ok(isDangerousPath("/project/.env"), ".env should be dangerous");
}

export function testDangerousPathGitDir() {
  assert.ok(
    isDangerousPath("/project/.git/config"),
    ".git/ should be dangerous",
  );
}

export function testDangerousPathSshKey() {
  assert.ok(
    isDangerousPath("/home/user/.ssh/id_rsa"),
    "SSH key should be dangerous",
  );
}

export function testSafePathNormal() {
  assert.ok(
    !isDangerousPath("/project/src/index.ts"),
    "Normal source file should be safe",
  );
}

export function testSafePathReadme() {
  assert.ok(!isDangerousPath("/project/README.md"), "README should be safe");
}

// ── Destructive command detection ──────────────────────────────

export function testDestructiveRm() {
  assert.ok(
    isDestructiveCommand("rm -rf /tmp/test"),
    "rm should be destructive",
  );
}

export function testDestructiveGitResetHard() {
  assert.ok(
    isDestructiveCommand("git reset --hard HEAD"),
    "git reset --hard should be destructive",
  );
}

export function testDestructiveGitPushForce() {
  assert.ok(
    isDestructiveCommand("git push --force origin main"),
    "git push --force should be destructive",
  );
}

export function testDestructiveSudo() {
  assert.ok(
    isDestructiveCommand("sudo rm -rf /"),
    "sudo should be destructive",
  );
}

export function testNonDestructiveLs() {
  assert.ok(!isDestructiveCommand("ls -la"), "ls should not be destructive");
}

export function testNonDestructiveGitStatus() {
  assert.ok(
    !isDestructiveCommand("git status"),
    "git status should not be destructive",
  );
}

// ── Read-only command detection ────────────────────────────────

export function testReadOnlyLs() {
  assert.ok(isReadOnlyCommand("ls -la"), "ls should be read-only");
}

export function testReadOnlyGitStatus() {
  assert.ok(isReadOnlyCommand("git status"), "git status should be read-only");
}

export function testReadOnlyGrep() {
  assert.ok(
    isReadOnlyCommand("grep -r 'TODO' src/"),
    "grep should be read-only",
  );
}

export function testReadOnlyCat() {
  assert.ok(isReadOnlyCommand("cat README.md"), "cat should be read-only");
}

export function testNotReadOnlyRm() {
  assert.ok(!isReadOnlyCommand("rm file.txt"), "rm should not be read-only");
}

// ── Rule parsing ───────────────────────────────────────────────

export function testParseRuleSimple() {
  const rule = parseRuleString("Bash", "allow", "settings");
  assert.ok(rule, "Should parse simple rule");
  assert.strictEqual(rule!.toolName, "Bash");
  assert.strictEqual(rule!.pattern, undefined);
  assert.strictEqual(rule!.behavior, "allow");
}

export function testParseRuleWithPattern() {
  const rule = parseRuleString("Bash(git *)", "deny", "project");
  assert.ok(rule, "Should parse rule with pattern");
  assert.strictEqual(rule!.toolName, "Bash");
  assert.strictEqual(rule!.pattern, "git *");
  assert.strictEqual(rule!.behavior, "deny");
  assert.strictEqual(rule!.source, "project");
}

export function testParseRuleInvalid() {
  const rule = parseRuleString("", "allow", "settings");
  assert.strictEqual(rule, null, "Empty string should return null");
}

export function testParseRuleMcpTool() {
  const rule = parseRuleString("mcp__server__tool", "allow", "settings");
  assert.ok(rule, "Should parse MCP tool name");
  assert.strictEqual(rule!.toolName, "mcp__server__tool");
}

// ── Build context ──────────────────────────────────────────────

export function testBuildContextFiltersInvalidRules() {
  const ctx = buildPermissionContext(
    "default",
    ["Read", "", "invalid rule with spaces"],
    ["Bash(rm *)"],
    [],
    "settings",
  );
  assert.strictEqual(ctx.allowRules.length, 1, "Should filter invalid rules");
  assert.strictEqual(ctx.denyRules.length, 1, "Should keep valid deny rules");
}
