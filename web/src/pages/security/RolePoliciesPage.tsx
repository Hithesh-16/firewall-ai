import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ShieldCheckIcon,
  UserIcon,
  UserGroupIcon,
  ClipboardDocumentListIcon,
  TrashIcon,
  CodeBracketIcon,
  AdjustmentsHorizontalIcon,
  ExclamationTriangleIcon,
} from "@heroicons/react/24/outline";
import { apiClient } from "../../api/client";
import { useAppDispatch } from "../../store/hooks";
import { showToast } from "../../store/slices/uiSlice";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { LoadingSpinner } from "../../components/ui/LoadingSpinner";
import { ErrorBanner } from "../../components/ui/ErrorBanner";
import { UnderlineTabs } from "../../components/ui/UnderlineTabs";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { cn } from "../../utils/cn";

/**
 * Role Policies page.
 *
 * Lists the four system roles and lets an admin configure a per-role
 * policy overlay. Each overlay is stored as a JSON blob in the
 * `role_policies` table and merged into `resolveEffectivePolicy` between
 * the org and team levels.
 *
 * Strictest-wins semantics: role overrides can only TIGHTEN the org
 * baseline — they cannot relax a block. The UI copy surfaces this so
 * users don't expect to loosen rules here.
 *
 * Two editing modes per role:
 *   - Form view   — toggles + sliders for the common fields
 *   - JSON view   — a raw textarea for the full PartialPolicy shape
 *
 * The two views are bidirectionally synced: edits in the form update
 * the JSON buffer and vice versa. JSON is parsed on every keystroke so
 * syntax errors surface immediately with a red banner.
 */

type RoleName = "admin" | "security_lead" | "developer" | "auditor";

interface RoleRow {
  role: RoleName;
  hasOverride: boolean;
  policy: PartialPolicy | null;
  updatedAt: number | null;
}

interface PartialPolicyRules {
  block_private_keys?: boolean;
  block_aws_keys?: boolean;
  block_db_urls?: boolean;
  block_github_tokens?: boolean;
  redact_emails?: boolean;
  redact_phone?: boolean;
  redact_jwt?: boolean;
  redact_generic_api_keys?: boolean;
  allow_source_code?: boolean;
  log_all_requests?: boolean;
}

interface PartialPolicy {
  rules?: PartialPolicyRules;
  severity_threshold?: "medium" | "high" | "critical";
  prompt_injection?: { enabled?: boolean; threshold?: number };
  response_scanning?: { enabled?: boolean };
  file_scope?: { blocklist?: string[]; allowlist?: string[] };
  blocked_paths?: string[];
  [key: string]: unknown;
}

const ROLE_META: Record<
  RoleName,
  {
    label: string;
    description: string;
    icon: React.ComponentType<{ className?: string }>;
    color: string;
  }
> = {
  admin: {
    label: "Admin",
    description: "Full access — inherits the org baseline without override.",
    icon: ShieldCheckIcon,
    color: "text-red-400",
  },
  security_lead: {
    label: "Security Lead",
    description: "Can tighten org policy and review audit logs.",
    icon: ClipboardDocumentListIcon,
    color: "text-amber-400",
  },
  developer: {
    label: "Developer",
    description: "Day-to-day coding. Tightest prompt-injection by default.",
    icon: UserIcon,
    color: "text-emerald-400",
  },
  auditor: {
    label: "Auditor",
    description: "Read-only, strictest PII/secret redaction.",
    icon: UserGroupIcon,
    color: "text-cyan-400",
  },
};

const RULE_LABELS: Record<keyof PartialPolicyRules, string> = {
  block_private_keys: "Block private keys",
  block_aws_keys: "Block AWS keys",
  block_db_urls: "Block database URLs",
  block_github_tokens: "Block GitHub tokens",
  redact_emails: "Redact emails",
  redact_phone: "Redact phone numbers",
  redact_jwt: "Redact JWTs",
  redact_generic_api_keys: "Redact generic API keys",
  allow_source_code: "Allow source code",
  log_all_requests: "Log all requests",
};

