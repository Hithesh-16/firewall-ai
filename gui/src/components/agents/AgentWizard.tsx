/**
 * AgentWizard — step-by-step agent creation flow.
 * Steps: 1) Basic Info  2) Model & Timeout  3) Tools & Permissions  4) Review & Launch
 */

import { useState, useCallback } from "react";
import { useProxyApi } from "../../hooks/useProxyApi";

// ── Types ──────────────────────────────────────────────────────

type AgentMode = "local" | "background" | "coordinator" | "worker" | "dream";

interface AgentConfig {
  name: string;
  description: string;
  mode: AgentMode;
  model: string;
  systemPrompt: string;
  allowedTools: string[];
  deniedTools: string[];
  timeoutMs: number;
  isolation: "none" | "worktree";
}

interface AgentWizardProps {
  onClose: () => void;
  onCreated?: (taskId: string) => void;
}

type Step = 1 | 2 | 3 | 4;

const DEFAULT_CONFIG: AgentConfig = {
  name: "",
  description: "",
  mode: "local",
  model: "",
  systemPrompt: "",
  allowedTools: [],
  deniedTools: [],
  timeoutMs: 300_000,
  isolation: "none",
};

const MODES: Array<{ id: AgentMode; label: string; desc: string }> = [
  { id: "local", label: "Local", desc: "Synchronous, blocks until result" },
  {
    id: "background",
    label: "Background",
    desc: "Async, notifies on completion",
  },
  {
    id: "coordinator",
    label: "Coordinator",
    desc: "Orchestrates multiple workers",
  },
];

const TIMEOUT_OPTIONS = [
  { value: 60_000, label: "1 minute" },
  { value: 120_000, label: "2 minutes" },
  { value: 300_000, label: "5 minutes" },
  { value: 600_000, label: "10 minutes" },
  { value: 1_800_000, label: "30 minutes" },
];

const COMMON_TOOLS = [
  "read",
  "edit",
  "write",
  "glob",
  "grep",
  "bash",
  "web_search",
  "web_fetch",
  "notebook_edit",
  "agent",
  "plan",
  "worktree",
];

// ── Component ──────────────────────────────────────────────────

