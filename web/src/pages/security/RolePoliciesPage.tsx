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
  FolderIcon,
  PlusIcon,
  XMarkIcon,
  EyeIcon,
} from "@heroicons/react/24/outline";
import { apiClient } from "../../api/client";
import { ENDPOINTS } from "../../api/endpoints";
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
  const [globalPolicy, setGlobalPolicy] = useState<PartialPolicy | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedRole, setSelectedRole] = useState<RoleName | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [rolesRes, policyRes] = await Promise.allSettled([
        apiClient.get<{ roles: RoleRow[] }>(ENDPOINTS.policy.roles),
        apiClient.get<PartialPolicy>(ENDPOINTS.policy.global),
      ]);
      if (rolesRes.status === "fulfilled") setRoles(rolesRes.value.roles);
      if (policyRes.status === "fulfilled") setGlobalPolicy(policyRes.value);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load role policies");
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
        <h1 className="text-foreground text-2xl font-semibold">Role Policies</h1>
        <p className="text-description mt-1 text-sm">
          Override the org baseline policy per-role. Role overrides can{" "}
          <strong>only tighten</strong> the baseline — use the Policy Editor to relax rules
          organization-wide.
        </p>
      </div>

      {loadError && <ErrorBanner message={loadError} className="mb-4" />}

      {loading ? (
        <div className="flex h-40 items-center justify-center">
          <LoadingSpinner />
        </div>
      ) : (
        <div className="space-y-4">
          {roles.map((row) => {
            const meta = ROLE_META[row.role];
            const Icon = meta.icon;
            const p = row.policy ?? {};
            const gRules = (globalPolicy as Record<string, unknown> | null)?.rules as
              | Record<string, boolean>
              | undefined;
            const gFileScope = (globalPolicy as Record<string, unknown> | null)?.file_scope as
              | { blocklist?: string[] }
              | undefined;
            const gBlockedPaths = (globalPolicy as Record<string, unknown> | null)
              ?.blocked_paths as string[] | undefined;

            // Merge rules for display
            const mergedRules = { ...(gRules ?? {}), ...(p.rules ?? {}) };
            const activeRuleCount = Object.values(mergedRules).filter(Boolean).length;

            // Merge file restrictions
            const allBlocked = new Set<string>();
            for (const x of gFileScope?.blocklist ?? []) allBlocked.add(x);
            for (const x of gBlockedPaths ?? []) allBlocked.add(x);
            for (const x of p.blocked_paths ?? []) allBlocked.add(x);
            for (const x of p.file_scope?.blocklist ?? []) allBlocked.add(x);

            // Effective threshold
            const gThreshold = (
              (globalPolicy as Record<string, unknown> | null)?.prompt_injection as
                | { threshold?: number }
                | undefined
            )?.threshold;
            const rThreshold = p.prompt_injection?.threshold;
            const effThreshold =
              rThreshold !== undefined && gThreshold !== undefined
                ? Math.min(rThreshold, gThreshold)
                : (rThreshold ?? gThreshold ?? 60);

            return (
              <div
                key={row.role}
                className="border-border bg-editor rounded-xl border transition-colors"
              >
                {/* Header */}
                <div className="flex items-center justify-between px-5 pt-5 pb-3">
                  <div className="flex items-center gap-3">
                    <Icon className={cn("h-6 w-6", meta.color)} />
                    <div>
                      <h3 className="text-foreground text-base font-semibold">{meta.label}</h3>
                      <p className="text-description mt-0.5 text-xs">{meta.description}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
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
                    <Button size="sm" variant="outline" onClick={() => setSelectedRole(row.role)}>
                      Edit
                    </Button>
                  </div>
                </div>

                {/* Policy summary grid */}
                <div className="border-border grid grid-cols-1 gap-px border-t sm:grid-cols-3">
                  {/* Active Rules */}
                  <div className="px-5 py-3">
                    <p className="text-description mb-1.5 text-[10px] font-semibold uppercase tracking-wider">
                      Active Rules
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {Object.entries(mergedRules)
                        .filter(([, v]) => v)
                        .slice(0, 6)
                        .map(([key]) => {
                          const isRole = key in (p.rules ?? {});
                          return (
                            <span
                              key={key}
                              className={cn(
                                "rounded px-1.5 py-0.5 text-[10px] font-medium",
                                isRole
                                  ? "bg-primary/10 text-primary"
                                  : "bg-secondary text-description",
                              )}
                            >
                              {key.replace(/^(block_|redact_)/, "").replace(/_/g, " ")}
                            </span>
                          );
                        })}
                      {activeRuleCount > 6 && (
                        <span className="text-description-muted text-[10px]">
                          +{activeRuleCount - 6} more
                        </span>
                      )}
                      {activeRuleCount === 0 && (
                        <span className="text-description-muted text-[10px]">
                          No rules configured
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Thresholds */}
                  <div className="border-border px-5 py-3 sm:border-l">
                    <p className="text-description mb-1.5 text-[10px] font-semibold uppercase tracking-wider">
                      Thresholds
                    </p>
                    <div className="space-y-1 text-xs">
                      <div className="flex justify-between">
                        <span className="text-description">Injection</span>
                        <span className="text-foreground font-semibold">{effThreshold}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-description">Severity</span>
                        <span className="text-foreground font-semibold">
                          {p.severity_threshold ??
                            ((globalPolicy as Record<string, unknown> | null)
                              ?.severity_threshold as string) ??
                            "medium"}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-description">Response scan</span>
                        <span className="text-foreground font-semibold">
                          {p.response_scanning?.enabled === true
                            ? "ON"
                            : (
                                  (globalPolicy as Record<string, unknown> | null)
                                    ?.response_scanning as { enabled?: boolean } | undefined
                                )?.enabled
                              ? "ON (global)"
                              : "OFF"}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* File Restrictions */}
                  <div className="border-border px-5 py-3 sm:border-l">
                    <p className="text-description mb-1.5 text-[10px] font-semibold uppercase tracking-wider">
                      File Restrictions
                    </p>
                    <div className="flex flex-wrap gap-1">
                      {(p.blocked_paths ?? []).slice(0, 4).map((bp) => (
                        <span
                          key={bp}
                          className="bg-error/10 text-error rounded px-1.5 py-0.5 font-mono text-[10px]"
                        >
                          {bp}
                        </span>
                      ))}
                      {(p.blocked_paths ?? []).length > 4 && (
                        <span className="text-description-muted text-[10px]">
                          +{(p.blocked_paths ?? []).length - 4} more
                        </span>
                      )}
                      {(p.blocked_paths ?? []).length === 0 && (
                        <span className="text-description-muted text-[10px]">
                          Inherits global ({allBlocked.size} patterns)
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Last updated footer */}
                {row.updatedAt && (
                  <div className="border-border border-t px-5 py-2">
                    <p className="text-description-muted text-[10px]">
                      Updated {new Date(row.updatedAt).toLocaleString()}
                    </p>
                  </div>
                )}
              </div>
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

  // Load the global baseline so the Effective tab can show inherited values.
  const [globalPolicy, setGlobalPolicy] = useState<PartialPolicy | null>(null);
  useEffect(() => {
    apiClient
      .get<PartialPolicy>(ENDPOINTS.policy.global)
      .then(setGlobalPolicy)
      .catch(() => setGlobalPolicy(null));
  }, []);

  // Two edit modes sharing one buffer.
  const [activeTab, setActiveTab] = useState<"form" | "json" | "effective">("form");
  const [policy, setPolicy] = useState<PartialPolicy>(row.policy ?? {});
  const [jsonText, setJsonText] = useState<string>(JSON.stringify(row.policy ?? {}, null, 2));
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
      await apiClient.put(ENDPOINTS.policy.role(row.role), policy);
      await onSaved();
      onClose();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to save policy");
    } finally {
      setSaving(false);
    }
  }

  async function removeOverride() {
    setSaving(true);
    setSaveError(null);
    try {
      await apiClient.del(ENDPOINTS.policy.role(row.role));
      await onDeleted();
      onClose();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Failed to remove override");
    } finally {
      setSaving(false);
      setConfirmDelete(false);
    }
  }

  const Icon = meta.icon;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="pointer-events-none fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8">
        <Card className="pointer-events-auto w-full max-w-3xl" padding={false}>
          {/* Header */}
          <div className="border-border flex items-center justify-between border-b px-6 py-4">
            <div className="flex items-center gap-3">
              <Icon className={cn("h-6 w-6", meta.color)} />
              <div>
                <h2 className="text-foreground text-lg font-semibold">{meta.label} policy</h2>
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
              { id: "effective", label: "Effective Policy" },
            ]}
            activeTab={activeTab}
            onChange={(id) => setActiveTab(id as "form" | "json" | "effective")}
            className="px-6"
          />

          {/* Body */}
          <div className="px-6 py-5">
            {activeTab === "form" ? (
              <FormEditor policy={policy} onChange={applyPolicyUpdate} />
            ) : activeTab === "json" ? (
              <JsonEditor value={jsonText} error={jsonError} onChange={handleJsonChange} />
            ) : (
              <EffectivePolicyView
                globalPolicy={globalPolicy}
                roleOverride={policy}
                roleName={row.role}
              />
            )}
          </div>

          {saveError && <ErrorBanner message={saveError} className="mx-6" />}

          {/* Footer actions */}
          <div className="border-border flex items-center justify-between gap-2 border-t px-6 py-4">
            <div>
              {row.hasOverride && (
                <Button variant="danger" onClick={() => setConfirmDelete(true)} disabled={saving}>
                  <TrashIcon className="mr-1.5 h-4 w-4" />
                  Remove override
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={onClose} disabled={saving}>
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
        Only set the fields you want to tighten. Leave a field blank to inherit from the org
        baseline.
      </div>

      {/* Rules */}
      <section>
        <h3 className="text-foreground mb-2 text-sm font-semibold">Rules</h3>
        <p className="text-description mb-3 text-xs">
          Each checkbox is tri-state: inherit (blank), force-on (✓), force-off is ignored because
          overrides only tighten.
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {(Object.keys(RULE_LABELS) as (keyof PartialPolicyRules)[]).map((key) => {
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
                  onChange={(e) => setRule(key, e.target.checked ? true : undefined)}
                  className="accent-primary h-4 w-4"
                />
                <span className="text-foreground">{RULE_LABELS[key]}</span>
              </label>
            );
          })}
        </div>
      </section>

      {/* Prompt injection threshold */}
      <section>
        <h3 className="text-foreground mb-2 text-sm font-semibold">Prompt injection threshold</h3>
        <p className="text-description mb-3 text-xs">
          Lower = stricter. Leave unset to inherit. Range 0–100.
        </p>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={0}
            max={100}
            value={injectionThreshold ?? 60}
            onChange={(e) => setInjectionThreshold(Number(e.target.value))}
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
        <h3 className="text-foreground mb-2 text-sm font-semibold">Response scanning</h3>
        <label className="border-border flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-sm">
          <input
            type="checkbox"
            checked={policy.response_scanning?.enabled === true}
            onChange={(e) => setResponseScanning(e.target.checked ? true : undefined)}
            className="accent-primary h-4 w-4"
          />
          <span className="text-foreground">Force-enable scanning of model responses</span>
        </label>
      </section>

      {/* Severity threshold */}
      <section>
        <h3 className="text-foreground mb-2 text-sm font-semibold">Severity threshold</h3>
        <div className="flex gap-2">
          {(["medium", "high", "critical"] as const).map((s) => (
            <Button
              key={s}
              variant={policy.severity_threshold === s ? "primary" : "outline"}
              size="sm"
              onClick={() => setSeverity(policy.severity_threshold === s ? undefined : s)}
            >
              {s}
            </Button>
          ))}
          <Button variant="ghost" size="sm" onClick={() => setSeverity(undefined)}>
            Inherit
          </Button>
        </div>
      </section>

      {/* File restrictions (blocked_paths) */}
      <section>
        <h3 className="text-foreground mb-2 flex items-center gap-2 text-sm font-semibold">
          <FolderIcon className="h-4 w-4" />
          File &amp; Folder Restrictions
        </h3>
        <p className="text-description mb-3 text-xs">
          Glob patterns for files/folders this role cannot send to AI. Use{" "}
          <code className="bg-input rounded px-1">**/folder/**</code> for any folder,{" "}
          <code className="bg-input rounded px-1">*.ext</code> for file types. These are merged with
          the global policy&apos;s blocklist (visible in the Effective Policy tab).
        </p>
        <BlockedPathsEditor
          paths={policy.blocked_paths ?? []}
          onChange={(paths) => {
            const next: PartialPolicy = { ...policy };
            if (paths.length === 0) {
              delete next.blocked_paths;
            } else {
              next.blocked_paths = paths;
            }
            onChange(next);
          }}
        />
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

// ─── Blocked paths inline editor ────────────────────────────────────

function BlockedPathsEditor({
  paths,
  onChange,
}: {
  paths: string[];
  onChange: (paths: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  function add() {
    const trimmed = draft.trim();
    if (!trimmed || paths.includes(trimmed)) return;
    onChange([...paths, trimmed]);
    setDraft("");
  }

  function remove(idx: number) {
    onChange(paths.filter((_, i) => i !== idx));
  }

  return (
    <div className="space-y-2">
      {paths.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {paths.map((p, i) => (
            <span
              key={i}
              className="bg-error/10 text-error inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium"
            >
              <code>{p}</code>
              <button
                type="button"
                onClick={() => remove(i)}
                className="hover:text-foreground ml-0.5"
                aria-label={`Remove ${p}`}
              >
                <XMarkIcon className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder="e.g. **/payments/** or .env or *.pem"
          className="bg-input text-foreground border-border focus:border-border-focus placeholder:text-input-placeholder flex-1 rounded-md border px-3 py-1.5 text-sm focus:outline-none focus:ring-1"
        />
        <Button size="sm" variant="outline" onClick={add} disabled={!draft.trim()}>
          <PlusIcon className="mr-1 h-3.5 w-3.5" />
          Add
        </Button>
      </div>
      {paths.length === 0 && (
        <p className="text-description-muted text-xs">
          No role-specific file restrictions. The global policy&apos;s file_scope.blocklist still
          applies.
        </p>
      )}
    </div>
  );
}

// ─── Effective policy view (read-only merged view) ──────────────────

function EffectivePolicyView({
  globalPolicy,
  roleOverride,
  roleName,
}: {
  globalPolicy: PartialPolicy | null;
  roleOverride: PartialPolicy;
  roleName: string;
}) {
  if (!globalPolicy) {
    return <p className="text-description py-8 text-center text-sm">Loading global policy...</p>;
  }

  const gFileScope = (globalPolicy as Record<string, unknown>).file_scope as
    | { blocklist?: string[]; allowlist?: string[] }
    | undefined;
  const gBlockedPaths = (globalPolicy as Record<string, unknown>).blocked_paths as
    | string[]
    | undefined;

  const rBlockedPaths = roleOverride.blocked_paths ?? [];
  const rFileScope = roleOverride.file_scope ?? {};

  // Merge blocklists (union)
  const allBlocked = new Set<string>();
  for (const p of gFileScope?.blocklist ?? []) allBlocked.add(p);
  for (const p of gBlockedPaths ?? []) allBlocked.add(p);
  for (const p of rBlockedPaths) allBlocked.add(p);
  for (const p of rFileScope.blocklist ?? []) allBlocked.add(p);

  // Merge rules (OR = strictest)
  const gRules = (globalPolicy as Record<string, unknown>).rules as
    | Record<string, boolean>
    | undefined;
  const rRules = roleOverride.rules ?? {};
  const mergedRules: Record<string, boolean> = { ...(gRules ?? {}), ...rRules };

  // Merge thresholds (MIN)
  const gThreshold = (globalPolicy as Record<string, unknown>).prompt_injection as
    | { threshold?: number }
    | undefined;
  const rThreshold = roleOverride.prompt_injection?.threshold;
  const effectiveThreshold =
    rThreshold !== undefined && gThreshold?.threshold !== undefined
      ? Math.min(rThreshold, gThreshold.threshold)
      : (rThreshold ?? gThreshold?.threshold ?? 60);

  return (
    <div className="space-y-5">
      <div className="border-info/30 bg-info/5 text-description rounded-lg border px-3 py-2 text-xs">
        <EyeIcon className="text-info mr-1 inline h-3.5 w-3.5" />
        This is the <strong>effective policy</strong> for the <strong>{roleName}</strong> role after
        merging the global baseline + role override. Read-only — edit via the Form or JSON tabs.
      </div>

      {/* Merged rules */}
      <section>
        <h3 className="text-foreground mb-2 text-sm font-semibold">Effective Rules</h3>
        <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
          {Object.entries(mergedRules).map(([key, val]) => {
            const isFromRole = key in rRules;
            return (
              <div key={key} className="flex items-center gap-2 rounded px-2 py-1 text-xs">
                <span
                  className={cn(
                    "h-2 w-2 shrink-0 rounded-full",
                    val ? "bg-success" : "bg-secondary",
                  )}
                />
                <span className="text-foreground">{key.replace(/_/g, " ")}</span>
                {isFromRole && (
                  <span className="bg-primary/10 text-primary rounded px-1 text-[9px] font-bold uppercase">
                    role
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Prompt injection */}
      <section>
        <h3 className="text-foreground mb-2 text-sm font-semibold">Prompt Injection Threshold</h3>
        <p className="text-foreground text-sm">
          <strong>{effectiveThreshold}</strong>
          <span className="text-description ml-2 text-xs">
            (global: {gThreshold?.threshold ?? "60"}
            {rThreshold !== undefined ? `, role: ${rThreshold}` : ""} — min wins)
          </span>
        </p>
      </section>

      {/* Effective file restrictions */}
      <section>
        <h3 className="text-foreground mb-2 flex items-center gap-2 text-sm font-semibold">
          <FolderIcon className="h-4 w-4" />
          Effective File Restrictions
          <span className="bg-secondary text-description rounded-full px-2 py-0.5 text-[10px] font-normal">
            {allBlocked.size} patterns
          </span>
        </h3>
        <div className="space-y-1">
          {Array.from(allBlocked)
            .sort()
            .map((pattern) => {
              const fromRole =
                rBlockedPaths.includes(pattern) || (rFileScope.blocklist ?? []).includes(pattern);
              const fromGlobal =
                (gFileScope?.blocklist ?? []).includes(pattern) ||
                (gBlockedPaths ?? []).includes(pattern);
              return (
                <div
                  key={pattern}
                  className="border-border flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs"
                >
                  <code className="text-foreground flex-1 font-mono">{pattern}</code>
                  {fromGlobal && (
                    <span className="bg-secondary text-description shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase">
                      global
                    </span>
                  )}
                  {fromRole && (
                    <span className="bg-primary/10 text-primary shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase">
                      role
                    </span>
                  )}
                </div>
              );
            })}
        </div>
        {allBlocked.size === 0 && (
          <p className="text-description-muted py-4 text-center text-xs">
            No file restrictions configured.
          </p>
        )}
      </section>
    </div>
  );
}

export default RolePoliciesPage;
