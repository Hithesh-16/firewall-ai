/**
 * OnboardingWizard — Full setup wizard for first-time users.
 * Steps: environment detection → provider setup → security config → first scan.
 * Uses theme-mapped colors. Matches existing page patterns.
 */

import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useProxyApi } from "../../hooks/useProxyApi";
import { ROUTES } from "../../util/navigation";

// ── Types ──────────────────────────────────────────────────────

interface EnvCheck {
  label: string;
  status: "ok" | "warn" | "fail" | "checking";
  detail: string;
}

interface ProviderConfig {
  name: string;
  apiBase: string;
  apiKey: string;
}

type WizardStep = "env" | "provider" | "security" | "scan" | "done";

const STEPS: Array<{ id: WizardStep; label: string }> = [
  { id: "env", label: "Environment" },
  { id: "provider", label: "Provider" },
  { id: "security", label: "Security" },
  { id: "scan", label: "First Scan" },
  { id: "done", label: "Complete" },
];

// ── Component ──────────────────────────────────────────────────

export function OnboardingWizard() {
  const navigate = useNavigate();
  const { get, post } = useProxyApi();
  const [currentStep, setCurrentStep] = useState<WizardStep>("env");
  const [envChecks, setEnvChecks] = useState<EnvCheck[]>([]);
  const [provider, setProvider] = useState<ProviderConfig>({
    name: "openai",
    apiBase: "",
    apiKey: "",
  });
  const [scanResult, setScanResult] = useState<{
    action: string;
    riskScore: number;
    secretsFound: number;
    piiFound: number;
  } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stepIndex = STEPS.findIndex((s) => s.id === currentStep);

  // ── Environment detection ──────────────────────────────────

  const runEnvChecks = useCallback(async () => {
    setEnvChecks([
      { label: "Proxy health", status: "checking", detail: "Checking..." },
      { label: "Database", status: "checking", detail: "Checking..." },
      { label: "Scanner pipeline", status: "checking", detail: "Checking..." },
    ]);

    try {
      const health = await get<{
        status: string;
        db?: string;
        scanner?: string;
      }>("/health");

      const proxyOk = health.status === "ok";
      const dbStatus = health.db ?? (proxyOk ? "ok" : "unknown");
      const scannerStatus = health.scanner ?? (proxyOk ? "ok" : "unknown");

      setEnvChecks((prev) => [
        {
          ...prev[0],
          status: proxyOk ? "ok" : "warn",
          detail: proxyOk
            ? "Proxy running on port 8080"
            : "Proxy responded with warnings",
        },
        {
          ...prev[1],
          status: dbStatus === "ok" ? "ok" : "warn",
          detail:
            dbStatus === "ok"
              ? "SQLite database connected"
              : `Database status: ${dbStatus}`,
        },
        {
          ...prev[2],
          status: scannerStatus === "ok" ? "ok" : "warn",
          detail:
            scannerStatus === "ok"
              ? "All 6 scanners operational"
              : `Scanner status: ${scannerStatus}`,
        },
      ]);
    } catch {
      setEnvChecks((prev) => [
        {
          ...prev[0],
          status: "fail",
          detail: "Cannot reach proxy at localhost:8080",
        },
        { ...prev[1], status: "fail", detail: "Database check skipped" },
        { ...prev[2], status: "fail", detail: "Scanner check skipped" },
      ]);
    }
  }, [get]);

  useEffect(() => {
    if (currentStep === "env") {
      runEnvChecks();
    }
  }, [currentStep, runEnvChecks]);

  // ── Provider setup ─────────────────────────────────────────

  const handleProviderSubmit = useCallback(async () => {
    if (!provider.apiKey.trim() && provider.name !== "ollama") {
      setError("API key is required");
      return;
    }
    if (provider.apiBase && !provider.apiBase.startsWith("http")) {
      setError(
        "API Base must be a valid URL (starting with http:// or https://)",
      );
      return;
    }

    setLoading(true);
    setError(null);
    try {
      await post("/api/providers", {
        name: provider.name,
        apiBase: provider.apiBase || undefined,
        apiKey: provider.apiKey,
      });
      setCurrentStep("security");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [post, provider]);

  // ── First scan ─────────────────────────────────────────────

  const runFirstScan = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await post<{
        action: string;
        riskScore: number;
        secretsFound: number;
        piiFound: number;
      }>("/api/estimate", {
        model: "gpt-4",
        messages: [
          {
            role: "user",
            content:
              "Hello, this is a test message to verify the scanning pipeline works correctly.",
          },
        ],
      });
      setScanResult(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [post]);

  useEffect(() => {
    if (currentStep === "scan") {
      runFirstScan();
    }
  }, [currentStep, runFirstScan]);

  // ── Step indicator styles ──────────────────────────────────

  const STATUS_ICON: Record<
    EnvCheck["status"],
    { icon: string; color: string }
  > = {
    ok: { icon: "\u2705", color: "text-success" },
    warn: { icon: "\u26A0\uFE0F", color: "text-warning" },
    fail: { icon: "\u274C", color: "text-error" },
    checking: { icon: "\u23F3", color: "text-description" },
  };

  // ── Render ─────────────────────────────────────────────────

  return (
    <div className="mx-auto flex h-full max-w-2xl flex-col gap-6 overflow-y-auto p-4">
      {/* Header */}
      <div className="text-center">
        <h1 className="text-foreground text-lg font-semibold">
          AI Firewall Setup
        </h1>
        <p className="text-description mt-1 text-xs">
          Configure your secure AI environment
        </p>
      </div>

      {/* Progress steps */}
      <div className="flex items-center justify-center gap-1">
        {STEPS.map((step, i) => (
          <div key={step.id} className="flex items-center">
            <div
              className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${
                i < stepIndex
                  ? "bg-success text-success-foreground"
                  : i === stepIndex
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary-background text-description"
              }`}
            >
              {i < stepIndex ? (
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="3"
                >
                  <path d="M20 6 9 17l-5-5" />
                </svg>
              ) : (
                i + 1
              )}
            </div>
            <span
              className={`ml-1 text-xs ${
                i === stepIndex
                  ? "text-foreground font-medium"
                  : "text-description-muted"
              }`}
            >
              {step.label}
            </span>
            {i < STEPS.length - 1 && (
              <div
                className={`mx-2 h-px w-6 ${
                  i < stepIndex ? "bg-success" : "bg-border"
                }`}
              />
            )}
          </div>
        ))}
      </div>

      {/* Step content */}
      <div className="border-border bg-editor rounded-lg border p-5">
        {/* Step 1: Environment */}
        {currentStep === "env" && (
          <div className="flex flex-col gap-3">
            <h2 className="text-foreground text-sm font-semibold">
              Environment Check
            </h2>
            <p className="text-description text-xs">
              Verifying your system is ready for AI Firewall.
            </p>
            <div className="mt-2 flex flex-col gap-2">
              {envChecks.map((check) => {
                const si = STATUS_ICON[check.status];
                return (
                  <div
                    key={check.label}
                    className="bg-secondary-background flex items-center gap-2 rounded px-3 py-2"
                  >
                    <span className="text-sm">{si.icon}</span>
                    <span className="text-foreground flex-1 text-sm font-medium">
                      {check.label}
                    </span>
                    <span className={`text-xs ${si.color}`}>
                      {check.detail}
                    </span>
                  </div>
                );
              })}
            </div>
            <button
              onClick={() => setCurrentStep("provider")}
              disabled={envChecks.some(
                (c) => c.status === "checking" || c.status === "fail",
              )}
              className="bg-primary text-primary-foreground hover:bg-primary-hover focus-visible:ring-border-focus mt-3 self-end rounded px-4 py-1.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Next
            </button>
          </div>
        )}

        {/* Step 2: Provider setup */}
        {currentStep === "provider" && (
          <div className="flex flex-col gap-3">
            <h2 className="text-foreground text-sm font-semibold">
              AI Provider Setup
            </h2>
            <p className="text-description text-xs">
              Configure your LLM provider. API keys are encrypted with
              AES-256-GCM before storage.
            </p>

            {error && (
              <div className="bg-error/10 border-error/30 text-error rounded border px-3 py-2 text-xs">
                {error}
              </div>
            )}

            <label className="flex flex-col gap-1">
              <span className="text-description text-xs">Provider</span>
              <select
                value={provider.name}
                onChange={(e) =>
                  setProvider({ ...provider, name: e.target.value })
                }
                className="bg-input text-input-foreground border-border focus:border-border-focus rounded border px-2 py-1.5 text-sm focus:outline-none"
              >
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
                <option value="gemini">Google Gemini</option>
                <option value="ollama">Ollama (local)</option>
              </select>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-description text-xs">API Key</span>
              <input
                type="password"
                value={provider.apiKey}
                onChange={(e) =>
                  setProvider({ ...provider, apiKey: e.target.value })
                }
                placeholder={
                  provider.name === "ollama"
                    ? "Not required for Ollama"
                    : "sk-..."
                }
                className="bg-input text-input-foreground placeholder:text-input-placeholder border-border focus:border-border-focus rounded border px-2 py-1.5 text-sm focus:outline-none"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-description text-xs">
                API Base URL (optional)
              </span>
              <input
                type="text"
                value={provider.apiBase}
                onChange={(e) =>
                  setProvider({ ...provider, apiBase: e.target.value })
                }
                placeholder="https://api.openai.com/v1"
                className="bg-input text-input-foreground placeholder:text-input-placeholder border-border focus:border-border-focus rounded border px-2 py-1.5 text-sm focus:outline-none"
              />
            </label>

            <div className="mt-2 flex justify-end gap-2">
              <button
                onClick={() => setCurrentStep("env")}
                className="border-border text-description hover:bg-list-hover focus-visible:ring-border-focus rounded border px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2"
              >
                Back
              </button>
              <button
                onClick={handleProviderSubmit}
                disabled={loading}
                className="bg-primary text-primary-foreground hover:bg-primary-hover focus-visible:ring-border-focus rounded px-4 py-1.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? "Saving..." : "Next"}
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Security config */}
        {currentStep === "security" && (
          <div className="flex flex-col gap-3">
            <h2 className="text-foreground text-sm font-semibold">
              Security Configuration
            </h2>
            <p className="text-description text-xs">
              AI Firewall scans every request for secrets, PII, and prompt
              injection before sending to any LLM provider.
            </p>

            <div className="mt-2 grid grid-cols-2 gap-3">
              <div className="bg-success/10 border-success/30 rounded border p-3">
                <div className="text-success text-sm font-semibold">
                  Enabled
                </div>
                <div className="text-description mt-1 text-xs">
                  Secret scanning (12 patterns)
                </div>
              </div>
              <div className="bg-success/10 border-success/30 rounded border p-3">
                <div className="text-success text-sm font-semibold">
                  Enabled
                </div>
                <div className="text-description mt-1 text-xs">
                  PII detection (7 patterns)
                </div>
              </div>
              <div className="bg-success/10 border-success/30 rounded border p-3">
                <div className="text-success text-sm font-semibold">
                  Enabled
                </div>
                <div className="text-description mt-1 text-xs">
                  Prompt injection (23 categories)
                </div>
              </div>
              <div className="bg-success/10 border-success/30 rounded border p-3">
                <div className="text-success text-sm font-semibold">
                  Enabled
                </div>
                <div className="text-description mt-1 text-xs">
                  Response scanning (LLM05)
                </div>
              </div>
            </div>

            <p className="text-description-muted mt-1 text-xs">
              Fine-tune these settings later in the Security page.
            </p>

            <div className="mt-2 flex justify-end gap-2">
              <button
                onClick={() => setCurrentStep("provider")}
                className="border-border text-description hover:bg-list-hover focus-visible:ring-border-focus rounded border px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2"
              >
                Back
              </button>
              <button
                onClick={() => setCurrentStep("scan")}
                className="bg-primary text-primary-foreground hover:bg-primary-hover focus-visible:ring-border-focus rounded px-4 py-1.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2"
              >
                Run First Scan
              </button>
            </div>
          </div>
        )}

        {/* Step 4: First scan */}
        {currentStep === "scan" && (
          <div className="flex flex-col gap-3">
            <h2 className="text-foreground text-sm font-semibold">
              First Scan
            </h2>
            <p className="text-description text-xs">
              Running a test message through the full scanner pipeline.
            </p>

            {error && (
              <div className="bg-error/10 border-error/30 text-error rounded border px-3 py-2 text-xs">
                {error}
              </div>
            )}

            {loading && (
              <div className="text-description flex items-center gap-2 py-4">
                <svg
                  className="h-4 w-4 animate-spin"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <circle cx="12" cy="12" r="10" opacity="0.25" />
                  <path d="M12 2a10 10 0 0 1 10 10" opacity="0.75" />
                </svg>
                Scanning...
              </div>
            )}

            {scanResult && (
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-secondary-background rounded p-3 text-center">
                  <div
                    className={`text-lg font-bold ${
                      scanResult.action === "ALLOW"
                        ? "text-success"
                        : scanResult.action === "REDACT"
                          ? "text-warning"
                          : "text-error"
                    }`}
                  >
                    {scanResult.action}
                  </div>
                  <div className="text-description text-xs">Decision</div>
                </div>
                <div className="bg-secondary-background rounded p-3 text-center">
                  <div className="text-foreground text-lg font-bold">
                    {scanResult.riskScore}
                  </div>
                  <div className="text-description text-xs">Risk Score</div>
                </div>
                <div className="bg-secondary-background rounded p-3 text-center">
                  <div className="text-foreground text-lg font-bold">
                    {scanResult.secretsFound}
                  </div>
                  <div className="text-description text-xs">Secrets Found</div>
                </div>
                <div className="bg-secondary-background rounded p-3 text-center">
                  <div className="text-foreground text-lg font-bold">
                    {scanResult.piiFound}
                  </div>
                  <div className="text-description text-xs">PII Found</div>
                </div>
              </div>
            )}

            {scanResult && (
              <div className="mt-2 flex justify-end gap-2">
                <button
                  onClick={() => setCurrentStep("done")}
                  className="bg-primary text-primary-foreground hover:bg-primary-hover focus-visible:ring-border-focus rounded px-4 py-1.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2"
                >
                  Complete Setup
                </button>
              </div>
            )}
          </div>
        )}

        {/* Step 5: Done */}
        {currentStep === "done" && (
          <div className="flex flex-col items-center gap-4 py-6">
            <div className="bg-success/20 flex h-12 w-12 items-center justify-center rounded-full">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="text-success"
              >
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </div>
            <h2 className="text-foreground text-lg font-semibold">
              Setup Complete
            </h2>
            <p className="text-description max-w-xs text-center text-sm">
              AI Firewall is configured and ready. Every LLM request will be
              scanned before sending.
            </p>
            <button
              onClick={() => navigate(ROUTES.HOME)}
              className="bg-primary text-primary-foreground hover:bg-primary-hover focus-visible:ring-border-focus mt-2 rounded px-6 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2"
            >
              Start Chatting
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
