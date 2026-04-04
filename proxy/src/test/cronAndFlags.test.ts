/**
 * Cost Tracker + Feature Flag + Cron Service + Hook Service Tests
 *
 * Tests session cost tracking, flag evaluation, scheduling, and hooks.
 */

import assert from "node:assert";

// ── Cost Tracker ────────────────────────────────────────────────

import {
  trackUsage,
  getSessionCost,
  getAllSessionCosts,
  formatSessionCost,
  clearSession,
  clearAllSessions as clearAllCostSessions,
  purgeOldSessions,
} from "../gateway/costTracker";

export function testTrackUsageCreatesSession() {
  clearAllCostSessions();
  trackUsage("sess_1", "gpt-4", 100, 50, 0.003);
  const cost = getSessionCost("sess_1");
  assert.ok(cost !== null, "Session should exist after tracking");
  assert.strictEqual(cost!.sessionId, "sess_1");
  assert.strictEqual(cost!.totalInputTokens, 100);
  assert.strictEqual(cost!.totalOutputTokens, 50);
  assert.strictEqual(cost!.totalRequests, 1);
}

export function testTrackUsageAccumulates() {
  clearAllCostSessions();
  trackUsage("sess_2", "gpt-4", 100, 50, 0.003);
  trackUsage("sess_2", "gpt-4", 200, 100, 0.006);
  const cost = getSessionCost("sess_2");
  assert.strictEqual(cost!.totalInputTokens, 300);
  assert.strictEqual(cost!.totalOutputTokens, 150);
  assert.strictEqual(cost!.totalRequests, 2);
  assert.ok(Math.abs(cost!.totalCostUSD - 0.009) < 0.0001);
}

export function testTrackUsageMultipleModels() {
  clearAllCostSessions();
  trackUsage("sess_3", "gpt-4", 100, 50, 0.003);
  trackUsage("sess_3", "claude-3", 200, 100, 0.005);
  const cost = getSessionCost("sess_3");
  assert.ok(cost!.modelUsage["gpt-4"] !== undefined);
  assert.ok(cost!.modelUsage["claude-3"] !== undefined);
  assert.strictEqual(cost!.modelUsage["gpt-4"].requestCount, 1);
  assert.strictEqual(cost!.modelUsage["claude-3"].requestCount, 1);
}

export function testTrackUsagePerModelAccumulation() {
  clearAllCostSessions();
  trackUsage("sess_4", "gpt-4", 100, 50, 0.003);
  trackUsage("sess_4", "gpt-4", 150, 75, 0.004);
  const cost = getSessionCost("sess_4");
  const gpt4 = cost!.modelUsage["gpt-4"];
  assert.strictEqual(gpt4.inputTokens, 250);
  assert.strictEqual(gpt4.outputTokens, 125);
  assert.strictEqual(gpt4.requestCount, 2);
  assert.ok(Math.abs(gpt4.costUSD - 0.007) < 0.0001);
}

export function testGetSessionCostNullForUnknown() {
  clearAllCostSessions();
  assert.strictEqual(getSessionCost("nonexistent"), null);
}

export function testGetSessionCostReturnsImmutableCopy() {
  clearAllCostSessions();
  trackUsage("sess_5", "gpt-4", 100, 50, 0.003);
  const cost1 = getSessionCost("sess_5");
  const cost2 = getSessionCost("sess_5");
  assert.notStrictEqual(cost1, cost2, "Should return new objects each time");
}

export function testGetAllSessionCosts() {
  clearAllCostSessions();
  trackUsage("sess_a", "gpt-4", 100, 50, 0.003);
  trackUsage("sess_b", "claude-3", 200, 100, 0.005);
  const all = getAllSessionCosts();
  assert.strictEqual(all.length, 2);
  const ids = all.map((s) => s.sessionId).sort();
  assert.deepStrictEqual(ids, ["sess_a", "sess_b"]);
}

export function testFormatSessionCostUnknown() {
  clearAllCostSessions();
  assert.ok(formatSessionCost("nonexistent").includes("No cost data"));
}

export function testFormatSessionCostOutput() {
  clearAllCostSessions();
  trackUsage("sess_fmt", "gpt-4", 500, 200, 0.012);
  const output = formatSessionCost("sess_fmt");
  assert.ok(output.includes("Session Cost:"));
  assert.ok(output.includes("gpt-4"));
  assert.ok(output.includes("Requests:"));
}

export function testClearSessionRemovesSession() {
  clearAllCostSessions();
  trackUsage("sess_clear", "gpt-4", 100, 50, 0.003);
  assert.strictEqual(clearSession("sess_clear"), true);
  assert.strictEqual(getSessionCost("sess_clear"), null);
}

