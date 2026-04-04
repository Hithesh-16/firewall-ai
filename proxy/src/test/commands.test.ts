/**
 * Command System Tests
 *
 * Tests the slash command parser, command registry (lookup, matching, aliases),
 * command execution (local, action, prompt types), listCommands, and searchCommands.
 */

import assert from "node:assert";
import {
  parseSlashCommand,
  type CommandContext,
  type CommandMatch,
} from "../commands/commandTypes";
import {
  getCommands,
  findCommand,
  matchCommand,
  executeCommand,
  listCommands,
  searchCommands,
  clearCommandCache,
  type CommandListEntry,
} from "../commands/commandLoader";

// ── Helper ───────────────────────────────────────────────────

function defaultContext(): CommandContext {
  return {
    userId: 1,
    projectPath: process.cwd(),
    model: "test-model",
  };
}

// ── parseSlashCommand ────────────────────────────────────────

export function testParseDoctor() {
  const result = parseSlashCommand("/doctor");
  assert.ok(result !== null, "Should parse /doctor");
  assert.strictEqual(result!.name, "doctor");
  assert.strictEqual(result!.args, "");
}

export function testParseCompactWithArgs() {
  const result = parseSlashCommand("/compact 4000");
  assert.ok(result !== null, "Should parse /compact 4000");
  assert.strictEqual(result!.name, "compact");
  assert.strictEqual(result!.args, "4000");
}

export function testParseReviewWithFlag() {
  const result = parseSlashCommand("/review --staged");
  assert.ok(result !== null, "Should parse /review --staged");
  assert.strictEqual(result!.name, "review");
  assert.strictEqual(result!.args, "--staged");
}

export function testParseNotACommand() {
  const result = parseSlashCommand("not a command");
  assert.strictEqual(result, null, "Non-slash input should return null");
}

export function testParseEmptyString() {
  const result = parseSlashCommand("");
  assert.strictEqual(result, null, "Empty string should return null");
}

export function testParseSlashOnly() {
  const result = parseSlashCommand("/");
  assert.ok(result !== null, "Bare slash should parse");
  assert.strictEqual(result!.name, "");
  assert.strictEqual(result!.args, "");
}

export function testParseCaseInsensitive() {
  const result = parseSlashCommand("/DOCTOR");
  assert.ok(result !== null, "Should parse /DOCTOR");
  assert.strictEqual(result!.name, "doctor", "Name should be lowercased");
}

export function testParseMixedCase() {
  const result = parseSlashCommand("/ReViEw --all");
  assert.ok(result !== null, "Should parse mixed case");
  assert.strictEqual(result!.name, "review", "Name should be lowercased");
  assert.strictEqual(result!.args, "--all");
}

export function testParseLeadingWhitespace() {
  const result = parseSlashCommand("   /doctor");
  assert.ok(result !== null, "Should parse with leading whitespace");
  assert.strictEqual(result!.name, "doctor");
}

export function testParseMultipleSpacesInArgs() {
  const result = parseSlashCommand("/compact   4000   tokens");
  assert.ok(result !== null, "Should parse with multiple spaces");
  assert.strictEqual(result!.name, "compact");
  assert.strictEqual(result!.args, "4000   tokens");
}

// ── Command Registry: getCommands ────────────────────────────

export function testGetCommandsReturnsArray() {
  clearCommandCache();
  const commands = getCommands();
  assert.ok(Array.isArray(commands), "getCommands should return an array");
  assert.ok(commands.length > 0, "Should have at least one command");
}

export function testGetCommandsContainsBuiltins() {
  clearCommandCache();
  const commands = getCommands();
  const names = commands.map((c) => c.name);
  assert.ok(names.includes("doctor"), "Should contain doctor command");
  assert.ok(names.includes("compact"), "Should contain compact command");
  assert.ok(names.includes("help"), "Should contain help command");
  assert.ok(names.includes("memory"), "Should contain memory command");
  assert.ok(names.includes("tasks"), "Should contain tasks command");
  assert.ok(names.includes("review"), "Should contain review command");
}

export function testGetCommandsSortedAlphabetically() {
  clearCommandCache();
  const commands = getCommands();
  const names = commands.map((c) => c.name);
  const sorted = [...names].sort((a, b) => a.localeCompare(b));
  assert.deepStrictEqual(
    names,
    sorted,
    "Commands should be sorted alphabetically",
  );
}

export function testGetCommandsIsMemoized() {
  clearCommandCache();
  const first = getCommands();
  const second = getCommands();
  assert.strictEqual(
    first,
    second,
    "Repeated calls should return same reference (memoized)",
  );
}

// ── Command Registry: findCommand ────────────────────────────

