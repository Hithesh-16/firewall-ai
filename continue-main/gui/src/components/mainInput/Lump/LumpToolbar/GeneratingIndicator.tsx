import { AnimatedEllipsis } from "../../../AnimatedEllipsis";
import { useAppSelector } from "../../../../redux/hooks";
import { ACTIVITY_LABELS } from "../../../../redux/slices/securitySlice";

export function GeneratingIndicator({
  text = "Generating",
  testId,
}: {
  text?: string;
  testId?: string;
}) {
  const activity = useAppSelector((s) => s.security.firewallActivity);

  // Show firewall activity step if available, otherwise default "Generating"
  const displayIcon = activity && activity.step !== "complete"
    ? ACTIVITY_LABELS[activity.step]?.icon ?? ""
    : "";
  const displayText = activity && activity.step !== "complete"
    ? ACTIVITY_LABELS[activity.step]?.text ?? text
    : text;

  return (
    <div className="text-description flex items-center gap-1.5" data-testid={testId}>
      {/* Animated pulse dot */}
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-info opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-info" />
      </span>

      {displayIcon && (
        <span className="text-xs">{displayIcon}</span>
      )}

      <span className="text-xs">{displayText}</span>
      <AnimatedEllipsis />
    </div>
  );
}
