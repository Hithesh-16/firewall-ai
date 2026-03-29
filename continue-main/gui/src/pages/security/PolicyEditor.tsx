import { useEffect, useState } from "react";

const PROXY_URL = "http://localhost:8080";

interface PolicyRules {
  block_private_keys: boolean;
  block_aws_keys: boolean;
  redact_emails: boolean;
  redact_phones: boolean;
  redact_ips: boolean;
  redact_jwt: boolean;
  redact_generic_api_keys: boolean;
  block_database_urls: boolean;
  redact_ssn: boolean;
  redact_credit_cards: boolean;
  redact_aadhaar: boolean;
  redact_pan: boolean;
}

interface SeverityThresholds {
  critical: number;
  high: number;
  medium: number;
}

interface PromptInjection {
  enabled: boolean;
  threshold: number;
  action: string;
}

interface PolicyConfig {
  rules: PolicyRules;
  severity_thresholds: SeverityThresholds;
  prompt_injection: PromptInjection;
  file_scope: {
    mode: string;
    blocklist: string[];
  };
  smart_routing?: {
    enabled: boolean;
    local_url: string;
  };
}

const RULE_LABELS: Record<keyof PolicyRules, { label: string; severity: string }> = {
  block_private_keys: { label: "Block Private Keys", severity: "critical" },
  block_aws_keys: { label: "Block AWS Keys", severity: "critical" },
  block_database_urls: { label: "Block Database URLs", severity: "critical" },
  redact_emails: { label: "Redact Emails", severity: "medium" },
  redact_phones: { label: "Redact Phone Numbers", severity: "medium" },
  redact_ips: { label: "Redact IP Addresses", severity: "medium" },
  redact_jwt: { label: "Redact JWT Tokens", severity: "high" },
  redact_generic_api_keys: { label: "Redact API Keys", severity: "high" },
  redact_ssn: { label: "Redact SSN", severity: "critical" },
  redact_credit_cards: { label: "Redact Credit Cards", severity: "critical" },
  redact_aadhaar: { label: "Redact Aadhaar", severity: "high" },
  redact_pan: { label: "Redact PAN", severity: "high" },
};

const SEVERITY_COLORS: Record<string, string> = {
  critical: "text-error",
  high: "text-warning",
  medium: "text-info",
};

