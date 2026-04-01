/**
 * Security Review Tool
 *
 * Scans all staged/modified files in the workspace using @ai-firewall/scanner
 * and returns a formatted SECURITY_REVIEW.md context item with per-file
 * risk scores and remediation guidance.
 *
 * SOLID:
 * - SRP: Only scans and reports. No file modification, no policy enforcement.
 * - DIP: Depends on @ai-firewall/scanner interfaces, not on proxy.
 */

import { scanSecrets, scanPII, scanPromptInjection } from "@ai-firewall/scanner";
import type { ContextItem } from "../../";

interface FileFinding {
  file: string;
  secrets: number;
  pii: number;
  injectionRisk: boolean;
  riskScore: number;
  details: string[];
}

/**
 * Scan files and generate a security review report.
 *
 * @param files - Array of { path, content } to scan
 * @returns ContextItem[] with SECURITY_REVIEW.md formatted content
 */
export function generateSecurityReview(
  files: Array<{ path: string; content: string }>,
): ContextItem[] {
  if (files.length === 0) {
    return [
      {
        name: "Security Review",
        description: "No files to review",
        content: "# Security Review\n\nNo files provided for review.",
      },
    ];
  }

  const findings: FileFinding[] = [];
  let totalSecrets = 0;
  let totalPII = 0;
  let totalInjection = 0;

  for (const file of files) {
    const secretResult = scanSecrets(file.content);
    const piiResult = scanPII(file.content);
    const injectionResult = scanPromptInjection(file.content);

    const fileSecrets = secretResult.secrets.length;
    const filePII = piiResult.pii.length;
    const hasInjection = injectionResult.isInjection;

    totalSecrets += fileSecrets;
    totalPII += filePII;
    if (hasInjection) totalInjection++;

    if (fileSecrets > 0 || filePII > 0 || hasInjection) {
      const details: string[] = [];
      for (const s of secretResult.secrets) {
        details.push(`- **${s.severity.toUpperCase()}**: ${s.type} detected`);
      }
      for (const p of piiResult.pii) {
        details.push(`- **${p.severity.toUpperCase()}**: ${p.type} (PII) detected`);
      }
      if (hasInjection) {
        details.push(
          `- **HIGH**: Prompt injection risk (score: ${injectionResult.score})`,
        );
      }

      const riskScore = Math.min(
        100,
        secretResult.secrets.reduce(
          (sum, s) =>
            sum + (s.severity === "critical" ? 40 : s.severity === "high" ? 20 : 10),
          0,
        ) +
          piiResult.pii.reduce(
            (sum, p) =>
              sum + (p.severity === "critical" ? 40 : p.severity === "high" ? 20 : 10),
            0,
          ) +
          (hasInjection ? 30 : 0),
      );

      findings.push({
        file: file.path,
        secrets: fileSecrets,
        pii: filePII,
        injectionRisk: hasInjection,
        riskScore,
        details,
      });
    }
  }

  // Sort by risk score descending
  const sorted = [...findings].sort((a, b) => b.riskScore - a.riskScore);

  // Generate markdown report
  const lines: string[] = [
    "# Security Review",
    "",
    `**Files scanned:** ${files.length}`,
    `**Findings:** ${totalSecrets} secrets, ${totalPII} PII, ${totalInjection} injection risks`,
    `**Files with issues:** ${findings.length}`,
    "",
  ];

  if (sorted.length === 0) {
    lines.push("No security issues found. All files are clean.");
  } else {
    lines.push("## Findings by File", "");

    for (const f of sorted) {
      lines.push(`### \`${f.file}\` (risk: ${f.riskScore})`);
      lines.push("");
      lines.push(...f.details);
      lines.push("");
    }

    lines.push("## Recommendations", "");
    if (totalSecrets > 0) {
      lines.push(
        "- **Secrets:** Move credentials to environment variables or a vault. Never commit API keys.",
      );
    }
    if (totalPII > 0) {
      lines.push(
        "- **PII:** Review data handling policies. Ensure PII is not logged or sent to third parties.",
      );
    }
    if (totalInjection > 0) {
      lines.push(
        "- **Injection:** Review flagged prompts for adversarial patterns. Validate all user inputs.",
      );
    }
  }

  return [
    {
      name: "Security Review",
      description: `${files.length} files scanned — ${findings.length} with issues`,
      content: lines.join("\n"),
    },
  ];
}