export function testFindCommandDoctor() {
  clearCommandCache();
  const cmd = findCommand("doctor");
  assert.ok(cmd !== null, "Should find doctor command");
  assert.strictEqual(cmd!.name, "doctor");
}

export function testFindCommandByAlias() {
  clearCommandCache();
  const cmd = findCommand("mem");
  assert.ok(cmd !== null, "Should find memory command by alias 'mem'");
  assert.strictEqual(cmd!.name, "memory");
}

export function testFindCommandByAliasC() {
  clearCommandCache();
  const cmd = findCommand("c");
  assert.ok(cmd !== null, "Should find compact command by alias 'c'");
  assert.strictEqual(cmd!.name, "compact");
}

export function testFindCommandByAliasQuestion() {
  clearCommandCache();
  const cmd = findCommand("?");
  assert.ok(cmd !== null, "Should find help command by alias '?'");
  assert.strictEqual(cmd!.name, "help");
}

export function testFindCommandNonexistent() {
  clearCommandCache();
  const cmd = findCommand("nonexistent");
  assert.strictEqual(cmd, null, "Should return null for unknown command");
}

export function testFindCommandCaseInsensitive() {
  clearCommandCache();
  const cmd = findCommand("DOCTOR");
  assert.ok(cmd !== null, "Should find doctor via uppercase lookup");
  assert.strictEqual(cmd!.name, "doctor");
}

// ── Command Registry: matchCommand ───────────────────────────

export function testMatchCommandDoctor() {
  clearCommandCache();
  const match = matchCommand("/doctor");
  assert.ok(match !== null, "Should match /doctor");
  assert.strictEqual(match!.command.name, "doctor");
  assert.strictEqual(match!.args, "");
  assert.strictEqual(match!.matchedName, "doctor");
}

export function testMatchCommandMemWithArgs() {
  clearCommandCache();
  const match = matchCommand("/mem list");
  assert.ok(match !== null, "Should match /mem alias");
  assert.strictEqual(match!.command.name, "memory");
  assert.strictEqual(match!.args, "list");
  assert.strictEqual(match!.matchedName, "mem");
}

export function testMatchCommandNoSlash() {
  clearCommandCache();
  const match = matchCommand("no slash");
  assert.strictEqual(match, null, "Non-slash input should return null");
}

export function testMatchCommandNonexistent() {
  clearCommandCache();
  const match = matchCommand("/xyznonexistent");
  assert.strictEqual(match, null, "Unknown command should return null match");
}

// ── Command Execution ────────────────────────────────────────

export async function testExecuteHelp() {
  clearCommandCache();
  const result = await executeCommand("/help", defaultContext());
  assert.strictEqual(result.found, true, "/help should be found");
  assert.ok(
    result.result !== undefined,
    "/help should return a result (local command)",
  );
  assert.ok(result.result!.output.length > 0, "/help should produce output");
}

export async function testExecuteDoctor() {
  clearCommandCache();
  const result = await executeCommand("/doctor", defaultContext());
  assert.strictEqual(result.found, true, "/doctor should be found");
  assert.ok(result.result !== undefined, "/doctor should return a result");
  assert.ok(
    result.result!.output.includes("Health Check"),
    "/doctor output should mention health check",
  );
}

export async function testExecuteNonexistent() {
  clearCommandCache();
  const result = await executeCommand("/nonexistent", defaultContext());
  assert.strictEqual(
    result.found,
    false,
    "Unknown command should return found:false",
  );
  assert.strictEqual(result.result, undefined, "Should have no result");
  assert.strictEqual(result.prompt, undefined, "Should have no prompt");
}

export async function testExecuteTasks() {
  clearCommandCache();
  const ctx = defaultContext();
  const result = await executeCommand("/tasks", ctx);
  assert.strictEqual(result.found, true, "/tasks should be found");
  assert.ok(result.result !== undefined, "/tasks should return a result");
}

export async function testExecuteMemory() {
  clearCommandCache();
  const ctx = defaultContext();
  const result = await executeCommand("/memory", ctx);
  assert.strictEqual(result.found, true, "/memory should be found");
  assert.ok(result.result !== undefined, "/memory should return a result");
}

export async function testExecuteStats() {
  clearCommandCache();
  const result = await executeCommand("/stats", defaultContext());
  assert.strictEqual(result.found, true, "/stats should be found");
  assert.ok(result.result !== undefined, "/stats should return a result");
  // Stats may fail gracefully if proxy not running; just verify it was found and returned something
  assert.ok(
    typeof result.result!.output === "string",
    "/stats output should be a string",
  );
}

export async function testExecuteReview() {
  clearCommandCache();
  const result = await executeCommand("/review", defaultContext());
  assert.strictEqual(result.found, true, "/review should be found");
  assert.ok(
    result.prompt !== undefined,
    "/review should return a prompt (prompt type command)",
  );
  assert.ok(
    result.prompt!.includes("Review"),
    "Review prompt should contain 'Review'",
  );
  assert.strictEqual(
    result.result,
    undefined,
    "Prompt commands should not return result",
  );
}