export function RolePoliciesPage() {
  const dispatch = useAppDispatch();
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedRole, setSelectedRole] = useState<RoleName | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const resp = await apiClient.get<{ roles: RoleRow[] }>(
        "/api/policies/roles",
      );
      setRoles(resp.roles);
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : "Failed to load role policies",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const selectedRow = useMemo(
    () => roles.find((r) => r.role === selectedRole) ?? null,
    [roles, selectedRole],
  );

  async function handleSaved() {
    await load();
    dispatch(
      showToast({
        id: `role-policy-save-${Date.now()}`,
        type: "success",
        message: "Role policy saved",
      }),
    );
  }

  async function handleDeleted() {
    await load();
    dispatch(
      showToast({
        id: `role-policy-del-${Date.now()}`,
        type: "success",
        message: "Role override removed",
      }),
    );
  }

  return (
    <div className="mx-auto max-w-5xl p-6">
      <div className="mb-6">
        <h1 className="text-foreground text-2xl font-semibold">
          Role Policies
        </h1>
        <p className="text-description mt-1 text-sm">
          Override the org baseline policy per-role. Role overrides can{" "}
          <strong>only tighten</strong> the baseline — use the Policy Editor
          to relax rules organization-wide.
        </p>
      </div>

      {loadError && <ErrorBanner message={loadError} className="mb-4" />}

      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <LoadingSpinner />
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {roles.map((row) => {
            const meta = ROLE_META[row.role];
            const Icon = meta.icon;
            return (
              <button
                key={row.role}
                type="button"
                onClick={() => setSelectedRole(row.role)}
                className="border-border bg-editor hover:border-border-focus flex flex-col gap-2 rounded-xl border p-5 text-left transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <Icon className={cn("h-6 w-6", meta.color)} />
                    <div>
                      <h3 className="text-foreground text-base font-semibold">
                        {meta.label}
                      </h3>
                      <p className="text-description mt-0.5 text-xs">
                        {meta.description}
                      </p>
                    </div>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase",
                      row.hasOverride
                        ? "bg-primary/10 text-primary border-primary/30 border"
                        : "bg-secondary text-description",
                    )}
                  >
                    {row.hasOverride ? "Override" : "Default"}
                  </span>
                </div>
                {row.updatedAt && (
                  <p className="text-description-muted mt-1 text-xs">
                    Updated {new Date(row.updatedAt).toLocaleString()}
                  </p>
                )}
              </button>
            );
          })}
        </div>
      )}

      {selectedRow && (
        <RolePolicyEditor
          row={selectedRow}
          onClose={() => setSelectedRole(null)}
          onSaved={handleSaved}
          onDeleted={handleDeleted}
        />
      )}
    </div>
  );
}

// ─── Editor modal ────────────────────────────────────────────────────

