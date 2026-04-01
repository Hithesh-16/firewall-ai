import * as vscode from "vscode";

const SECRET_PATTERNS = [
  { regex: /AKIA[0-9A-Z]{16}/g, label: "AWS Key" },
  { regex: /-----BEGIN (?:RSA|EC|DSA|PRIVATE) KEY-----/g, label: "Private Key" },
  { regex: /eyJ[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+/g, label: "JWT" },
  { regex: /(postgres|mysql|mongodb):\/\/[^\s]+/gi, label: "Database URL" },
  { regex: /gh[pousr]_[A-Za-z0-9_]{36,}/g, label: "GitHub Token" },
  {
    regex: /(password|passwd|pwd)\s*[:=]\s*['"][^'"]{6,}['"]/gi,
    label: "Password",
  },
  {
    regex: /(api[_\-]?key|apikey)\s*[:=]\s*['"]?[A-Za-z0-9\-_]{20,}/gi,
    label: "API Key",
  },
];

const MAX_SCAN_LENGTH = 10_000;

/**
 * Scans open documents for secret patterns and shows shield annotations.
 * Users see: "$(shield) AI Firewall: AWS Key detected — will be redacted before AI access"
 */
export class SecretCodeLensProvider implements vscode.CodeLensProvider {
  public provideCodeLenses(
    document: vscode.TextDocument,
    _: vscode.CancellationToken,
  ): vscode.CodeLens[] {
    const text = document.getText().substring(0, MAX_SCAN_LENGTH);
    const codeLenses: vscode.CodeLens[] = [];
    const seenLines = new Set<number>();

    for (const pattern of SECRET_PATTERNS) {
      const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
      let match: RegExpExecArray | null;

      while ((match = regex.exec(text)) !== null) {
        const pos = document.positionAt(match.index);
        if (seenLines.has(pos.line)) {
          continue;
        }
        seenLines.add(pos.line);

        const range = new vscode.Range(pos.line, 0, pos.line, 0);
        codeLenses.push(
          new vscode.CodeLens(range, {
            title: `$(shield) AI Firewall: ${pattern.label} detected \u2014 will be redacted before AI access`,
            command: "aiFirewall.navigateTo",
            arguments: ["/security"],
            tooltip: `This line contains a ${pattern.label} that AI Firewall will automatically redact before sending to any AI provider`,
          }),
        );
      }
    }

    return codeLenses;
  }
}
