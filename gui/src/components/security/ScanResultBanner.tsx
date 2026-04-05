import { useCallback } from "react";
import { useAppDispatch, useAppSelector } from "../../redux/hooks";
import { dismissBanner } from "../../redux/slices/securitySlice";

/**
 * Scan Result Banner — floating notification card matching AI Firewall's session limit style.
 * Appears above the input box after each scan with BLOCK/REDACT/REQUIRE_APPROVAL results.
 */

// Color configs per action — uses semantic colors with alpha for the glow effect
const BANNER_STYLES: Record<
  string,
  {
    borderColor: string;
    glowColor: string;
    icon: string;
    title: string;
    titleColor: string;
    linkColor: string;
  }
> = {
  BLOCK: {
    borderColor: "border-error/40",
    glowColor: "shadow-[0_0_15px_rgba(239,68,68,0.15)]",
    icon: "\u26D4",
    title: "Blocked",
    titleColor: "text-error",
    linkColor: "text-error",
  },
  REDACT: {
    borderColor: "border-warning/40",
    glowColor: "shadow-[0_0_15px_rgba(245,158,11,0.15)]",
    icon: "\u26A0\uFE0F",
    title: "Redacted",
    titleColor: "text-warning",
    linkColor: "text-warning",
  },
  ALLOW: {
    borderColor: "border-success/30",
    glowColor: "shadow-[0_0_10px_rgba(52,211,153,0.1)]",
    icon: "\u2705",
    title: "Scanned",
    titleColor: "text-success",
    linkColor: "text-success",
  },
  REQUIRE_APPROVAL: {
    borderColor: "border-info/40",
    glowColor: "shadow-[0_0_15px_rgba(96,165,250,0.15)]",
    icon: "\u23F3",
    title: "Approval Required",
    titleColor: "text-info",
    linkColor: "text-info",
  },
};

export function ScanResultBanner() {
  const dispatch = useAppDispatch();
  const lastScan = useAppSelector((s) => s.security.lastScanResult);
  const showBanner = useAppSelector((s) => s.security.showBanner);

  const onDismiss = useCallback(() => {
    dispatch(dismissBanner());
  }, [dispatch]);

  if (!lastScan || !showBanner) return null;
  if (lastScan.action === "ALLOW" && lastScan.riskScore === 0) return null;

  const style = BANNER_STYLES[lastScan.action] ?? BANNER_STYLES.ALLOW;

  // Build detail string
  const parts: string[] = [];
  if (lastScan.secretsCount > 0) {
    parts.push(
      `${lastScan.secretsCount} secret${lastScan.secretsCount > 1 ? "s" : ""}`,
    );
  }
  if (lastScan.piiCount > 0) {
    parts.push(
      `${lastScan.piiCount} PII item${lastScan.piiCount > 1 ? "s" : ""}`,
    );
  }
  if (lastScan.redactedTypes.length > 0) {
    parts.push(lastScan.redactedTypes.join(", "));
  }
  const detailText = parts.length > 0 ? parts.join(" \u00B7 ") : "";

  return (
    <div
      className={`bg-editor mx-2 mb-2 flex items-center gap-3 rounded-xl border px-4 py-2.5 ${style.borderColor} ${style.glowColor} animate-in fade-in slide-in-from-top-2 duration-300`}
    >
      {/* Icon + Text */}
      <span className="flex-shrink-0 text-base">{style.icon}</span>

      <div className="min-w-0 flex-1">
        <span className={`text-sm font-semibold ${style.titleColor}`}>
          {style.title}
        </span>
        {detailText && (
          <>
            <span className="text-description mx-1.5">{"\u00B7"}</span>
            <span className="text-description text-xs">{detailText}</span>
          </>
        )}
        <span className="text-description mx-1.5">{"\u00B7"}</span>
        <span className="text-description font-mono text-xs">
          Risk {lastScan.riskScore}
        </span>
      </div>

      {/* Close button — matches the "x" from the screenshot */}
      <button
        onClick={onDismiss}
        className={`flex-shrink-0 ${style.linkColor} hover:text-foreground focus-visible:ring-border-focus text-base leading-none transition-colors focus-visible:outline-none focus-visible:ring-2`}
        title="Dismiss"
      >
        {"\u00D7"}
      </button>

      {/* Findings detail — show each detected item in red */}
      {lastScan.findings && lastScan.findings.length > 0 && (
        <div className="border-border/30 mt-1.5 w-full border-t pt-1.5">
          {lastScan.findings.map((f, i) => (
            <div key={i} className="flex items-center gap-2 py-0.5">
              <span
                className={`rounded px-1 font-mono text-xs ${
                  f.severity === "critical" || f.severity === "high"
                    ? "bg-error/10 text-error"
                    : "bg-warning/10 text-warning"
                }`}
              >
                {f.severity.toUpperCase()}
              </span>
              <span className="text-description text-xs">{f.type}</span>
              <code className="text-error font-mono text-xs font-bold">
                {f.maskedValue}
              </code>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
