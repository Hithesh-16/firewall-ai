import { describe, expect, it, beforeEach } from "vitest";
import {
  _resetScanReportChannel,
  currentCorrelationId,
  dedupeReports,
  publishScanReport,
  runInScanContextSync,
  subscribeScanReports,
} from "./scanReportChannel.js";
import type { ScanReport } from "./FileBlockedByScanError.js";

function makeReport(
  filePath: string,
  action: ScanReport["action"] = "REDACT",
): ScanReport {
  return {
    filePath,
    action,
    riskScore: 40,
    reasons: ["test"],
    findings: [],
  };
}

describe("scanReportChannel", () => {
  beforeEach(() => _resetScanReportChannel());

  it("currentCorrelationId returns undefined outside a context", () => {
    expect(currentCorrelationId()).toBeUndefined();
  });

  it("runInScanContext populates currentCorrelationId", () => {
    runInScanContextSync("turn-1", () => {
      expect(currentCorrelationId()).toBe("turn-1");
    });
  });

  it("publish without a correlation id is silently dropped", () => {
    const received: ScanReport[] = [];
    subscribeScanReports("turn-1", (r) => received.push(r));
    // Publish outside any context — should NOT reach the handler.
    publishScanReport(makeReport("/a.txt"));
    expect(received).toEqual([]);
  });

  it("publish inside a context reaches the matching subscriber", () => {
    const received: ScanReport[] = [];
    subscribeScanReports("turn-1", (r) => received.push(r));
    runInScanContextSync("turn-1", () => {
      publishScanReport(makeReport("/a.txt"));
    });
    expect(received).toHaveLength(1);
    expect(received[0].filePath).toBe("/a.txt");
  });

  it("subscribers for a different correlation id never see another turn's reports", () => {
    const turn1: ScanReport[] = [];
    const turn2: ScanReport[] = [];
    subscribeScanReports("turn-1", (r) => turn1.push(r));
    subscribeScanReports("turn-2", (r) => turn2.push(r));
    runInScanContextSync("turn-1", () =>
      publishScanReport(makeReport("/a.txt")),
    );
    runInScanContextSync("turn-2", () =>
      publishScanReport(makeReport("/b.txt")),
    );
    expect(turn1.map((r) => r.filePath)).toEqual(["/a.txt"]);
    expect(turn2.map((r) => r.filePath)).toEqual(["/b.txt"]);
  });

  it("unsubscribe removes the handler and frees the correlation id bucket", () => {
    const received: ScanReport[] = [];
    const unsub = subscribeScanReports("turn-1", (r) => received.push(r));
    unsub();
    runInScanContextSync("turn-1", () =>
      publishScanReport(makeReport("/a.txt")),
    );
    expect(received).toEqual([]);
  });

  it("handler throws do not break the publish loop", () => {
    const received: ScanReport[] = [];
    subscribeScanReports("turn-1", () => {
      throw new Error("boom");
    });
    subscribeScanReports("turn-1", (r) => received.push(r));
    runInScanContextSync("turn-1", () =>
      publishScanReport(makeReport("/a.txt")),
    );
    expect(received).toHaveLength(1);
  });

  it("dedupeReports keeps the first occurrence per filePath", () => {
    const input = [
      makeReport("/a.txt"),
      makeReport("/b.txt"),
      makeReport("/a.txt", "BLOCK"),
      makeReport("/c.txt"),
    ];
    const out = dedupeReports(input);
    expect(out.map((r) => r.filePath)).toEqual(["/a.txt", "/b.txt", "/c.txt"]);
    expect(out[0].action).toBe("REDACT");
  });
});
