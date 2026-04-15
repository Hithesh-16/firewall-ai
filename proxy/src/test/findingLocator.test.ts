/**
 * Finding Locator Tests
 *
 * Verifies that character offsets are converted to (line, column) and
 * that mask values strip raw secrets correctly. Edge cases:
 *   - position 0 (start of file)
 *   - position past last newline
 *   - CRLF line endings
 *   - bare CR line endings
 *   - empty content
 */

import assert from "node:assert";
import {
  buildLineStarts,
  locatePosition,
  maskValue,
} from "../scanner/findingLocator";

export function testLocatePositionStartOfFile() {
  const content = "first line\nsecond line\nthird line";
  const starts = buildLineStarts(content);
  const loc = locatePosition(starts, 0);
  assert.deepStrictEqual(loc, { line: 1, column: 1 });
}

export function testLocatePositionMiddleOfLine() {
  const content = "first line\nsecond line\nthird line";
  const starts = buildLineStarts(content);
  // 'l' in "line" on line 2 → offset = 11 + 7 = 18
  const loc = locatePosition(starts, 18);
  assert.deepStrictEqual(loc, { line: 2, column: 8 });
}

export function testLocatePositionStartOfLine() {
  const content = "abc\ndef\nghi";
  const starts = buildLineStarts(content);
  // 'd' is the first char of line 2 at offset 4
  const loc = locatePosition(starts, 4);
  assert.deepStrictEqual(loc, { line: 2, column: 1 });
}

export function testLocatePositionCrlf() {
  const content = "abc\r\ndef\r\nghi";
  const starts = buildLineStarts(content);
  // 'd' is at offset 5 (after \r\n)
  const loc = locatePosition(starts, 5);
  assert.deepStrictEqual(loc, { line: 2, column: 1 });
}

export function testLocatePositionBareCr() {
  const content = "abc\rdef\rghi";
  const starts = buildLineStarts(content);
  // 'd' is at offset 4 (after bare \r)
  const loc = locatePosition(starts, 4);
  assert.deepStrictEqual(loc, { line: 2, column: 1 });
}

export function testLocatePositionEndOfFile() {
  const content = "abc\ndef";
  const starts = buildLineStarts(content);
  // 'f' is at offset 6
  const loc = locatePosition(starts, 6);
  assert.deepStrictEqual(loc, { line: 2, column: 3 });
}

export function testLocatePositionEmptyFile() {
  const content = "";
  const starts = buildLineStarts(content);
  const loc = locatePosition(starts, 0);
  assert.deepStrictEqual(loc, { line: 1, column: 1 });
}

export function testMaskValueAwsKey() {
  const masked = maskValue("AKIAIOSFODNN7EXAMPLE", "AWS_KEY");
  // first 4 + last 2 visible
  assert.strictEqual(masked.startsWith("AKIA"), true);
  assert.strictEqual(masked.endsWith("LE"), true);
  // No raw value in the middle
  assert.ok(!masked.includes("OSFODNN"));
}

export function testMaskValueEmail() {
  const masked = maskValue("johndoe@example.com", "EMAIL");
  // Domain should remain visible
  assert.ok(masked.endsWith("@example.com"));
  // Local part starts with first two chars
  assert.ok(masked.startsWith("jo"));
  // Raw local part not present
  assert.ok(!masked.includes("johndoe"));
}

export function testMaskValuePhone() {
  const masked = maskValue("+1 (555) 123-4567", "PHONE");
  // Last 4 visible
  assert.ok(masked.endsWith("4567"));
  // Earlier digits hidden
  assert.ok(!masked.includes("555"));
}

export function testMaskValueShortSecret() {
  const masked = maskValue("abc", "GENERIC_API_KEY");
  // ≤6 chars → fully masked
  assert.strictEqual(masked, "***");
}
