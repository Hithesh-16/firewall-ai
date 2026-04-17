import { render, screen } from "@testing-library/react";
import { Provider } from "react-redux";
import { describe, expect, it } from "vitest";
import { createMockStore } from "../../util/test/mockStore";
import { ScanResultBanner } from "./ScanResultBanner";

function renderBanner(initialSecurity: any) {
  const store = createMockStore({
    security: initialSecurity,
  } as any);
  return render(
    <Provider store={store}>
      <ScanResultBanner />
    </Provider>,
  );
}

describe("ScanResultBanner", () => {
  it("renders nothing when no scan result is present", () => {
    const { container } = renderBanner({
      lastScanResult: null,
      showBanner: false,
    });
    expect(container.firstChild).toBeNull();
  });

  it("renders findings with file:line chip when present", async () => {
    renderBanner({
      lastScanResult: {
        action: "REDACT",
        riskScore: 55,
        secretsCount: 1,
        piiCount: 0,
        entropyCount: 0,
        redactedTypes: ["AWS_KEY"],
        findings: [
          {
            type: "AWS_KEY",
            severity: "critical",
            category: "secret",
            maskedValue: "AKIA****LE",
            file: "src/config.ts",
            line: 12,
            column: 4,
          },
        ],
        timestamp: Date.now(),
      },
      showBanner: true,
    });

    // Header chip
    expect(screen.getByText("Redacted")).toBeInTheDocument();
    // Banner is expanded by default so findings render without a click
    expect(await screen.findByText("config.ts:12:4")).toBeInTheDocument();
    expect(screen.getByText("AWS_KEY")).toBeInTheDocument();
    expect(screen.getByText("AKIA****LE")).toBeInTheDocument();
  });

  it("falls back gracefully when finding has no file/line", async () => {
    renderBanner({
      lastScanResult: {
        action: "REDACT",
        riskScore: 30,
        secretsCount: 1,
        piiCount: 0,
        entropyCount: 0,
        redactedTypes: ["HIGH_ENTROPY"],
        findings: [
          {
            type: "HIGH_ENTROPY",
            severity: "high",
            category: "secret",
            maskedValue: "abcd**ef",
          },
        ],
        timestamp: Date.now(),
      },
      showBanner: true,
    });

    // Banner is expanded by default — findings visible without a click
    expect(await screen.findByText("HIGH_ENTROPY")).toBeInTheDocument();
    // No file:line chip rendered
    expect(screen.queryByText(/:1$/)).toBeNull();
  });
});