export function PolicyEditor() {
  const [policy, setPolicy] = useState<PolicyConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchPolicy();
  }, []);

  async function fetchPolicy() {
    try {
      const res = await fetch(`${PROXY_URL}/api/policy`);
      if (res.ok) {
        const data = await res.json();
        setPolicy(data);
      }
    } catch {
      setError("Could not load policy. Is the proxy running?");
    }
  }

  async function savePolicy() {
    if (!policy) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await fetch(`${PROXY_URL}/api/policy`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(policy),
      });
      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      } else {
        const data = await res.json();
        setError(data.error || "Failed to save");
      }
    } catch {
      setError("Network error saving policy");
    } finally {
      setSaving(false);
    }
  }

  function toggleRule(key: keyof PolicyRules) {
    if (!policy) return;
    setPolicy({
      ...policy,
      rules: { ...policy.rules, [key]: !policy.rules[key] },
    });
  }

  function updateThreshold(key: keyof SeverityThresholds, value: number) {
    if (!policy) return;
    setPolicy({
      ...policy,
      severity_thresholds: { ...policy.severity_thresholds, [key]: value },
    });
  }

  function togglePromptInjection() {
    if (!policy) return;
    setPolicy({
      ...policy,
      prompt_injection: {
        ...policy.prompt_injection,
        enabled: !policy.prompt_injection.enabled,
      },
    });
  }

  function updateInjectionThreshold(value: number) {
    if (!policy) return;
    setPolicy({
      ...policy,
      prompt_injection: { ...policy.prompt_injection, threshold: value },
    });
  }

  if (!policy) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-2">
        {error ? (
          <div className="bg-error/5 border border-error/30 rounded-lg px-4 py-3 text-center">
            <p className="text-sm text-error">{error}</p>
            <p className="text-xs text-description-muted mt-1">
              Start the proxy on port 8080 to manage policies.
            </p>
          </div>
        ) : (
          <p className="text-sm text-description animate-pulse">Loading policy...</p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 overflow-y-auto">
      {/* Save bar */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-description">
          Toggle rules and adjust thresholds. Changes apply immediately on save.
        </p>
        <button
          onClick={savePolicy}
          disabled={saving}
          className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:outline-none ${
            saved
              ? "bg-success text-foreground"
              : "bg-badge text-badge-foreground hover:opacity-90"
          } disabled:opacity-50`}
        >
          {saving ? "Saving..." : saved ? "Saved" : "Save Policy"}
        </button>
      </div>

      {error && (
        <div className="bg-error/5 border border-error/30 rounded-lg px-3 py-2 text-xs text-error">
          {error}
        </div>
      )}

      {/* Detection Rules */}
      <section>
        <h3 className="text-sm font-medium text-foreground mb-2">
          Detection Rules
        </h3>
        <div className="flex flex-col gap-1">
          {(Object.keys(RULE_LABELS) as (keyof PolicyRules)[]).map((key) => {
            const { label, severity } = RULE_LABELS[key];
            const enabled = policy.rules[key];
            return (
              <button
                key={key}
                onClick={() => toggleRule(key)}
                className="flex items-center justify-between bg-secondary-background rounded-lg px-3 py-2 hover:opacity-90 transition-opacity focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:outline-none"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`text-xs font-mono uppercase ${SEVERITY_COLORS[severity]}`}
                  >
                    {severity.slice(0, 4)}
                  </span>
                  <span className="text-sm text-foreground">{label}</span>
                </div>
                <div
                  className={`w-9 h-5 rounded-full transition-colors flex items-center ${
                    enabled ? "bg-primary justify-end" : "bg-secondary-background justify-start"
                  }`}
                >
                  <div className="w-4 h-4 rounded-full bg-foreground mx-0.5" />
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* Severity Thresholds */}
      <section>
        <h3 className="text-sm font-medium text-foreground mb-2">
          Risk Score Thresholds
        </h3>
        <div className="flex flex-col gap-3 bg-secondary-background rounded-lg p-3">
          {(["critical", "high", "medium"] as const).map((level) => (
            <div key={level} className="flex items-center gap-3">
              <span
                className={`text-xs font-mono w-16 uppercase ${SEVERITY_COLORS[level]}`}
              >
                {level}
              </span>
              <input
                type="range"
                min={0}
                max={100}
                value={policy.severity_thresholds[level]}
                onChange={(e) =>
                  updateThreshold(level, Number(e.target.value))
                }
                className="flex-1 h-1.5 accent-accent"
              />
              <span className="text-xs font-mono text-foreground w-8 text-right">
                {policy.severity_thresholds[level]}
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Prompt Injection */}
      <section>
        <h3 className="text-sm font-medium text-foreground mb-2">
          Prompt Injection Detection
        </h3>
        <div className="bg-secondary-background rounded-lg p-3 flex flex-col gap-3">
          <button
            onClick={togglePromptInjection}
            className="flex items-center justify-between focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:outline-none"
          >
            <span className="text-sm text-foreground">Enabled</span>
            <div
              className={`w-9 h-5 rounded-full transition-colors flex items-center ${
                policy.prompt_injection.enabled
                  ? "bg-primary justify-end"
                  : "bg-secondary-background justify-start"
              }`}
            >
              <div className="w-4 h-4 rounded-full bg-foreground mx-0.5" />
            </div>
          </button>
          {policy.prompt_injection.enabled && (
            <div className="flex items-center gap-3">
              <span className="text-xs text-description w-16">Threshold</span>
              <input
                type="range"
                min={0}
                max={100}
                value={policy.prompt_injection.threshold}
                onChange={(e) =>
                  updateInjectionThreshold(Number(e.target.value))
                }
                className="flex-1 h-1.5 accent-accent"
              />
              <span className="text-xs font-mono text-foreground w-8 text-right">
                {policy.prompt_injection.threshold}
              </span>
            </div>
          )}
        </div>
      </section>

      {/* File Scope Summary */}
      <section>
        <h3 className="text-sm font-medium text-foreground mb-2">
          File Scope ({policy.file_scope.mode})
        </h3>
        <div className="bg-secondary-background rounded-lg p-3">
          <div className="flex flex-wrap gap-1">
            {policy.file_scope.blocklist.map((pattern) => (
              <span
                key={pattern}
                className="bg-error/10 text-error text-xs px-2 py-0.5 rounded font-mono"
              >
                {pattern}
              </span>
            ))}
          </div>
          <p className="text-xs text-description mt-2">
            Manage restricted patterns in the Security Perimeter setup.
          </p>
        </div>
      </section>

      {/* Smart Routing */}
      {policy.smart_routing && (
        <section>
          <h3 className="text-sm font-medium text-foreground mb-2">
            Smart Routing
          </h3>
          <div className="bg-secondary-background rounded-lg p-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-foreground">
                Route high-risk to local LLM
              </span>
              <span
                className={`text-xs font-medium px-2 py-0.5 rounded ${
                  policy.smart_routing.enabled
                    ? "bg-success/15 text-success"
                    : "bg-secondary text-description-muted"
                }`}
              >
                {policy.smart_routing.enabled ? "ON" : "OFF"}
              </span>
            </div>
            {policy.smart_routing.enabled && (
              <p className="text-xs text-description mt-1 font-mono">
                {policy.smart_routing.local_url}
              </p>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
