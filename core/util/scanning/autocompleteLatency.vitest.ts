import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IDE } from "../../index";
import * as proxyModule from "../fileScanProxy";
import { wrapWithScanner } from "./ScanningIde";
import { _resetScanDecisionCache } from "./scanDecisionCache";
import { _resetScanReportChannel } from "./scanReportChannel";

/**
 * Regression guard rail from the scanner refactor plan:
 * "50-file autocomplete snippet fetch completes in under 100ms
 *  with a mocked proxy that sleeps 50ms per request".
 *
 * If the `autocomplete` purpose ever regresses to synchronous proxy
 * calls, this test takes ~2500ms instead of <100ms and fails
 * loudly. The assertion is on the `scanFileViaProxy` call count
 * as well as wall time — either alone would be a latency bomb.
 */

function makeFakeIde(): IDE {
  let counter = 0;
  const fake: any = {
    readFile: async (uri: string) => `content-${uri}-${counter++}`,
  };
  return fake;
}

describe("ScanningIde · autocomplete latency", () => {
  let scanSpy: any;

  beforeEach(() => {
    _resetScanDecisionCache();
    _resetScanReportChannel();
    scanSpy = vi
      .spyOn(proxyModule, "scanFileViaProxy")
      .mockImplementation((async () => {
        // Simulate a slow proxy. If autocomplete ever calls through,
        // this latency will surface immediately.
        await new Promise((r) => setTimeout(r, 50));
        return {
          action: "ALLOW",
          riskScore: 0,
          reasons: [],
          findings: [],
        };
      }) as any);
  });

  afterEach(() => {
    scanSpy.mockRestore();
  });

  it("reads 50 files at autocomplete purpose in <100ms and never calls the proxy", async () => {
    const ide = wrapWithScanner(makeFakeIde());
    const start = Date.now();
    const reads = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        ide.readFileWith(`/src/file${i}.ts`, "autocomplete"),
      ),
    );
    const elapsed = Date.now() - start;

    expect(reads).toHaveLength(50);
    expect(reads.every((r) => typeof r === "string")).toBe(true);
    expect(scanSpy).not.toHaveBeenCalled();
    expect(elapsed).toBeLessThan(100);
  });

  it("llm purpose *does* hit the proxy (contrasts the autocomplete path)", async () => {
    const ide = wrapWithScanner(makeFakeIde());
    await ide.readFileWith("/src/sensitive.ts", "llm");
    expect(scanSpy).toHaveBeenCalledTimes(1);
  });
});