export async function testExecuteReviewWithArgs() {
  clearCommandCache();
  const result = await executeCommand("/review --all", defaultContext());
  assert.strictEqual(result.found, true, "/review --all should be found");
  assert.ok(result.prompt !== undefined, "Should return a prompt");
  assert.ok(
    result.prompt!.includes("--all"),
    "Prompt should incorporate the args",
  );
}

export async function testExecuteCompact() {
  clearCommandCache();
  const result = await executeCommand("/compact", defaultContext());
  assert.strictEqual(result.found, true, "/compact should be found");
  assert.ok(result.result !== undefined, "/compact should return a result");
  assert.ok(
    result.result!.output.includes("Usage"),
    "/compact without messages should show usage",
  );
}

export async function testExecuteReturnsCommandObject() {
  clearCommandCache();
  const result = await executeCommand("/help", defaultContext());
  assert.ok(
    result.command !== undefined,
    "Should include command object in result",
  );
  assert.strictEqual(result.command!.name, "help");
  assert.strictEqual(result.command!.type, "local");
}

export async function testExecuteNotASlashCommand() {
  clearCommandCache();
  const result = await executeCommand(
    "just a normal message",
    defaultContext(),
  );
  assert.strictEqual(result.found, false, "Non-slash input should not match");
}

// ── listCommands ─────────────────────────────────────────────

export function testListCommandsReturnsArray() {
  clearCommandCache();
  const entries = listCommands();
  assert.ok(Array.isArray(entries), "listCommands should return an array");
  assert.ok(entries.length > 0, "Should have entries");
}

export function testListCommandsEntryShape() {
  clearCommandCache();
  const entries = listCommands();
  for (const entry of entries) {
    assert.ok(typeof entry.name === "string", "Entry should have name");
    assert.ok(Array.isArray(entry.aliases), "Entry should have aliases array");
    assert.ok(
      typeof entry.description === "string",
      "Entry should have description",
    );
    assert.ok(typeof entry.type === "string", "Entry should have type");
    assert.ok(typeof entry.source === "string", "Entry should have source");
  }
}

export function testListCommandsContainsExpectedBuiltins() {
  clearCommandCache();
  const entries = listCommands();
  const names = entries.map((e) => e.name);
  assert.ok(names.includes("doctor"), "Should list doctor");
  assert.ok(names.includes("help"), "Should list help");
  assert.ok(names.includes("review"), "Should list review");
  assert.ok(names.includes("tasks"), "Should list tasks");
  assert.ok(names.includes("memory"), "Should list memory");
}

export function testListCommandsSourceIsBuiltin() {
  clearCommandCache();
  const entries = listCommands();
  for (const entry of entries) {
    assert.strictEqual(
      entry.source,
      "builtin",
      `All current commands should be builtin, got '${entry.source}' for ${entry.name}`,
    );
  }
}

// ── searchCommands ───────────────────────────────────────────

export function testSearchCommandsDoctor() {
  clearCommandCache();
  const results = searchCommands("doctor");
  assert.ok(results.length > 0, "Should find doctor");
  assert.ok(
    results.some((r) => r.name === "doctor"),
    "Should match doctor by name",
  );
}

export function testSearchCommandsTask() {
  clearCommandCache();
  const results = searchCommands("task");
  assert.ok(results.length > 0, "Should find tasks command");
  assert.ok(
    results.some((r) => r.name === "tasks"),
    "Should match tasks by name",
  );
}

export function testSearchCommandsNonexistent() {
  clearCommandCache();
  const results = searchCommands("zzzznonexistent");
  assert.strictEqual(
    results.length,
    0,
    "Should return empty array for no matches",
  );
}

export function testSearchCommandsByDescription() {
  clearCommandCache();
  const results = searchCommands("health");
  assert.ok(
    results.length > 0,
    "Should match doctor by description containing 'health'",
  );
  assert.ok(
    results.some((r) => r.name === "doctor"),
    "Doctor description mentions health",
  );
}

export function testSearchCommandsByAlias() {
  clearCommandCache();
  const results = searchCommands("mem");
  assert.ok(results.length > 0, "Should match memory via alias 'mem'");
  assert.ok(
    results.some((r) => r.name === "memory"),
    "Memory command has 'mem' alias",
  );
}

export function testSearchCommandsCaseInsensitive() {
  clearCommandCache();
  const results = searchCommands("DOCTOR");
  assert.ok(results.length > 0, "Search should be case insensitive");
  assert.ok(
    results.some((r) => r.name === "doctor"),
    "Should find doctor via uppercase search",
  );
}
