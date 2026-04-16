/**
 * Tests for plain-text-API-key detector — Phase A.A2
 * SECURITY_HARDENING_PLAN.md.
 */

import type { AssistantUnrolled } from "@ai-firewall/config-yaml";

import {
  publishScanReport as _publishScanReport,
  runInScanContextSync,
  subscribeScanReports,
  _resetScanReportChannel,
} from "../../util/scanning/scanReportChannel.js";
import type { ScanReport } from "../../util/scanning/FileBlockedByScanError.js";

import { scanLoadedConfigForPlaintextKeys } from "./scanLoadedConfig.js";

// `publishScanReport` is referenced for its presence — the function
// under test calls it via its own import. Marking it as used keeps
// the linter quiet about an "unused import" while making the test's
// dependency on the channel module explicit.
void _publishScanReport;

function makeAssistant(
  models: Array<{ name: string; provider?: string; apiKey?: string }>,
): AssistantUnrolled {
  return {
    name: "test-assistant",
    version: "0.0.1",
    models: models.map((m) => ({
      name: m.name,
      provider: m.provider ?? "openai",
      model: "dummy",
      ...(m.apiKey !== undefined ? { apiKey: m.apiKey } : {}),
    })),
  } as unknown as AssistantUnrolled;
}

function captureReportsFor(
  correlationId: string,
  fn: () => void,
): ScanReport[] {
  const collected: ScanReport[] = [];
  const unsubscribe = subscribeScanReports(correlationId, (r) =>
    collected.push(r),
  );
  try {
    runInScanContextSync(correlationId, fn);
  } finally {
    unsubscribe();
  }
  return collected;
}

describe("scanLoadedConfigForPlaintextKeys", () => {
  beforeEach(() => {
    _resetScanReportChannel();
  });

  it("emits a critical report for a literal Groq API key", () => {
    const assistant = makeAssistant([
      {
        name: "groq-fast",
        provider: "groq",
        apiKey: "gsk_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      },
    ]);

    const reports = captureReportsFor("corr-1", () => {
      const count = scanLoadedConfigForPlaintextKeys(
        assistant,
        "/tmp/config.yaml",
      );
      expect(count).toBe(1);
    });

    expect(reports).toHaveLength(1);
    expect(reports[0].filePath).toBe("/tmp/config.yaml");
    expect(reports[0].action).toBe("ALLOW");
    expect(reports[0].riskScore).toBeGreaterThanOrEqual(90);
    expect(reports[0].reasons[0]).toMatch(/Plain-text API key/i);
    const finding = reports[0].findings[0];
    expect(finding.type).toBe("GROQ_KEY");
    expect(finding.severity).toBe("critical");
    // Mask must not echo the raw key.
    expect(finding.masked).not.toContain(
      "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    );
  });

  it("ignores models that use a vault:// reference", () => {
    const assistant = makeAssistant([
      {
        name: "openai-prod",
        apiKey: "vault://openai-primary",
      },
    ]);

    const reports = captureReportsFor("corr-2", () => {
      const count = scanLoadedConfigForPlaintextKeys(
        assistant,
        "/tmp/config.yaml",
      );
      expect(count).toBe(0);
    });

    expect(reports).toHaveLength(0);
  });

  it("ignores models that use a ${{ secrets.X }} template", () => {
    const assistant = makeAssistant([
      {
        name: "templated",
        apiKey: "${{ secrets.OPENAI_API_KEY }}",
      },
    ]);

    const reports = captureReportsFor("corr-3", () => {
      scanLoadedConfigForPlaintextKeys(assistant, "/tmp/config.yaml");
    });

    expect(reports).toHaveLength(0);
  });

  it("ignores models with no apiKey field", () => {
    const assistant = makeAssistant([{ name: "no-key" }]);

    const reports = captureReportsFor("corr-4", () => {
      scanLoadedConfigForPlaintextKeys(assistant, "/tmp/config.yaml");
    });

    expect(reports).toHaveLength(0);
  });

  it("emits a generic finding when the literal value doesn't match any named pattern", () => {
    const assistant = makeAssistant([
      {
        name: "unknown-shape",
        // Not a known provider key prefix, but still a literal value.
        apiKey: "this-is-some-custom-token-format-12345",
      },
    ]);

    const reports = captureReportsFor("corr-5", () => {
      scanLoadedConfigForPlaintextKeys(assistant, "/tmp/config.yaml");
    });

    expect(reports).toHaveLength(1);
    expect(reports[0].findings[0].type).toBe("GENERIC_API_KEY");
  });

  it("emits one report per offending model and skips the safe ones", () => {
    const assistant = makeAssistant([
      {
        name: "leaky-1",
        apiKey: "sk-ant-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      },
      { name: "safe", apiKey: "vault://openai-primary" },
      {
        name: "leaky-2",
        apiKey: "sk-proj-BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
      },
    ]);

    const reports = captureReportsFor("corr-6", () => {
      const count = scanLoadedConfigForPlaintextKeys(
        assistant,
        "/tmp/config.yaml",
      );
      expect(count).toBe(2);
    });

    expect(reports).toHaveLength(2);
    expect(reports[0].findings[0].type).toBe("ANTHROPIC_KEY");
    expect(reports[1].findings[0].type).toBe("OPENAI_PROJECT_KEY");
  });

  it("silently drops reports when no scan context is active", () => {
    // No `runInScanContextSync` wrapper — publish should be a no-op.
    const assistant = makeAssistant([
      {
        name: "leaky",
        apiKey: "gsk_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      },
    ]);
    const collected: ScanReport[] = [];
    const unsubscribe = subscribeScanReports("corr-noop", (r) =>
      collected.push(r),
    );
    try {
      // The function still walks and returns the count, but
      // `publishScanReport` is a no-op outside a context.
      const count = scanLoadedConfigForPlaintextKeys(
        assistant,
        "/tmp/config.yaml",
      );
      expect(count).toBe(1);
      expect(collected).toHaveLength(0);
    } finally {
      unsubscribe();
    }
  });
});
