import { describe, expect, it } from "vitest";
import {
  DEFAULT_SCAN_PURPOSE,
  allowsSyncProxy,
  bypassesScan,
  shouldEmitReport,
} from "./ScanPurpose.js";

describe("ScanPurpose", () => {
  it("defaults to llm — the safe default for unclassified callers", () => {
    expect(DEFAULT_SCAN_PURPOSE).toBe("llm");
  });

  it("only llm emits inline reports to the chat", () => {
    expect(shouldEmitReport("llm")).toBe(true);
    expect(shouldEmitReport("indexing")).toBe(false);
    expect(shouldEmitReport("autocomplete")).toBe(false);
    expect(shouldEmitReport("config")).toBe(false);
    expect(shouldEmitReport("raw")).toBe(false);
  });

  it("llm + indexing can do a sync proxy call; autocomplete cannot", () => {
    expect(allowsSyncProxy("llm")).toBe(true);
    expect(allowsSyncProxy("indexing")).toBe(true);
    expect(allowsSyncProxy("autocomplete")).toBe(false);
    expect(allowsSyncProxy("config")).toBe(false);
    expect(allowsSyncProxy("raw")).toBe(false);
  });

  it("config and raw bypass scanning entirely", () => {
    expect(bypassesScan("config")).toBe(true);
    expect(bypassesScan("raw")).toBe(true);
    expect(bypassesScan("llm")).toBe(false);
    expect(bypassesScan("indexing")).toBe(false);
    expect(bypassesScan("autocomplete")).toBe(false);
  });
});
