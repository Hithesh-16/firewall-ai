/**
 * Context Reducer Tests
 *
 * Tests the grep, window, strip, and hybrid reducer pipeline.
 */

import assert from "node:assert";
import { grepLines, grepLineNumbers } from "../reducer/grepReducer";
import { buildWindows, extractWindows } from "../reducer/windowReducer";
import { stripComments, stripBlankLines, stripAll } from "../reducer/commentStripper";
import { reduce } from "../reducer/hybridReducer";

const SAMPLE_CODE = `// This is a comment
import express from "express";

// Auth module
function login(username, password) {
  const hash = bcrypt.hash(password);
  return db.findUser(username, hash);
}

// Utility
function formatDate(d) {
  return d.toISOString();
}

// Payment handler
function processPayment(amount, card) {
  validate(card);
  return stripe.charge(amount);
}

// Export
module.exports = { login, formatDate, processPayment };
`;

// --- Grep Reducer ---

export function testGrepFindsMatches() {
  const matches = grepLines(SAMPLE_CODE, "login password");
  assert.ok(matches.length >= 2, `Should find login/password matches, got ${matches.length}`);
  assert.ok(matches.some((m) => m.keyword === "login"), "Should match 'login'");
  assert.ok(matches.some((m) => m.keyword === "password"), "Should match 'password'");
}

export function testGrepNoMatches() {
  const matches = grepLines(SAMPLE_CODE, "nonexistent_xyz");
  assert.strictEqual(matches.length, 0, "Should find 0 matches");
}

export function testGrepEmptyQuery() {
  const matches = grepLines(SAMPLE_CODE, "");
  assert.strictEqual(matches.length, 0, "Empty query should return 0");
}

export function testGrepLineNumbers() {
  const numbers = grepLineNumbers(SAMPLE_CODE, "login");
  assert.ok(numbers.length > 0, "Should find line numbers");
  assert.ok(numbers.every((n) => typeof n === "number"), "All should be numbers");
}

// --- Window Reducer ---

export function testBuildWindowsMergesOverlaps() {
  // Lines 5 and 7 are close — windows should merge
  const ranges = buildWindows(100, [5, 7], 3);
  assert.strictEqual(ranges.length, 1, "Overlapping windows should merge into 1");
  assert.strictEqual(ranges[0].start, 2, "Start should be 5-3=2");
  assert.strictEqual(ranges[0].end, 10, "End should be 7+3=10");
}

export function testBuildWindowsSeparateRanges() {
  // Lines 5 and 50 are far — should produce 2 windows
  const ranges = buildWindows(100, [5, 50], 3);
  assert.strictEqual(ranges.length, 2, "Distant matches should produce 2 windows");
}

export function testExtractWindowsInsertsSeparator() {
  const content = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
  const ranges = buildWindows(20, [3, 17], 2);
  const extracted = extractWindows(content, ranges);
  assert.ok(extracted.includes("..."), "Should insert ... between non-adjacent windows");
}

// --- Comment Stripper ---

export function testStripComments() {
  const code = `// comment\nconst x = 1;\n/* block */\nconst y = 2;`;
  const stripped = stripComments(code);
  assert.ok(!stripped.includes("// comment"), "Should remove single-line comment");
  assert.ok(!stripped.includes("block"), "Should remove block comment");
  assert.ok(stripped.includes("const x = 1"), "Should keep code");
  assert.ok(stripped.includes("const y = 2"), "Should keep code");
}

export function testStripBlankLines() {
  const code = `line1\n\n\nline2\n\nline3`;
  const stripped = stripBlankLines(code);
  assert.strictEqual(stripped, "line1\nline2\nline3");
}

export function testStripPythonComments() {
  const code = `# comment\nx = 1\n"""\nmultiline\n"""\ny = 2`;
  const stripped = stripComments(code, "python");
  assert.ok(!stripped.includes("# comment"), "Should remove Python comment");
  assert.ok(stripped.includes("x = 1"), "Should keep code");
}

// --- Hybrid Reducer ---

export function testReduceWithQuery() {
  // Use a large file where grep+window produces clear savings
  const bigCode = SAMPLE_CODE.repeat(10); // ~220 lines
  const result = reduce(bigCode, { query: "login password", windowSize: 5 });
  assert.ok(result.content.includes("login"), "Should include matched content");
  assert.ok(result.strategies.length > 0, "Should report strategies used");
  assert.ok(result.strategies.some((s) => s.includes("grep")), "Should report grep strategy");
}

export function testReduceWithoutQuery() {
  // Without query, only strip stage runs
  const result = reduce(SAMPLE_CODE, { query: undefined, stripComments: true });
  assert.ok(!result.content.includes("// This is a comment"), "Should strip comments");
  assert.ok(result.content.includes("login"), "Should keep code");
}

export function testReduceTokenBudget() {
  const bigContent = "function a() { return 1; }\n".repeat(500); // ~3500 tokens
  const result = reduce(bigContent, { maxTokens: 500, stripComments: false, stripBlanks: false, stripDuplicates: false });
  assert.ok(result.reducedTokens <= 700, `Should trim near 500 tokens, got ${result.reducedTokens}`);
  assert.ok(
    result.strategies.some((s) => s.includes("budget")),
    `Should report budget trim, got strategies: ${result.strategies.join(", ")}`
  );
}

export function testReduceEmptyContent() {
  const result = reduce("", {});
  assert.strictEqual(result.originalTokens, 1, "Empty content should have 1 token (minimum)");
  assert.strictEqual(result.savingsPercent, 0);
}

export function testReduceSavingsMetrics() {
  const result = reduce(SAMPLE_CODE, { query: "login", windowSize: 3 });
  assert.ok(typeof result.savingsPercent === "number");
  assert.ok(typeof result.linesKept === "number");
  assert.ok(typeof result.linesRemoved === "number");
  assert.strictEqual(result.linesKept + result.linesRemoved, SAMPLE_CODE.split("\n").length);
}
