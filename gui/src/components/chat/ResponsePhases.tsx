import { useAppSelector } from "../../redux/hooks";
import type { FirewallActivityStep } from "../../redux/slices/securitySlice";

/**
 * Minimal phase-progress strip — one line of text + a thin bar.
 *
 * Replaces the earlier vertical dot-stepper. Users said that looked
 * noisy in the IDE, and once you know the pipeline is Scan → Policy
 * → LLM, seeing all four steps listed vertically doesn't earn its
 * screen space. A single sentence ("Scanning prompt…") plus a 2 px
 * bar that grows as the phase advances is enough signal.
 */

const PHASE_ORDER = ["scan", "policy", "llm", "response"] as const;
type PhaseId = (typeof PHASE_ORDER)[number];

const PHASE_LABEL: Record<PhaseId, string> = {
  scan: "Scanning prompt",
  policy: "Evaluating policy",
  llm: "Talking to the model",
  response: "Scanning response",
};

const STEP_TO_PHASE: Partial<Record<FirewallActivityStep, PhaseId>> = {
  scanning_secrets: "scan",
  scanning_pii: "scan",
  scanning_injection: "scan",
  counting_tokens: "scan",
  checking_context_window: "scan",
  reducing_context: "scan",
  redacting: "policy",
  checking_policy: "policy",
  estimating_cost: "policy",
  routing: "llm",
  forwarding: "llm",
  scanning_response: "response",
};

function phaseOf(step: FirewallActivityStep | undefined): PhaseId | null {
  if (!step) return null;
  return STEP_TO_PHASE[step] ?? null;
}

export function ResponsePhases({ visible }: { visible: boolean }) {
  const current = useAppSelector((s) => s.security.firewallActivity);

  if (!visible) return null;
  if (!current) return null;

  const activePhase = phaseOf(current.step);
  if (!activePhase) return null;

  // Auto-collapse once we're past the firewall stages — streaming
  // markdown takes over.
  if (activePhase === "llm" || activePhase === "response") return null;

  const phaseIndex = PHASE_ORDER.indexOf(activePhase);
  // 4 phases → 25% / 50% / 75% / 100%.
  const pct = Math.round(((phaseIndex + 1) / PHASE_ORDER.length) * 100);

  return (
    <div className="mb-2">
      <div className="text-description-muted mb-1 text-[11px]">
        {PHASE_LABEL[activePhase]}…
      </div>
      <div
        className="bg-border/40 h-[2px] w-full overflow-hidden rounded-full"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={PHASE_LABEL[activePhase]}
      >
        <div
          className="bg-info h-full transition-[width] duration-300 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
