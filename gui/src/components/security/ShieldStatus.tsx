import { SecurityLockIcon } from "../svg/SecurityLockIcon";
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
      className={`flex items-center gap-1.5 rounded-md px-2 py-1 ${bgColor} focus-visible:ring-border-focus transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2`}
      title={`AI Firewall: ${sessionStats.totalScanned} scanned, ${sessionStats.blocked} blocked, ${sessionStats.redacted} redacted`}
    >
      {/* Shield icon */}
      <SecurityLockIcon
        size={14}
        color="currentColor"
        className={shieldColor}
      />
      <span className={`text-xs font-medium ${shieldColor}`}>
        {shieldLabel}
      </span>
      {hasActivity && (
        <span className="text-description text-xs">
          {sessionStats.totalScanned}
        </span>
      )}
    </button>
  );
}
