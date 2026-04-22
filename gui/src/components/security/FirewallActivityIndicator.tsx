/**
 * FirewallActivityIndicator — minimal single-line status + thin bar.
 *
 * The earlier vertical list of emoji + spinner rows looked noisy inside
 * the IDE chat. Users don't read the individual steps; they just want a
 * signal that the firewall is working and roughly how far along it is.
 * So we collapse the timeline into one line of text plus a 2px bar.
 */

import { useAppSelector } from "../../redux/hooks";
import {
  ACTIVITY_LABELS,
  type FirewallActivityStep,
} from "../../redux/slices/securitySlice";

const PIPELINE_ORDER: FirewallActivityStep[] = [
  "scanning_secrets",
  "scanning_pii",
  "scanning_injection",
  "counting_tokens",
  "checking_context_window",
  "reducing_context",
  "redacting",
  "checking_policy",
  "estimating_cost",
  "routing",
  "forwarding",
  "scanning_response",
  "complete",
];

function progressFor(step: FirewallActivityStep | undefined): number {
  if (!step) return 0;
  const idx = PIPELINE_ORDER.indexOf(step);
  if (idx < 0) return 0;
  return Math.round(((idx + 1) / PIPELINE_ORDER.length) * 100);
}

export function FirewallActivityIndicator() {
  const activity = useAppSelector((s) => s.security.firewallActivity);
  const isStreaming = useAppSelector((s) => s.session.isStreaming);

  if (!isStreaming || !activity) return null;

  const label = ACTIVITY_LABELS[activity.step];
  if (!label) return null;

  const text = label.text.replace(/\.\.\.$/, "");
  const pct = progressFor(activity.step);

  return (
    <div className="mx-3 mb-2">
      <div className="text-description-muted mb-1 text-[11px]">
        {text}
        {activity.detail ? ` · ${activity.detail}` : ""}
      </div>
      <div
        className="bg-border/40 h-[2px] w-full overflow-hidden rounded-full"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={text}
      >
        <div
          className="bg-info h-full transition-[width] duration-200 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
