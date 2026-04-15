import {
  formatScanFindingsMarkdown,
  formatScanFindingsSummary,
} from "./formatScanFindings";
import type { FileScanFinding } from "./fileScanProxy";

const SAMPLE_FINDINGS: FileScanFinding[] = [
  {
    type: "AWS_KEY",
    severity: "critical",
    category: "secret",
    line: 12,
    column: 4,
    masked: "AKIA****LE",
  },
  {
    type: "EMAIL",
    severity: "medium",
    category: "pii",
    line: 27,
    column: 8,
    masked: "jo****@example.com",
  },
];

describe("formatScanFindingsMarkdown", () => {
  it("renders header + findings as bullet list", () => {
    const md = formatScanFindingsMarkdown(
      "src/config.ts",
      "REDACT",
      55,
      SAMPLE_FINDINGS,
    );
    expect(md).toContain("AI Firewall");
    expect(md).toContain("Redacted");
    expect(md).toContain("risk 55");
    expect(md).toContain("2 findings");
    expect(md).toContain("config.ts:12:4");
    expect(md).toContain("config.ts:27:8");
    expect(md).toContain("CRITICAL");
    expect(md).toContain("MEDIUM");
    expect(md).toContain("AKIA****LE");
    expect(md).toContain("jo****@example.com");
    // No raw value should appear since findings only carry masked.
    expect(md).not.toContain("AKIAIOSFODNN");
  });

  it("uses singular noun for one finding", () => {
    const md = formatScanFindingsMarkdown(
      "src/x.ts",
      "REDACT",
      30,
      SAMPLE_FINDINGS.slice(0, 1),
    );
    expect(md).toContain("1 finding");
    expect(md).not.toContain("1 findings");
  });

  it("renders header only when no findings", () => {
    const md = formatScanFindingsMarkdown("src/x.ts", "ALLOW", 0, []);
    expect(md).toContain("Allowed");
    expect(md).toContain("0 findings");
    expect(md).not.toContain("- `");
  });

  it("collapses overflow past 20 findings", () => {
    const many: FileScanFinding[] = Array.from({ length: 25 }, (_, i) => ({
      type: "HIGH_ENTROPY",
      severity: "high",
      category: "secret",
      line: i + 1,
      column: 1,
      masked: "abcd**ef",
    }));
    const md = formatScanFindingsMarkdown("x.ts", "REDACT", 50, many);
    expect(md).toContain("and 5 more");
  });
});

describe("formatScanFindingsSummary", () => {
  it("returns plain action label for empty findings", () => {
    expect(formatScanFindingsSummary("ALLOW", [])).toBe("Allowed");
    expect(formatScanFindingsSummary("BLOCK", [])).toBe("Blocked");
  });

  it("groups by type with multiplicity", () => {
    const findings: FileScanFinding[] = [
      ...Array.from({ length: 3 }, () => ({
        type: "HIGH_ENTROPY",
        severity: "high",
        category: "secret" as const,
        line: 1,
        column: 1,
        masked: "x",
      })),
      {
        type: "EMAIL",
        severity: "medium",
        category: "pii",
        line: 2,
        column: 1,
        masked: "x",
      },
    ];
    const summary = formatScanFindingsSummary("REDACT", findings);
    expect(summary).toContain("Redacted 4 findings");
    expect(summary).toContain("HIGH_ENTROPY×3");
    expect(summary).toContain("EMAIL");
  });
});
