import { useState } from "react";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import { onboardingActions } from "../../store/slices/onboardingSlice";
import { apiClient } from "../../api/client";
import { ENDPOINTS } from "../../api/endpoints";
import { cn } from "../../utils/cn";
import { WizardCard, WizardError, WizardNav } from "./_shared";

/**
 * Step 4 — Policy configuration.
 *
 * This is the most important step. The user tunes the scanner thresholds
 * (block/redact/allow), toggles response scanning + MCP gateway, and
 * optionally enables cost-aware routing.
 *
 * Defaults are conservative (scanners on, response-scanning off, MCP
 * gateway + audit on, cost routing off) so a user who rushes through
 * the wizard still ends up in a safe baseline.
 *
 * Everything writes to POST /api/policy on Continue. The proxy accepts
 * a partial policy and merges it with the existing one.
 */

type ScannerKey = "secrets" | "pii" | "promptInjection" | "entropy" | "unicode";

const SCANNER_META: Record<ScannerKey, { label: string; description: string }> = {
  secrets: {
    label: "Secrets",
    description: "API keys, tokens, private keys, DB URLs, JWTs.",
  },
  pii: {
    label: "PII",
    description: "Email, phone, SSN, credit card, Aadhaar, PAN, IP.",
  },
  promptInjection: {
    label: "Prompt Injection",
    description: "Jailbreak attempts, instruction override, role-play attacks.",
  },
  entropy: {
    label: "Entropy Analysis",
    description: "High-entropy strings likely to be secrets or tokens.",
  },
  unicode: {
    label: "Unicode Anomalies",
    description: "Zero-width chars, confusable letters, bidi overrides.",
  },
};

function Slider({
  label,
  value,
  onChange,
  min = 0,
  max = 100,
  color,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  color: "red" | "amber";
}) {
  const trackColor = color === "red" ? "accent-red-500" : "accent-amber-500";
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-slate-400">{label}</span>
        <span className="text-slate-200">{value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={cn("w-full", trackColor)}
      />
    </div>
  );
}

export function Step4Policy({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const dispatch = useAppDispatch();
  const wizard = useAppSelector((s) => s.onboarding);
  const [policy, setPolicy] = useState(wizard.policy);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function updateScanner(
    key: ScannerKey,
    patch: Partial<{ enabled: boolean; block: number; redact: number }>,
  ) {
    setPolicy((p) => ({
      ...p,
      scanners: {
        ...p.scanners,
        [key]: { ...p.scanners[key], ...patch },
      },
    }));
  }

  async function handleContinue() {
    setError(null);
    setBusy(true);
    try {
      // Wizard-shaped endpoint: the proxy translates this into the
      // real PolicyConfig fields and merges with the existing file.
      await apiClient.post(ENDPOINTS.policy.wizard, {
        scanners: policy.scanners,
        responseScanning: policy.responseScanning,
        mcpGateway: policy.mcpGateway,
        mcpAudit: policy.mcpAudit,
        costRouting: {
          enabled: policy.costRouting.enabled,
          perRequestUsdCap: policy.costRouting.perRequestUsdCap,
        },
      });

      dispatch(onboardingActions.setPolicy(policy));
      onNext();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save policy");
    } finally {
      setBusy(false);
    }
  }

  return (
    <WizardCard
      title="Set your security policy"
      subtitle="These defaults are a solid baseline. Drag the sliders if you need to be stricter or more permissive."
    >
      <div className="space-y-5">
        {/* Scanners */}
        <div>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
            Scanner thresholds
          </h3>
          <div className="space-y-3">
            {(Object.keys(SCANNER_META) as ScannerKey[]).map((key) => {
              const s = policy.scanners[key];
              const meta = SCANNER_META[key];
              return (
                <div
                  key={key}
                  className={cn(
                    "rounded-lg border bg-slate-950/40 p-3",
                    s.enabled ? "border-slate-800" : "border-slate-900 opacity-50",
                  )}
                >
                  <div className="mb-2 flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-slate-100">{meta.label}</p>
                      <p className="text-xs text-slate-500">{meta.description}</p>
                    </div>
                    <label className="relative inline-flex shrink-0 cursor-pointer items-center">
                      <input
                        type="checkbox"
                        checked={s.enabled}
                        onChange={(e) => updateScanner(key, { enabled: e.target.checked })}
                        className="peer sr-only"
                      />
                      <div className="peer h-5 w-9 rounded-full bg-slate-700 after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-all peer-checked:bg-emerald-500 peer-checked:after:translate-x-full" />
                    </label>
                  </div>
                  {s.enabled && (
                    <div className="grid grid-cols-2 gap-4">
                      <Slider
                        label="Block ≥"
                        value={s.block}
                        onChange={(v) => updateScanner(key, { block: v })}
                        color="red"
                      />
                      <Slider
                        label="Redact ≥"
                        value={s.redact}
                        onChange={(v) => updateScanner(key, { redact: v })}
                        color="amber"
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Toggles */}
        <div>
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
            Additional protections
          </h3>
          <div className="space-y-2">
            <ToggleRow
              label="Scan LLM responses"
              description="Also scan model output for leaked secrets and PII."
              checked={policy.responseScanning}
              onChange={(v) => setPolicy({ ...policy, responseScanning: v })}
            />
            <ToggleRow
              label="MCP gateway scanning"
              description="Scan every MCP tool input and output."
              checked={policy.mcpGateway}
              onChange={(v) => setPolicy({ ...policy, mcpGateway: v })}
            />
            <ToggleRow
              label="MCP audit log"
              description="Record every MCP tool call for compliance review."
              checked={policy.mcpAudit}
              onChange={(v) => setPolicy({ ...policy, mcpAudit: v })}
            />
            <ToggleRow
              label="Cost-aware routing"
              description="Refuse requests projected to cost more than a cap."
              checked={policy.costRouting.enabled}
              onChange={(v) =>
                setPolicy({
                  ...policy,
                  costRouting: { ...policy.costRouting, enabled: v },
                })
              }
            />
            {policy.costRouting.enabled && (
              <div className="ml-3 flex items-center gap-2 pt-1">
                <span className="text-xs text-slate-400">Max USD per request</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={policy.costRouting.perRequestUsdCap ?? ""}
                  onChange={(e) =>
                    setPolicy({
                      ...policy,
                      costRouting: {
                        ...policy.costRouting,
                        perRequestUsdCap: e.target.value ? Number(e.target.value) : undefined,
                      },
                    })
                  }
                  className="w-24 rounded-md border border-slate-700 bg-slate-950/60 px-2 py-1 text-sm text-slate-100 focus:border-emerald-500/60 focus:outline-none"
                />
              </div>
            )}
          </div>
        </div>
      </div>

      <WizardError message={error} />
      <WizardNav onBack={onBack} onNext={handleContinue} busy={busy} />
    </WizardCard>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2.5">
      <div>
        <p className="text-sm font-medium text-slate-100">{label}</p>
        <p className="text-xs text-slate-500">{description}</p>
      </div>
      <label className="relative inline-flex shrink-0 cursor-pointer items-center">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
          className="peer sr-only"
        />
        <div className="peer h-5 w-9 rounded-full bg-slate-700 after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-all peer-checked:bg-emerald-500 peer-checked:after:translate-x-full" />
      </label>
    </div>
  );
}