export function testClearSessionReturnsFalseForUnknown() {
  clearAllCostSessions();
  assert.strictEqual(clearSession("nonexistent"), false);
}

export function testPurgeOldSessionsKeepsRecent() {
  clearAllCostSessions();
  trackUsage("sess_recent", "gpt-4", 100, 50, 0.003);
  assert.strictEqual(purgeOldSessions(60_000), 0);
  assert.ok(getSessionCost("sess_recent") !== null);
}

// ── Feature Flag Service ────────────────────────────────────────

import {
  setFlag,
  getFlag,
  listFlags,
  removeFlag,
  isFeatureEnabled,
  clearAllFlags,
  loadFlagsFromSettings,
  type FeatureFlag,
} from "../services/featureFlagService";

export function testSetAndGetFlag() {
  clearAllFlags();
  setFlag({
    name: "dark_mode",
    description: "Enable dark mode",
    enabled: true,
    rolloutPercent: null,
  });
  const flag = getFlag("dark_mode");
  assert.ok(flag !== null);
  assert.strictEqual(flag!.name, "dark_mode");
  assert.strictEqual(flag!.enabled, true);
}

export function testGetFlagReturnsNullForUnknown() {
  clearAllFlags();
  assert.strictEqual(getFlag("nonexistent"), null);
}

export function testListFlags() {
  clearAllFlags();
  setFlag({
    name: "flag_a",
    description: "A",
    enabled: true,
    rolloutPercent: null,
  });
  setFlag({
    name: "flag_b",
    description: "B",
    enabled: false,
    rolloutPercent: null,
  });
  assert.strictEqual(listFlags().length, 2);
}

export function testRemoveFlag() {
  clearAllFlags();
  setFlag({
    name: "del_flag",
    description: "Delete me",
    enabled: true,
    rolloutPercent: null,
  });
  assert.strictEqual(removeFlag("del_flag"), true);
  assert.strictEqual(getFlag("del_flag"), null);
}

export function testRemoveFlagReturnsFalseForUnknown() {
  clearAllFlags();
  assert.strictEqual(removeFlag("nonexistent"), false);
}

export function testIsFeatureEnabledDisabledFlag() {
  clearAllFlags();
  setFlag({
    name: "off_flag",
    description: "Off",
    enabled: false,
    rolloutPercent: null,
  });
  assert.strictEqual(isFeatureEnabled("off_flag"), false);
}

export function testIsFeatureEnabledEnabledFlag() {
  clearAllFlags();
  setFlag({
    name: "on_flag",
    description: "On",
    enabled: true,
    rolloutPercent: null,
  });
  assert.strictEqual(isFeatureEnabled("on_flag"), true);
}

export function testIsFeatureEnabled100Percent() {
  clearAllFlags();
  setFlag({
    name: "full_flag",
    description: "Full",
    enabled: true,
    rolloutPercent: 100,
  });
  assert.strictEqual(isFeatureEnabled("full_flag", 42), true);
}

export function testIsFeatureEnabled0Percent() {
  clearAllFlags();
  setFlag({
    name: "zero_flag",
    description: "Zero",
    enabled: true,
    rolloutPercent: 0,
  });
  assert.strictEqual(isFeatureEnabled("zero_flag", 42), false);
}

export function testIsFeatureEnabledIncludeUser() {
  clearAllFlags();
  setFlag({
    name: "include_flag",
    description: "Include",
    enabled: true,
    rolloutPercent: 0,
    includeUserIds: [99],
  });
  assert.strictEqual(isFeatureEnabled("include_flag", 99), true);
}

export function testIsFeatureEnabledExcludeUser() {
  clearAllFlags();
  setFlag({
    name: "exclude_flag",
    description: "Exclude",
    enabled: true,
    rolloutPercent: 100,
    excludeUserIds: [77],
  });
  assert.strictEqual(isFeatureEnabled("exclude_flag", 77), false);
}

export function testLoadFlagsFromSettings() {
  clearAllFlags();
  const count = loadFlagsFromSettings({
    feature_x: { enabled: true, rolloutPercent: 50 },
    feature_y: { enabled: false },
  });
  assert.strictEqual(count, 2);
  assert.strictEqual(listFlags().length, 2);
  assert.ok(getFlag("feature_x") !== null);
}

// ── Cron Service ────────────────────────────────────────────────

import {
  createCronJob,
  getCronJob,
  listCronJobs,
  enableCronJob,
  disableCronJob,
  deleteCronJob,
  parseScheduleMs,
  clearAllCronJobs,
} from "../services/cronService";

