/**
 * FirewallActivityIndicator
 *
 * Shows real-time firewall pipeline activity in the chat.
 * Displays a timeline of steps: scanning, policy check, token counting, etc.
 *
 * Follows Continue's existing ToolCallStatusMessage pattern (icon + text + spinner).
 */

import { useAppSelector } from "../../redux/hooks";
import {
  ACTIVITY_LABELS,
  type FirewallActivity,
} from "../../redux/slices/securitySlice";

function ActivityStep({
  activity,
  isCurrent,
}: {
  activity: FirewallActivity;
  isCurrent: boolean;
}) {
  const label = ACTIVITY_LABELS[activity.step];
  if (!label) return null;

  const displayText = activity.detail
    ? `${label.text.replace("...", "")} ${activity.detail}`
    : label.text;

  return (
    <div
      className={`flex items-center gap-2 py-0.5 text-xs transition-opacity duration-300 ${
        isCurrent ? "opacity-100" : "opacity-50"
      }`}
    >
      {/* Spinner for current step, icon for completed */}
      {isCurrent && activity.step !== "complete" ? (
        <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-info border-t-transparent" />
      ) : (
        <span className="inline-block w-3 text-center text-[10px] leading-3">
          {label.icon}
        </span>
      )}

      <span className="text-description">{displayText}</span>

      {/* Elapsed time for current step */}
      {isCurrent && activity.step !== "complete" && (
        <ElapsedBadge startedAt={activity.startedAt} />
      )}
    </div>
  );
}

function ElapsedBadge({ startedAt }: { startedAt: number }) {
  // Simple static display — no interval needed since steps change fast
  const elapsed = Date.now() - startedAt;
  if (elapsed < 500) return null; // Don't show for very fast steps

  return (
    <span className="text-[10px] text-description-muted">
      {elapsed < 1000 ? `${elapsed}ms` : `${(elapsed / 1000).toFixed(1)}s`}
    </span>
  );
}

export function FirewallActivityIndicator() {
  const activity = useAppSelector((s) => s.security.firewallActivity);
  const activityLog = useAppSelector((s) => s.security.activityLog);

  if (!activity && activityLog.length === 0) return null;

  // Show last 5 steps as a compact timeline
  const visibleSteps = activityLog.slice(-5);

  return (
    <div className="mx-3 mb-2 animate-in fade-in slide-in-from-top-1 duration-200">
      <div className="flex flex-col gap-0">
        {visibleSteps.map((step, idx) => (
          <ActivityStep
            key={`${step.step}-${step.startedAt}`}
            activity={step}
            isCurrent={idx === visibleSteps.length - 1 && activity !== null}
          />
        ))}
      </div>
    </div>
  );
}