function RolePolicyEditor({
  row,
  onClose,
  onSaved,
  onDeleted,
}: {
  row: RoleRow;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  onDeleted: () => void | Promise<void>;
}) {
  const meta = ROLE_META[row.role];

  // Two edit modes sharing one buffer.
  const [activeTab, setActiveTab] = useState<"form" | "json">("form");
  const [policy, setPolicy] = useState<PartialPolicy>(row.policy ?? {});
  const [jsonText, setJsonText] = useState<string>(
    JSON.stringify(row.policy ?? {}, null, 2),
  );
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  function applyPolicyUpdate(next: PartialPolicy) {
    setPolicy(next);
    setJsonText(JSON.stringify(next, null, 2));
    setJsonError(null);
  }

  function handleJsonChange(text: string) {
    setJsonText(text);
    if (text.trim() === "") {
      setPolicy({});
      setJsonError(null);
      return;
    }
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed !== "object" || Array.isArray(parsed)) {
        setJsonError("Policy must be a JSON object.");
        return;
      }
      setPolicy(parsed as PartialPolicy);
      setJsonError(null);
    } catch (err) {
      setJsonError(err instanceof Error ? err.message : "Invalid JSON");
    }
  }

  async function save() {
    if (jsonError) return;
    setSaving(true);
    setSaveError(null);
    try {
      await apiClient.put(`/api/policies/role/${row.role}`, policy);
      await onSaved();
      onClose();
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : "Failed to save policy",
      );
    } finally {
      setSaving(false);
    }
  }

  async function removeOverride() {
    setSaving(true);
    setSaveError(null);
    try {
      await apiClient.del(`/api/policies/role/${row.role}`);
      await onDeleted();
      onClose();
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : "Failed to remove override",
      );
    } finally {
      setSaving(false);
      setConfirmDelete(false);
    }
  }

  const Icon = meta.icon;

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="pointer-events-none fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8">
        <Card
          className="pointer-events-auto w-full max-w-3xl"
          padding={false}
        >
          {/* Header */}
          <div className="border-border flex items-center justify-between border-b px-6 py-4">
            <div className="flex items-center gap-3">
              <Icon className={cn("h-6 w-6", meta.color)} />
              <div>
                <h2 className="text-foreground text-lg font-semibold">
                  {meta.label} policy
                </h2>
                <p className="text-description text-xs">{meta.description}</p>
              </div>
            </div>
            <Button variant="ghost" onClick={onClose} aria-label="Close">
              ✕
            </Button>
          </div>

          {/* Tabs */}
          <UnderlineTabs
            tabs={[
              { id: "form", label: "Form" },
              { id: "json", label: "JSON" },
            ]}
            activeTab={activeTab}
            onChange={(id) => setActiveTab(id as "form" | "json")}
            className="px-6"
          />

          {/* Body */}
          <div className="px-6 py-5">
            {activeTab === "form" ? (
              <FormEditor policy={policy} onChange={applyPolicyUpdate} />
            ) : (
              <JsonEditor
                value={jsonText}
                error={jsonError}
                onChange={handleJsonChange}
              />
            )}
          </div>

          {saveError && <ErrorBanner message={saveError} className="mx-6" />}

          {/* Footer actions */}
          <div className="border-border flex items-center justify-between gap-2 border-t px-6 py-4">
            <div>
              {row.hasOverride && (
                <Button
                  variant="danger"
                  onClick={() => setConfirmDelete(true)}
                  disabled={saving}
                >
                  <TrashIcon className="mr-1.5 h-4 w-4" />
                  Remove override
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={onClose}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={save}
                disabled={saving || !!jsonError}
                loading={saving}
              >
                Save override
              </Button>
            </div>
          </div>
        </Card>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Remove role override?"
        message={`The ${meta.label} role will fall back to the org baseline on the next request.`}
        confirmLabel="Remove"
        variant="danger"
        onConfirm={removeOverride}
        onCancel={() => setConfirmDelete(false)}
      />
    </>
  );
}

// ─── Form editor ─────────────────────────────────────────────────────

