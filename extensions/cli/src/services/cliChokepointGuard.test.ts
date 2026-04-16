/**
 * Phase B regression guard — SECURITY_HARDENING_PLAN.md (B4 + B5).
 *
 * The CLI's edit/multiEdit/writeFile tools historically called
 * `fs.readFileSync` on project paths directly, bypassing the
 * `ScanningFileIo` chokepoint. Phase B routed every read through
 * `scanningReadFile`. This test is the regression net: it parses each
 * CLI tool source file and fails if any new direct `fs.readFileSync`
 * sneaks in without an explicit `// scan-raw:` justification comment.
 *
 * Why static analysis instead of an integration test:
 *   - Integration would need a live proxy + mocked fs, lots of setup.
 *   - The invariant we care about ("no CLI tool reads project files
 *     outside the chokepoint") is a structural one. A grep is the
 *     right tool for a structural invariant.
 *
 * Add new files to `WATCHED_FILES` as the CLI grows new tools that
 * read project content.
 */

import * as fs from "fs";
import * as path from "path";

import { describe, it, expect } from "vitest";

const TOOLS_DIR = path.resolve(__dirname, "..", "tools");

const WATCHED_FILES = ["edit.ts", "multiEdit.ts", "writeFile.ts"] as const;

/**
 * Pattern that catches any synchronous fs read call. Allows the
 * `scan-raw:` escape hatch on the line immediately above (any
 * variant: in a comment block, on the same line, etc.) so future
 * tool authors can opt out with an explicit justification.
 */
const RAW_FS_READ_PATTERN = /fs\.readFileSync\s*\(/g;
const SCAN_RAW_COMMENT = "scan-raw:";

function scanFile(filePath: string): Array<{ line: number; text: string }> {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const offenders: Array<{ line: number; text: string }> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!RAW_FS_READ_PATTERN.test(line)) continue;
    RAW_FS_READ_PATTERN.lastIndex = 0; // reset for next iteration

    // Look at the previous 3 lines for a `// scan-raw:` justification.
    const window = lines.slice(Math.max(0, i - 3), i + 1).join("\n");
    if (window.includes(SCAN_RAW_COMMENT)) continue;

    offenders.push({ line: i + 1, text: line.trim() });
  }
  return offenders;
}

describe("CLI chokepoint guard — Phase B (SECURITY_HARDENING_PLAN.md)", () => {
  for (const file of WATCHED_FILES) {
    it(`${file} must not call fs.readFileSync without a "scan-raw:" justification`, () => {
      const fullPath = path.join(TOOLS_DIR, file);
      const offenders = scanFile(fullPath);
      if (offenders.length > 0) {
        const detail = offenders
          .map((o) => `  line ${o.line}: ${o.text}`)
          .join("\n");
        throw new Error(
          `${file} contains direct fs.readFileSync calls that bypass ` +
            `ScanningFileIo. Either route through scanningReadFile() or ` +
            `add a "// scan-raw: <reason>" comment within 3 lines above:\n${detail}`,
        );
      }
      expect(offenders).toEqual([]);
    });
  }
});
