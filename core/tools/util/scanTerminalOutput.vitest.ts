import { describe, it, expect } from "vitest";
import { scanTerminalOutput } from "./scanTerminalOutput";

describe("scanTerminalOutput", () => {
  it("passes clean output through unchanged", () => {
    const result = scanTerminalOutput("npm install completed successfully");
    expect(result.redacted).toBe(false);
    expect(result.scannedOutput).toBe("npm install completed successfully");
    expect(result.findings).toHaveLength(0);
  });

  it("handles empty string", () => {
    const result = scanTerminalOutput("");
    expect(result.redacted).toBe(false);
    expect(result.scannedOutput).toBe("");
  });

  it("handles whitespace-only string", () => {
    const result = scanTerminalOutput("   \n\t  ");
    expect(result.redacted).toBe(false);
  });

  it("detects and redacts AWS access key", () => {
    const output = "export AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE";
    const result = scanTerminalOutput(output);
    expect(result.redacted).toBe(true);
    expect(result.scannedOutput).toContain("[REDACTED:");
    expect(result.scannedOutput).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(result.findings.some((f) => f.type === "AWS_KEY")).toBe(true);
  });

  it("detects and redacts email addresses", () => {
    const output = "Logged in as admin@company.com successfully";
    const result = scanTerminalOutput(output);
    expect(result.redacted).toBe(true);
    expect(result.scannedOutput).toContain("[REDACTED:EMAIL]");
    expect(result.scannedOutput).not.toContain("admin@company.com");
  });

  it("detects and redacts JWT tokens", () => {
    const output =
      "Token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    const result = scanTerminalOutput(output);
    expect(result.redacted).toBe(true);
    expect(result.findings.some((f) => f.type === "JWT")).toBe(true);
  });

  it("detects and redacts database URLs", () => {
    const output = "DATABASE_URL=postgres://user:pass@host:5432/mydb";
    const result = scanTerminalOutput(output);
    expect(result.redacted).toBe(true);
    expect(result.scannedOutput).not.toContain("postgres://user:pass@host:5432/mydb");
  });

  it("handles multiple findings in same output", () => {
    const output = [
      "export AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE",
      "email: admin@company.com",
    ].join("\n");
    const result = scanTerminalOutput(output);
    expect(result.redacted).toBe(true);
    expect(result.findings.length).toBeGreaterThanOrEqual(2);
    expect(result.scannedOutput).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(result.scannedOutput).not.toContain("admin@company.com");
  });

  it("preserves non-sensitive parts of output", () => {
    const output = "Starting server on port 3000\nemail: admin@company.com\nReady.";
    const result = scanTerminalOutput(output);
    expect(result.scannedOutput).toContain("Starting server on port 3000");
    expect(result.scannedOutput).toContain("Ready.");
  });
});
