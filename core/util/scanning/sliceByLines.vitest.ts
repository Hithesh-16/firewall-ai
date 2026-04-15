import { describe, expect, it } from "vitest";
import { findingInRange, sliceByLines } from "./sliceByLines.js";

describe("sliceByLines", () => {
  const text = ["zero", "one", "two", "three", "four"].join("\n");

  it("returns a single line for a collapsed range", () => {
    expect(sliceByLines(text, 2, 2)).toBe("two");
  });

  it("returns joined lines for a multi-line range", () => {
    expect(sliceByLines(text, 1, 3)).toBe("one\ntwo\nthree");
  });

  it("clamps past-end indices", () => {
    expect(sliceByLines(text, 3, 99)).toBe("three\nfour");
  });

  it("clamps negative start to zero", () => {
    expect(sliceByLines(text, -5, 1)).toBe("zero\none");
  });

  it("returns empty when start is past end", () => {
    expect(sliceByLines(text, 4, 2)).toBe("");
  });

  it("returns empty on empty text", () => {
    expect(sliceByLines("", 0, 10)).toBe("");
  });
});

describe("findingInRange", () => {
  it("finds line 1 (1-based) inside LSP range 0..0", () => {
    expect(findingInRange({ line: 1 }, 0, 0)).toBe(true);
  });

  it("excludes line 1 from range 1..2", () => {
    expect(findingInRange({ line: 1 }, 1, 2)).toBe(false);
  });

  it("includes line 3 (1-based) in LSP range 1..2 (lines 2..3 in 1-based)", () => {
    expect(findingInRange({ line: 3 }, 1, 2)).toBe(true);
  });

  it("excludes line outside the range at both ends", () => {
    expect(findingInRange({ line: 5 }, 0, 3)).toBe(false);
    expect(findingInRange({ line: 1 }, 2, 4)).toBe(false);
  });
});
