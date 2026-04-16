import * as fs from "node:fs";
import * as path from "node:path";

import {
  scanPromptInjection,
  scanSecrets,
  type SecretType,
} from "@ai-firewall/scanner";

import type { FileScanFinding } from "../util/fileScanProxy.js";
import type { ScanReport } from "../util/scanning/FileBlockedByScanError.js";
import { publishScanReport } from "../util/scanning/scanReportChannel.js";
import { loadAllMemories } from "../tools/implementations/memory";

const INSTRUCTION_FILES = [
  ".aifirewall.md",
  ".ai-firewall.md",
  "AIFIREWALL.md",
];

// Phase D.D6 (SECURITY_HARDENING_PLAN.md) — content from these files
// flows directly into the LLM system prompt, so any prompt-injection
// payload an attacker plants in `.aifirewall.md` becomes a free
// instruction-override. Threshold tuned conservatively (matches the
// scanner package's default `isInjection` decision boundary).
const INJECTION_BLOCK_THRESHOLD = 60;

function reportFinding(
  filepath: string,
  action: "ALLOW" | "BLOCK",
  reasons: string[],
  riskScore: number,
  findings: FileScanFinding[],
): void {
  const report: ScanReport = {
    filePath: filepath,
    action,
    riskScore,
    reasons,
    findings,
  };
  publishScanReport(report);
}

function scanInstructionContent(filepath: string, content: string): boolean {
  const injection = scanPromptInjection(content);
  const secrets = scanSecrets(content);

  const findings: FileScanFinding[] = secrets.secrets.map((s) => ({
    type: s.type,
    severity: s.severity,
    category: "secret",
    line: 0,
    column: 0,
    masked: maskSecret(s.value, s.type),
  }));

  if (injection.score >= INJECTION_BLOCK_THRESHOLD) {
    reportFinding(
      filepath,
      "BLOCK",
      [
        `Prompt-injection patterns detected in project instructions ` +
          `(score ${injection.score}, ${injection.matches.length} matches). ` +
          `File excluded from system prompt to prevent instruction override.`,
      ],
      injection.score,
      findings,
    );
    return false;
  }

  // Lower-severity findings still get reported (informational) so the
  // user sees that secrets/PII appeared in the project instructions.
  if (findings.length > 0 || injection.matches.length > 0) {
    reportFinding(
      filepath,
      "ALLOW",
      injection.matches.length > 0
        ? [
            `Prompt-injection patterns matched (score ${injection.score}, below block threshold)`,
          ]
        : [`Secrets detected in project instructions`],
      Math.max(injection.score, secrets.secrets.length > 0 ? 70 : 0),
      findings,
    );
  }
  return true;
}

function maskSecret(value: string, _type: SecretType): string {
  if (value.length <= 8) return "***";
  return `${value.slice(0, 4)}…${value.slice(-2)}`;
}

/**
 * Load project-level instructions from .aifirewall.md (similar to CLAUDE.md).
 * Returns the file content or null if not found, unread, or BLOCKed by
 * the prompt-injection scan.
 */
export function loadProjectInstructions(workspaceRoot: string): string | null {
  const rootPath = workspaceRoot.startsWith("file://")
    ? workspaceRoot.slice(7)
    : workspaceRoot;

  for (const filename of INSTRUCTION_FILES) {
    const filepath = path.join(rootPath, filename);
    if (!fs.existsSync(filepath)) continue;
    let content: string;
    try {
      // scan-raw: this is a sync helper that returns the literal text
      // for system-prompt assembly. The async ScanningIde decorator
      // would require making every caller async (cascades through the
      // assistant config layer); the inline scan below provides the
      // same enforcement without that refactor.
      content = fs.readFileSync(filepath, "utf-8");
    } catch {
      continue;
    }
    const allowed = scanInstructionContent(filepath, content);
    if (!allowed) return null;
    return content;
  }

  return null;
}

/**
 * Load all project context that should be injected into the system prompt:
 * 1. .aifirewall.md project instructions
 * 2. Persistent memories from .ai-firewall/memory/
 *
 * Returns a combined string or null if nothing to inject.
 */
export function loadProjectContext(workspaceRoot: string): string | null {
  const parts: string[] = [];

  const instructions = loadProjectInstructions(workspaceRoot);
  if (instructions) {
    parts.push(
      `<project-instructions>\n${instructions}\n</project-instructions>`,
    );
  }

  const memories = loadAllMemories(workspaceRoot);
  if (memories) {
    parts.push(`<project-memories>\n${memories}\n</project-memories>`);
  }

  return parts.length > 0 ? parts.join("\n\n") : null;
}