export function testParseScheduleMinutes() {
  assert.strictEqual(parseScheduleMs("5m"), 5 * 60 * 1000);
}

export function testParseScheduleHours() {
  assert.strictEqual(parseScheduleMs("2h"), 2 * 60 * 60 * 1000);
}

export function testParseScheduleDays() {
  assert.strictEqual(parseScheduleMs("1d"), 24 * 60 * 60 * 1000);
}

export function testParseScheduleInvalid() {
  assert.strictEqual(parseScheduleMs("abc"), null);
}

export function testCreateCronJob() {
  clearAllCronJobs();
  const job = createCronJob(1, "Health check", "5m", {
    description: "Check health",
    prompt: "Run health checks",
  });
  assert.ok(job !== null, "Job should be created");
  assert.ok(job!.id.startsWith("cron_"));
  assert.strictEqual(job!.name, "Health check");
  assert.strictEqual(job!.enabled, true);
  assert.ok(job!.nextRunAt > 0);
}

export function testGetCronJob() {
  clearAllCronJobs();
  const created = createCronJob(1, "Test job", "10m", {
    description: "test",
    prompt: "test",
  });
  assert.ok(created !== null);
  const fetched = getCronJob(created!.id);
  assert.ok(fetched !== null);
  assert.strictEqual(fetched!.name, "Test job");
}

export function testGetCronJobReturnsNullForUnknown() {
  clearAllCronJobs();
  assert.strictEqual(getCronJob("nonexistent"), null);
}

export function testListCronJobs() {
  clearAllCronJobs();
  createCronJob(1, "Job A", "5m", { description: "a", prompt: "a" });
  createCronJob(1, "Job B", "1h", { description: "b", prompt: "b" });
  assert.strictEqual(listCronJobs(1).length, 2);
}

export function testDisableCronJob() {
  clearAllCronJobs();
  const job = createCronJob(1, "Disable me", "5m", {
    description: "d",
    prompt: "d",
  });
  assert.ok(job !== null);
  assert.strictEqual(disableCronJob(job!.id), true);
  assert.strictEqual(getCronJob(job!.id)!.enabled, false);
}

export function testEnableCronJob() {
  clearAllCronJobs();
  const job = createCronJob(1, "Enable me", "5m", {
    description: "e",
    prompt: "e",
  });
  assert.ok(job !== null);
  disableCronJob(job!.id);
  assert.strictEqual(enableCronJob(job!.id), true);
  assert.strictEqual(getCronJob(job!.id)!.enabled, true);
}

export function testDeleteCronJob() {
  clearAllCronJobs();
  const job = createCronJob(1, "Delete me", "5m", {
    description: "d",
    prompt: "d",
  });
  assert.ok(job !== null);
  assert.strictEqual(deleteCronJob(job!.id), true);
  assert.strictEqual(getCronJob(job!.id), null);
}

export function testDeleteCronJobReturnsFalseForUnknown() {
  clearAllCronJobs();
  assert.strictEqual(deleteCronJob("nonexistent"), false);
}

// ── Hook Service ────────────────────────────────────────────────

import {
  registerHook,
  getHooksForEvent,
  unregisterHooks,
  clearAllHooks,
  getHookHistory,
  getRegisteredHooks,
} from "../services/hookService";

export function testRegisterHook() {
  clearAllHooks();
  registerHook({ event: "tool_call", command: "echo tool-called" });
  const hooks = getHooksForEvent("tool_call");
  assert.strictEqual(hooks.length, 1);
  assert.strictEqual(hooks[0].command, "echo tool-called");
}

export function testGetHooksForEvent() {
  clearAllHooks();
  registerHook({ event: "tool_call", command: "echo 1" });
  registerHook({ event: "tool_result", command: "echo 2" });
  registerHook({ event: "tool_call", command: "echo 3" });
  assert.strictEqual(getHooksForEvent("tool_call").length, 2);
  assert.strictEqual(getHooksForEvent("tool_result").length, 1);
}

export function testUnregisterHooks() {
  clearAllHooks();
  registerHook({ event: "scan_blocked", command: "echo blocked" });
  unregisterHooks("scan_blocked");
  assert.strictEqual(getHooksForEvent("scan_blocked").length, 0);
}

export function testGetRegisteredHooks() {
  clearAllHooks();
  registerHook({ event: "tool_call", command: "echo 1" });
  registerHook({ event: "task_completed", command: "echo 2" });
  const all = getRegisteredHooks();
  assert.ok(all.size >= 2);
}

export function testGetHookHistoryEmpty() {
  clearAllHooks();
  const history = getHookHistory();
  assert.ok(Array.isArray(history));
}