export function AgentWizard({ onClose, onCreated }: AgentWizardProps) {
  const api = useProxyApi();
  const [step, setStep] = useState<Step>(1);
  const [config, setConfig] = useState<AgentConfig>(DEFAULT_CONFIG);
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = useCallback(
    (patch: Partial<AgentConfig>) =>
      setConfig((prev) => ({ ...prev, ...patch })),
    [],
  );

  const canProceed = useCallback((): boolean => {
    switch (step) {
      case 1:
        return config.description.trim().length > 0;
      case 2:
        return true;
      case 3:
        return true;
      case 4:
        return true;
      default:
        return false;
    }
  }, [step, config]);

  const handleLaunch = useCallback(async () => {
    setLaunching(true);
    setError(null);
    try {
      const body = {
        description: config.description,
        prompt: config.systemPrompt || config.description,
        model: config.model || undefined,
        background: config.mode === "background",
        isolation: config.isolation === "worktree" ? "worktree" : undefined,
      };
      const result = await api.post<{ taskId: string }>(
        "/api/agents/spawn",
        body,
      );
      onCreated?.(result.taskId);
      onClose();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setLaunching(false);
    }
  }, [api, config, onClose, onCreated]);

  const toggleTool = useCallback(
    (tool: string, list: "allowed" | "denied") => {
      const key = list === "allowed" ? "allowedTools" : "deniedTools";
      const current = config[key];
      const updated = current.includes(tool)
        ? current.filter((t) => t !== tool)
        : [...current, tool];
      update({ [key]: updated });
    },
    [config, update],
  );

  // ── Step indicators ──────────────────────────────────────────

  const stepLabels = ["Basic Info", "Model & Timeout", "Tools", "Review"];

  return (
    <div className="border-border bg-editor mx-auto max-w-xl rounded-lg border p-5">
      {/* Header */}
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-foreground text-base font-semibold">
          Create Agent
        </h3>
        <button
          onClick={onClose}
          className="text-description hover:text-foreground transition-colors"
          aria-label="Close wizard"
        >
          {"\u2715"}
        </button>
      </div>

      {/* Step indicator */}
      <div className="mb-5 flex gap-1">
        {stepLabels.map((label, i) => {
          const s = (i + 1) as Step;
          const isActive = s === step;
          const isDone = s < step;
          return (
            <div key={label} className="flex flex-1 flex-col gap-1">
              <div
                className={`h-1 rounded-full transition-colors ${
                  isDone
                    ? "bg-success"
                    : isActive
                      ? "bg-primary"
                      : "bg-secondary-background"
                }`}
              />
              <span
                className={`text-2xs text-center ${
                  isActive
                    ? "text-foreground font-medium"
                    : "text-description-muted"
                }`}
              >
                {label}
              </span>
            </div>
          );
        })}
      </div>

      {/* Step 1: Basic Info */}
      {step === 1 && (
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-foreground mb-1 block text-xs font-medium">
              What should this agent do?
            </label>
            <textarea
              value={config.description}
              onChange={(e) => update({ description: e.target.value })}
              placeholder="e.g., Refactor the authentication module to use JWT tokens"
              rows={3}
              className="bg-input text-input-foreground placeholder:text-input-placeholder border-border w-full rounded border px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="text-foreground mb-1 block text-xs font-medium">
              Agent Name (optional)
            </label>
            <input
              type="text"
              value={config.name}
              onChange={(e) => update({ name: e.target.value })}
              placeholder="e.g., auth-refactor"
              className="bg-input text-input-foreground placeholder:text-input-placeholder border-border w-full rounded border px-3 py-1.5 text-sm"
            />
          </div>

          <div>
            <label className="text-foreground mb-1 block text-xs font-medium">
              Execution Mode
            </label>
            <div className="flex flex-col gap-1.5">
              {MODES.map((m) => (
                <label
                  key={m.id}
                  className={`flex cursor-pointer items-center gap-2 rounded border p-2 transition-colors ${
                    config.mode === m.id
                      ? "border-primary bg-primary/5"
                      : "border-border hover:bg-list-hover"
                  }`}
                >
                  <input
                    type="radio"
                    name="mode"
                    checked={config.mode === m.id}
                    onChange={() => update({ mode: m.id })}
                    className="accent-primary"
                  />
                  <div>
                    <span className="text-foreground text-sm font-medium">
                      {m.label}
                    </span>
                    <span className="text-description-muted ml-2 text-xs">
                      {m.desc}
                    </span>
                  </div>
                </label>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Step 2: Model & Timeout */}
      {step === 2 && (
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-foreground mb-1 block text-xs font-medium">
              Model Override (optional)
            </label>
            <input
              type="text"
              value={config.model}
              onChange={(e) => update({ model: e.target.value })}
              placeholder="Leave empty to use default model"
              className="bg-input text-input-foreground placeholder:text-input-placeholder border-border w-full rounded border px-3 py-1.5 text-sm"
            />
            <p className="text-description-muted text-2xs mt-1">
              e.g., claude-sonnet-4-6, gpt-4o, gemini-2.5-pro
            </p>
          </div>

          <div>
            <label className="text-foreground mb-1 block text-xs font-medium">
              Timeout
            </label>
            <select
              value={config.timeoutMs}
              onChange={(e) =>
                update({ timeoutMs: parseInt(e.target.value, 10) })
              }
              className="bg-input text-input-foreground border-border w-full rounded border px-3 py-1.5 text-sm"
            >
              {TIMEOUT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-foreground mb-1 block text-xs font-medium">
              Isolation
            </label>
            <div className="flex gap-2">
              {(["none", "worktree"] as const).map((iso) => (
                <label
                  key={iso}
                  className={`flex cursor-pointer items-center gap-1.5 rounded border px-3 py-1.5 text-sm transition-colors ${
                    config.isolation === iso
                      ? "border-primary bg-primary/5"
                      : "border-border hover:bg-list-hover"
                  }`}
                >
                  <input
                    type="radio"
                    name="isolation"
                    checked={config.isolation === iso}
                    onChange={() => update({ isolation: iso })}
                    className="accent-primary"
                  />
                  <span className="text-foreground capitalize">
                    {iso === "none" ? "None" : "Git Worktree"}
                  </span>
                </label>
              ))}
            </div>
            {config.isolation === "worktree" && (
              <p className="text-description-muted text-2xs mt-1">
                Agent works on an isolated copy of the repo. Changes are
                returned on a separate branch.
              </p>
            )}
          </div>

          <div>
            <label className="text-foreground mb-1 block text-xs font-medium">
              System Prompt (optional)
            </label>
            <textarea
              value={config.systemPrompt}
              onChange={(e) => update({ systemPrompt: e.target.value })}
              placeholder="Additional instructions for the agent..."
              rows={3}
              className="bg-input text-input-foreground placeholder:text-input-placeholder border-border w-full rounded border px-3 py-2 text-sm"
            />
          </div>
        </div>
      )}

      {/* Step 3: Tools & Permissions */}
      {step === 3 && (
        <div className="flex flex-col gap-3">
          <div>
            <label className="text-foreground mb-2 block text-xs font-medium">
              Allowed Tools
            </label>
            <p className="text-description-muted text-2xs mb-2">
              Select tools this agent can use. Empty = all tools allowed.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {COMMON_TOOLS.map((tool) => {
                const isAllowed = config.allowedTools.includes(tool);
                return (
                  <button
                    key={tool}
                    onClick={() => toggleTool(tool, "allowed")}
                    className={`rounded border px-2 py-1 text-xs transition-colors ${
                      isAllowed
                        ? "border-success bg-success/10 text-success font-medium"
                        : "border-border text-description hover:bg-list-hover"
                    }`}
                  >
                    {tool}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="text-foreground mb-2 block text-xs font-medium">
              Denied Tools
            </label>
            <p className="text-description-muted text-2xs mb-2">
              Tools explicitly forbidden for this agent.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {COMMON_TOOLS.map((tool) => {
                const isDenied = config.deniedTools.includes(tool);
                return (
                  <button
                    key={tool}
                    onClick={() => toggleTool(tool, "denied")}
                    className={`rounded border px-2 py-1 text-xs transition-colors ${
                      isDenied
                        ? "border-error bg-error/10 text-error font-medium"
                        : "border-border text-description hover:bg-list-hover"
                    }`}
                  >
                    {tool}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Step 4: Review & Launch */}
      {step === 4 && (
        <div className="flex flex-col gap-3">
          <div className="border-border rounded border p-3">
            <h4 className="text-foreground mb-2 text-sm font-medium">
              Agent Summary
            </h4>
            <div className="flex flex-col gap-1.5 text-xs">
              {config.name && (
                <div className="flex gap-2">
                  <span className="text-description-muted w-24 shrink-0">
                    Name:
                  </span>
                  <span className="text-foreground">{config.name}</span>
                </div>
              )}
              <div className="flex gap-2">
                <span className="text-description-muted w-24 shrink-0">
                  Task:
                </span>
                <span className="text-foreground">{config.description}</span>
              </div>
              <div className="flex gap-2">
                <span className="text-description-muted w-24 shrink-0">
                  Mode:
                </span>
                <span className="text-foreground capitalize">
                  {config.mode}
                </span>
              </div>
              <div className="flex gap-2">
                <span className="text-description-muted w-24 shrink-0">
                  Model:
                </span>
                <span className="text-foreground">
                  {config.model || "(default)"}
                </span>
              </div>
              <div className="flex gap-2">
                <span className="text-description-muted w-24 shrink-0">
                  Timeout:
                </span>
                <span className="text-foreground">
                  {config.timeoutMs / 1000}s
                </span>
              </div>
              <div className="flex gap-2">
                <span className="text-description-muted w-24 shrink-0">
                  Isolation:
                </span>
                <span className="text-foreground capitalize">
                  {config.isolation}
                </span>
              </div>
              {config.allowedTools.length > 0 && (
                <div className="flex gap-2">
                  <span className="text-description-muted w-24 shrink-0">
                    Allowed:
                  </span>
                  <span className="text-success">
                    {config.allowedTools.join(", ")}
                  </span>
                </div>
              )}
              {config.deniedTools.length > 0 && (
                <div className="flex gap-2">
                  <span className="text-description-muted w-24 shrink-0">
                    Denied:
                  </span>
                  <span className="text-error">
                    {config.deniedTools.join(", ")}
                  </span>
                </div>
              )}
              {config.systemPrompt && (
                <div className="flex gap-2">
                  <span className="text-description-muted w-24 shrink-0">
                    Prompt:
                  </span>
                  <span className="text-foreground truncate">
                    {config.systemPrompt.slice(0, 100)}
                    {config.systemPrompt.length > 100 ? "..." : ""}
                  </span>
                </div>
              )}
            </div>
          </div>

          {error && (
            <div className="border-error/30 bg-error/5 text-error rounded border p-2 text-xs">
              {error}
            </div>
          )}
        </div>
      )}

      {/* Navigation */}
      <div className="mt-5 flex items-center justify-between">
        <button
          onClick={() => (step === 1 ? onClose() : setStep((step - 1) as Step))}
          className="text-description hover:text-foreground text-sm transition-colors"
        >
          {step === 1 ? "Cancel" : "\u2190 Back"}
        </button>

        {step < 4 ? (
          <button
            onClick={() => setStep((step + 1) as Step)}
            disabled={!canProceed()}
            className="bg-primary text-primary-foreground hover:bg-primary-hover rounded px-4 py-1.5 text-sm transition-colors disabled:opacity-50"
          >
            Next {"\u2192"}
          </button>
        ) : (
          <button
            onClick={handleLaunch}
            disabled={launching || !canProceed()}
            className="bg-primary text-primary-foreground hover:bg-primary-hover rounded px-4 py-1.5 text-sm transition-colors disabled:opacity-50"
          >
            {launching ? "Launching..." : "Launch Agent"}
          </button>
        )}
      </div>
    </div>
  );
}
