import { describe, expect, it, beforeEach } from "vitest";
import type { FileScanDecision } from "../fileScanProxy.js";
import {
  _cacheSize,
  _resetScanDecisionCache,
  getCachedDecision,
  invalidateCachedDecision,
  setCachedDecision,
} from "./scanDecisionCache.js";

function allow(filePath: string): FileScanDecision {
  return { action: "ALLOW", riskScore: 0, reasons: [], filePath, findings: [] };
}

function redact(filePath: string): FileScanDecision {
  return {
    action: "REDACT",
    riskScore: 40,
    reasons: ["email"],
    filePath,
    findings: [],
    redactedContent: "<REDACTED>",
  };
}

describe("scanDecisionCache", () => {
  beforeEach(() => _resetScanDecisionCache());

  it("returns null on miss", () => {
    expect(getCachedDecision("/a.txt", 1, "llm")).toBeNull();
  });

  it("hits after set with matching key", () => {
    setCachedDecision("/a.txt", 1, "llm", allow("/a.txt"));
    expect(getCachedDecision("/a.txt", 1, "llm")?.action).toBe("ALLOW");
  });

  it("mtime change is a miss", () => {
    setCachedDecision("/a.txt", 1, "llm", allow("/a.txt"));
    expect(getCachedDecision("/a.txt", 2, "llm")).toBeNull();
  });

  it("different purposes are distinct entries", () => {
    setCachedDecision("/a.txt", 1, "llm", allow("/a.txt"));
    setCachedDecision("/a.txt", 1, "indexing", redact("/a.txt"));
    expect(getCachedDecision("/a.txt", 1, "llm")?.action).toBe("ALLOW");
    expect(getCachedDecision("/a.txt", 1, "indexing")?.action).toBe("REDACT");
  });

  it("invalidateCachedDecision wipes all mtime+purpose variants", () => {
    setCachedDecision("/a.txt", 1, "llm", allow("/a.txt"));
    setCachedDecision("/a.txt", 2, "llm", allow("/a.txt"));
    setCachedDecision("/a.txt", 1, "indexing", allow("/a.txt"));
    setCachedDecision("/b.txt", 1, "llm", allow("/b.txt"));
    invalidateCachedDecision("/a.txt");
    expect(getCachedDecision("/a.txt", 1, "llm")).toBeNull();
    expect(getCachedDecision("/a.txt", 2, "llm")).toBeNull();
    expect(getCachedDecision("/a.txt", 1, "indexing")).toBeNull();
    expect(getCachedDecision("/b.txt", 1, "llm")?.action).toBe("ALLOW");
  });

  it("evicts LRU when exceeding capacity", () => {
    // Capacity is 5000; fill to 5050 and confirm the oldest 50 are gone.
    for (let i = 0; i < 5050; i++) {
      setCachedDecision(`/f${i}.txt`, 1, "llm", allow(`/f${i}.txt`));
    }
    expect(_cacheSize()).toBe(5000);
    expect(getCachedDecision("/f0.txt", 1, "llm")).toBeNull();
    expect(getCachedDecision("/f49.txt", 1, "llm")).toBeNull();
    expect(getCachedDecision("/f50.txt", 1, "llm")?.action).toBe("ALLOW");
    expect(getCachedDecision("/f5049.txt", 1, "llm")?.action).toBe("ALLOW");
  });

  it("get refreshes LRU ordering (frequently accessed survives)", () => {
    for (let i = 0; i < 5000; i++) {
      setCachedDecision(`/f${i}.txt`, 1, "llm", allow(`/f${i}.txt`));
    }
    // Touch f0 so it moves to the tail.
    getCachedDecision("/f0.txt", 1, "llm");
    // Now overflow — f1 (new oldest) should be evicted first, not f0.
    setCachedDecision("/new.txt", 1, "llm", allow("/new.txt"));
    expect(getCachedDecision("/f0.txt", 1, "llm")?.action).toBe("ALLOW");
    expect(getCachedDecision("/f1.txt", 1, "llm")).toBeNull();
  });
});
