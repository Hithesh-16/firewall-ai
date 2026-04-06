import { useEffect, useState } from "react";
import { apiClient } from "../../api/client";
import { useAppDispatch } from "../../store/hooks";
import { showToast } from "../../store/slices/uiSlice";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Toggle } from "../../components/ui/Toggle";
import { LoadingSpinner } from "../../components/ui/LoadingSpinner";
import { ErrorBanner } from "../../components/ui/ErrorBanner";

interface PolicyRule {
  key: string;
  label: string;
  description: string;
  category: "blocking" | "redaction" | "general";
}

const RULES: PolicyRule[] = [
  // Blocking
  {
    key: "block_private_keys",
    label: "Block Private Keys",
    description: "Block requests containing private keys (RSA, EC, PGP)",
    category: "blocking",
  },
  {
    key: "block_aws_keys",
    label: "Block AWS Keys",
    description: "Block requests containing AWS access key IDs or secret keys",
    category: "blocking",
  },
  {
    key: "block_db_urls",
    label: "Block Database URLs",
    description:
      "Block requests containing database connection strings with credentials",
    category: "blocking",
  },
  {
    key: "block_github_tokens",
    label: "Block GitHub Tokens",
    description: "Block requests containing GitHub personal access tokens",
    category: "blocking",
  },
  // Redaction
  {
    key: "redact_emails",
    label: "Redact Emails",
    description: "Replace email addresses with placeholders before forwarding",
    category: "redaction",
  },
  {
    key: "redact_phone",
    label: "Redact Phone Numbers",
    description: "Replace phone numbers with placeholders before forwarding",
    category: "redaction",
  },
  {
    key: "redact_jwt",
    label: "Redact JWT Tokens",
    description: "Replace JSON Web Tokens with placeholders before forwarding",
    category: "redaction",
  },
  {
    key: "redact_generic_api_keys",
    label: "Redact Generic API Keys",
    description:
      "Replace detected API keys with placeholders before forwarding",
    category: "redaction",
  },
  // General
  {
    key: "allow_source_code",
    label: "Allow Source Code",
    description: "Allow source code to pass through without blocking",
    category: "general",
  },
  {
    key: "log_all_requests",
    label: "Log All Requests",
    description: "Log every request to the audit trail, not just flagged ones",
    category: "general",
  },
];

const CATEGORY_LABELS: Record<string, string> = {
  blocking: "Blocking Rules",
  redaction: "Redaction Rules",
  general: "General Settings",
};

const CATEGORIES = ["blocking", "redaction", "general"] as const;

export function PolicyEditor() {
  const dispatch = useAppDispatch();
  const [policy, setPolicy] = useState<Record<string, boolean>>({});
  const [originalPolicy, setOriginalPolicy] = useState<Record<string, boolean>>(
    {},
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const data =
          await apiClient.get<Record<string, unknown>>("/api/policy");
        const boolValues: Record<string, boolean> = {};
        for (const rule of RULES) {
          boolValues[rule.key] = data[rule.key] === true;
        }
        setPolicy(boolValues);
        setOriginalPolicy(boolValues);
      } catch (err: unknown) {
        if (err instanceof Error) setError(err.message);
        else setError("Failed to load policy");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  function handleToggle(key: string, value: boolean) {
    setPolicy((prev) => ({ ...prev, [key]: value }));
  }

  const hasChanges = Object.keys(policy).some(
    (k) => policy[k] !== originalPolicy[k],
  );

  async function handleSave() {
    setSaving(true);
    try {
      await apiClient.put("/api/policy", policy);
      setOriginalPolicy({ ...policy });
      dispatch(
        showToast({
          id: `policy-save-${Date.now()}`,
          type: "success",
          message: "Policy saved successfully",
        }),
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to save policy";
      dispatch(
        showToast({
          id: `policy-error-${Date.now()}`,
          type: "error",
          message: msg,
        }),
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (error) {
    return <ErrorBanner message={error} onDismiss={() => setError(null)} />;
  }

  return (
    <div className="space-y-6">
      {CATEGORIES.map((cat) => {
        const rules = RULES.filter((r) => r.category === cat);
        return (
          <Card key={cat}>
            <h3 className="text-description-muted mb-4 text-sm font-semibold uppercase tracking-wider">
              {CATEGORY_LABELS[cat]}
            </h3>
            <div className="space-y-4">
              {rules.map((rule) => (
                <div
                  key={rule.key}
                  className="flex items-start justify-between gap-4"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-foreground text-sm font-medium">
                      {rule.label}
                    </p>
                    <p className="text-description text-xs">
                      {rule.description}
                    </p>
                  </div>
                  <Toggle
                    enabled={policy[rule.key] ?? false}
                    onChange={(v) => handleToggle(rule.key, v)}
                  />
                </div>
              ))}
            </div>
          </Card>
        );
      })}

      {hasChanges && (
        <div className="border-border bg-editor sticky bottom-4 flex items-center justify-end gap-3 rounded-lg border p-4 shadow-lg">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setPolicy({ ...originalPolicy })}
          >
            Discard
          </Button>
          <Button size="sm" loading={saving} onClick={handleSave}>
            Save Policy
          </Button>
        </div>
      )}
    </div>
  );
}