function FormEditor({
  policy,
  onChange,
}: {
  policy: PartialPolicy;
  onChange: (next: PartialPolicy) => void;
}) {
  function setRule(key: keyof PartialPolicyRules, value: boolean | undefined) {
    const nextRules: PartialPolicyRules = { ...(policy.rules ?? {}) };
    if (value === undefined) {
      delete nextRules[key];
    } else {
      nextRules[key] = value;
    }
    const next: PartialPolicy = { ...policy };
    if (Object.keys(nextRules).length === 0) {
      delete next.rules;
    } else {
      next.rules = nextRules;
    }
    onChange(next);
  }

  function setInjectionThreshold(v: number | undefined) {
    const next: PartialPolicy = { ...policy };
    if (v === undefined) {
      delete next.prompt_injection;
    } else {
      next.prompt_injection = { ...(policy.prompt_injection ?? {}), threshold: v };
    }
    onChange(next);
  }

  function setResponseScanning(enabled: boolean | undefined) {
    const next: PartialPolicy = { ...policy };
    if (enabled === undefined) {
      delete next.response_scanning;
    } else {
      next.response_scanning = { enabled };
    }
    onChange(next);
  }

  function setSeverity(v: PartialPolicy["severity_threshold"] | undefined) {
    const next: PartialPolicy = { ...policy };
    if (!v) delete next.severity_threshold;
    else next.severity_threshold = v;
    onChange(next);
  }

  const injectionThreshold = policy.prompt_injection?.threshold;

  return (
    <div className="space-y-5">
      {/* Strictness tip */}
      <div className="border-primary/30 bg-primary/5 text-description rounded-lg border px-3 py-2 text-xs">
        <ExclamationTriangleIcon className="text-primary mr-1 inline h-3.5 w-3.5" />
        Only set the fields you want to tighten. Leave a field blank to
        inherit from the org baseline.
      </div>

      {/* Rules */}
      <section>
        <h3 className="text-foreground mb-2 text-sm font-semibold">
          Rules
        </h3>
        <p className="text-description mb-3 text-xs">
          Each checkbox is tri-state: inherit (blank), force-on (✓),
          force-off is ignored because overrides only tighten.
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {(Object.keys(RULE_LABELS) as (keyof PartialPolicyRules)[]).map(
            (key) => {
              const value = policy.rules?.[key];
              const checked = value === true;
              return (
                <label
                  key={key}
                  className="border-border hover:bg-list-hover flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) =>
                      setRule(key, e.target.checked ? true : undefined)
                    }
                    className="accent-primary h-4 w-4"
                  />
                  <span className="text-foreground">{RULE_LABELS[key]}</span>
                </label>
              );
            },
          )}
        </div>
      </section>

      {/* Prompt injection threshold */}
      <section>
        <h3 className="text-foreground mb-2 text-sm font-semibold">
          Prompt injection threshold
        </h3>
        <p className="text-description mb-3 text-xs">
          Lower = stricter. Leave unset to inherit. Range 0–100.
        </p>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={0}
            max={100}
            value={injectionThreshold ?? 60}
            onChange={(e) =>
              setInjectionThreshold(Number(e.target.value))
            }
            className="accent-primary flex-1"
            disabled={injectionThreshold === undefined}
          />
          <span className="text-foreground w-10 text-right text-sm tabular-nums">
            {injectionThreshold ?? "—"}
          </span>
          <Button
            size="sm"
            variant={injectionThreshold === undefined ? "primary" : "outline"}
            onClick={() =>
              injectionThreshold === undefined
                ? setInjectionThreshold(60)
                : setInjectionThreshold(undefined)
            }
          >
            {injectionThreshold === undefined ? "Set" : "Inherit"}
          </Button>
        </div>
      </section>

      {/* Response scanning */}
      <section>
        <h3 className="text-foreground mb-2 text-sm font-semibold">
          Response scanning
        </h3>
        <label className="border-border flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm">
          <input
            type="checkbox"
            checked={policy.response_scanning?.enabled === true}
            onChange={(e) =>
              setResponseScanning(e.target.checked ? true : undefined)
            }
            className="accent-primary h-4 w-4"
          />
          <span className="text-foreground">
            Force-enable scanning of model responses
          </span>
        </label>
      </section>

      {/* Severity threshold */}
      <section>
        <h3 className="text-foreground mb-2 text-sm font-semibold">
          Severity threshold
        </h3>
        <div className="flex gap-2">
          {(["medium", "high", "critical"] as const).map((s) => (
            <Button
              key={s}
              variant={
                policy.severity_threshold === s ? "primary" : "outline"
              }
              size="sm"
              onClick={() =>
                setSeverity(
                  policy.severity_threshold === s ? undefined : s,
                )
              }
            >
              {s}
            </Button>
          ))}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSeverity(undefined)}
          >
            Inherit
          </Button>
        </div>
      </section>
    </div>
  );
}

// ─── JSON editor ─────────────────────────────────────────────────────

function JsonEditor({
  value,
  error,
  onChange,
}: {
  value: string;
  error: string | null;
  onChange: (text: string) => void;
}) {
  return (
    <div>
      <div className="text-description mb-2 flex items-center gap-1.5 text-xs">
        <CodeBracketIcon className="h-3.5 w-3.5" />
        Partial JSON policy shape — fields omitted inherit from the baseline.
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        className={cn(
          "bg-editor font-mono text-xs text-foreground border-border focus:border-border-focus w-full rounded-md border p-3 focus:outline-none focus:ring-1 focus:ring-border-focus",
          "min-h-[360px]",
          error && "border-error focus:border-error focus:ring-error",
        )}
      />
      {error ? (
        <p className="text-error mt-2 text-xs">{error}</p>
      ) : (
        <p className="text-description-muted mt-2 text-xs">
          <AdjustmentsHorizontalIcon className="mr-1 inline h-3 w-3" />
          Save will call PUT /api/policies/role/{"{"}role{"}"}.
        </p>
      )}
    </div>
  );
}

export default RolePoliciesPage;
