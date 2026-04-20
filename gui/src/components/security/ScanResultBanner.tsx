import { ReactNode, useCallback, useEffect, useState } from "react";
import { SecurityLockIcon } from "../svg/SecurityLockIcon";
import { useAppDispatch, useAppSelector } from "../../redux/hooks";
import { dismissBanner } from "../../redux/slices/securitySlice";

/**
 * Auto-dismiss window for the banner. Set from the user request for a
 * 5-second redaction toast above the chat.
 */
const BANNER_AUTO_DISMISS_MS = 5_000;

/**
 * Scan Result Banner — compact inline tooltip that sits above the chat input.
 * Designed to feel like a native VS Code notification, not a separate panel.
 */

const ACTION_CONFIG: Record<
  string,
  {
    bg: string;
    border: string;
    icon: ReactNode;
    label: string;
    labelColor: string;
    badgeBg: string;
  }
> = {
  BLOCK: {
    bg: "bg-error/5",
    border: "border-error/30",
    icon: (
      <SecurityLockIcon
        size={14}
        color="var(--vscode-errorForeground, #f87171)"
      />
    ),
    label: "Blocked",
    labelColor: "text-error",
    badgeBg: "bg-error/10",
  },
  REDACT: {
    bg: "bg-warning/5",
    border: "border-warning/30",
    icon: (
      <SecurityLockIcon
        size={14}
        color="var(--vscode-charts-yellow, #fbbf24)"
      />
    ),
    label: "Redacted",
    labelColor: "text-warning",
    badgeBg: "bg-warning/10",
  },
  ALLOW: {
    bg: "bg-success/5",
    border: "border-success/20",
    icon: (
      <SecurityLockIcon size={14} color="var(--vscode-charts-green, #34d399)" />
    ),
    label: "Scanned",
    labelColor: "text-success",
    badgeBg: "bg-success/10",
  },
  REQUIRE_APPROVAL: {
    bg: "bg-info/5",
    border: "border-info/30",
    icon: (
      <SecurityLockIcon size={14} color="var(--vscode-charts-blue, #60a5fa)" />
    ),
    label: "Pending",
    labelColor: "text-info",
    badgeBg: "bg-info/10",
  },
};

export function ScanResultBanner() {
  const dispatch = useAppDispatch();
  const lastScan = useAppSelector((s) => s.security.lastScanResult);
  const showBanner = useAppSelector((s) => s.security.showBanner);
  // REDACT/BLOCK banners expand by default so the user sees which
  // values were touched without an extra click. ALLOW banners collapse.
  const [expanded, setExpanded] = useState(true);

  const onDismiss = useCallback(() => {
    dispatch(dismissBanner());
    setExpanded(false);
  }, [dispatch]);

  // Auto-dismiss after the configured window — resets whenever a new
  // scan arrives because `lastScan.timestamp` changes. Hovering pauses
  // the timer so the user can read longer banners.
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (!lastScan || !showBanner || paused) return;
    const handle = setTimeout(() => {
      dispatch(dismissBanner());
    }, BANNER_AUTO_DISMISS_MS);
    return () => clearTimeout(handle);
  }, [lastScan?.timestamp, showBanner, paused, dispatch]);

  useEffect(() => {
    // Re-expand when a new result arrives.
    setExpanded(true);
  }, [lastScan?.timestamp]);

  if (!lastScan || !showBanner) return null;
  if (lastScan.action === "ALLOW" && lastScan.riskScore === 0) return null;

  const cfg = ACTION_CONFIG[lastScan.action] ?? ACTION_CONFIG.ALLOW;
  const hasFindings = lastScan.findings && lastScan.findings.length > 0;

  // Summary chips
  const chips: Array<{ text: string; color: string }> = [];
  if (lastScan.secretsCount > 0) {
    chips.push({
      text: `${lastScan.secretsCount} secret${lastScan.secretsCount > 1 ? "s" : ""}`,
      color: "text-error",
    });
  }
  if (lastScan.piiCount > 0) {
    chips.push({
      text: `${lastScan.piiCount} PII`,
      color: "text-warning",
    });
  }

  const baseName = (filePath: string): string => {
    const idx = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
    return idx >= 0 ? filePath.slice(idx + 1) : filePath;
  };

  return (
    <div
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className={`mx-2 mb-1.5 rounded-lg border ${cfg.border} ${cfg.bg} animate-in fade-in slide-in-from-bottom-1 duration-200`}
    >
      {/* Single-line header — always visible */}
      <div className="flex items-center gap-2 px-3 py-1.5">
        <span className="flex flex-shrink-0 items-center">{cfg.icon}</span>

        <span className={`text-xs font-semibold ${cfg.labelColor}`}>
          {cfg.label}
        </span>

        <span className="text-description-muted text-[10px]">{"\u2022"}</span>
        <span className="text-description font-mono text-[10px]">
          Risk {lastScan.riskScore}
        </span>

        {chips.map((chip) => (
          <span
            key={chip.text}
            className={`${cfg.badgeBg} rounded px-1.5 py-0.5 text-[10px] font-medium ${chip.color}`}
          >
            {chip.text}
          </span>
        ))}

        {lastScan.redactedTypes.length > 0 && chips.length === 0 && (
          <span className="text-description truncate text-[10px]">
            {lastScan.redactedTypes.join(", ")}
          </span>
        )}

        {/* Spacer */}
        <div className="flex-1" />

        {/* Expand toggle — only if there are findings */}
        {hasFindings && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-description hover:text-foreground text-[10px] transition-colors"
          >
            {expanded ? "less" : `${lastScan.findings.length} found`}
          </button>
        )}

        {/* Close */}
        <button
          onClick={onDismiss}
          className="text-description hover:text-foreground flex-shrink-0 text-sm leading-none transition-colors"
          aria-label="Dismiss scan result"
        >
          {"\u00D7"}
        </button>
      </div>

      {/* Expandable findings — compact list */}
      {expanded && hasFindings && (
        <div className="border-border/20 mx-3 mb-2 flex flex-col gap-y-1 border-t pt-1.5">
          {lastScan.findings.slice(0, 8).map((f, i) => {
            const fileChip =
              f.file && f.line
                ? `${baseName(f.file)}:${f.line}${f.column ? ":" + f.column : ""}`
                : null;
            return (
              <span
                key={i}
                className="flex flex-wrap items-center gap-1 text-[10px]"
              >
                <span
                  className={`rounded px-1 font-mono font-medium ${
                    f.severity === "critical" || f.severity === "high"
                      ? "bg-error/10 text-error"
                      : "bg-warning/10 text-warning"
                  }`}
                >
                  {f.severity.slice(0, 4).toUpperCase()}
                </span>
                <span className="text-description">{f.type}</span>
                {fileChip && (
                  <code
                    className="bg-input text-description rounded px-1 font-mono"
                    title={f.file}
                  >
                    {fileChip}
                  </code>
                )}
                {f.maskedValue && (
                  <code className="text-error font-mono font-semibold">
                    {f.maskedValue}
                  </code>
                )}
              </span>
            );
          })}
          {lastScan.findings.length > 8 && (
            <span className="text-description-muted text-[10px]">
              +${lastScan.findings.length - 8} more
            </span>
          )}
        </div>
      )}
    </div>
  );
}
