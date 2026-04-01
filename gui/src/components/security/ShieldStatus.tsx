import { useNavigate } from "react-router-dom";
import { useAppSelector } from "../../redux/hooks";
import { ROUTES } from "../../util/navigation";

export function ShieldStatus() {
  const navigate = useNavigate();
  const { sessionStats, proxyHealthy, lastScanResult } = useAppSelector(
    (s) => s.security,
  );

  const hasActivity = sessionStats.totalScanned > 0;

  // Determine shield state
  let shieldColor = "text-description-muted";
  let shieldLabel = "Offline";
  let bgColor = "bg-secondary";

  if (proxyHealthy) {
    if (!hasActivity) {
      shieldColor = "text-success";
      shieldLabel = "Protected";
      bgColor = "bg-success/10";
    } else if (sessionStats.blocked > 0) {
      shieldColor = "text-error";
      shieldLabel = `${sessionStats.blocked} blocked`;
      bgColor = "bg-error/10";
    } else if (sessionStats.redacted > 0) {
      shieldColor = "text-warning";
      shieldLabel = `${sessionStats.redacted} redacted`;
      bgColor = "bg-warning/10";
    } else {
      shieldColor = "text-success";
      shieldLabel = "Clean";
      bgColor = "bg-success/10";
    }
  }

  return (
    <button
      onClick={() => navigate(ROUTES.SECURITY)}
      className={`flex items-center gap-1.5 px-2 py-1 rounded-md ${bgColor} hover:opacity-80 transition-opacity focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:outline-none`}
      title={`AI Firewall: ${sessionStats.totalScanned} scanned, ${sessionStats.blocked} blocked, ${sessionStats.redacted} redacted`}
    >
      {/* Shield icon */}
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={shieldColor}
      >
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
      <span className={`text-xs font-medium ${shieldColor}`}>
        {shieldLabel}
      </span>
      {hasActivity && (
        <span className="text-xs text-description">
          {sessionStats.totalScanned}
        </span>
      )}
    </button>
  );
}
