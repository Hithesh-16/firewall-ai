import { useState, useEffect } from "react";
import { apiClient } from "../../api/client";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Toggle } from "../../components/ui/Toggle";
import { LoadingSpinner } from "../../components/ui/LoadingSpinner";
import { ErrorBanner } from "../../components/ui/ErrorBanner";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { ShieldCheckIcon, ArrowDownTrayIcon, TrashIcon } from "@heroicons/react/24/outline";

interface PrivacySettings {
  telemetryEnabled: boolean;
  retentionDays: number;
  anonymizeLogs: boolean;
}

const RETENTION_OPTIONS = [
  { value: 7, label: "7 days" },
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
  { value: 365, label: "1 year" },
  { value: -1, label: "Forever" },
];

export function PrivacyPage() {
  const [settings, setSettings] = useState<PrivacySettings>({
    telemetryEnabled: false,
    retentionDays: 30,
    anonymizeLogs: false,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiClient.get<PrivacySettings>("/api/privacy/settings");
        setSettings(res);
      } catch {
        // Use defaults
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleSave = async () => {
    try {
      await apiClient.post("/api/privacy/settings", settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save");
    }
  };

  const handleExport = async (format: "json" | "csv") => {
    try {
      const blob = await apiClient.download(`/api/export/${format}`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ai-firewall-export.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Export failed");
    }
  };

  const handleDeleteAll = async () => {
    try {
      setDeleting(true);
      await apiClient.del("/api/privacy/data");
      setShowDelete(false);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl p-6">
      <div className="mb-6 flex items-center gap-3">
        <ShieldCheckIcon className="text-primary h-6 w-6" />
        <h1 className="text-foreground text-xl font-semibold">Privacy Settings</h1>
      </div>

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      <div className="space-y-6">
        <Card>
          <h2 className="text-foreground mb-4 font-medium">Telemetry</h2>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-foreground text-sm">Send anonymous usage telemetry</p>
              <p className="text-description-muted text-xs">
                No PII, secrets, or code content is ever sent
              </p>
            </div>
            <Toggle
              enabled={settings.telemetryEnabled}
              onChange={(v) => setSettings({ ...settings, telemetryEnabled: v })}
            />
          </div>
        </Card>

        <Card>
          <h2 className="text-foreground mb-4 font-medium">Data Retention</h2>
          <div className="space-y-4">
            <div>
              <label className="text-description mb-1 block text-sm">Retain audit logs for</label>
              <select
                value={settings.retentionDays}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    retentionDays: Number(e.target.value),
                  })
                }
                className="border-input-border bg-input text-input-foreground w-full rounded-lg border px-3 py-2"
              >
                {RETENTION_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-foreground text-sm">Anonymize stored logs</p>
                <p className="text-description-muted text-xs">
                  Hash all identifying information in audit logs
                </p>
              </div>
              <Toggle
                enabled={settings.anonymizeLogs}
                onChange={(v) => setSettings({ ...settings, anonymizeLogs: v })}
              />
            </div>
          </div>
        </Card>

        <div className="flex items-center gap-3">
          <Button variant="primary" onClick={handleSave}>
            Save Settings
          </Button>
          {saved && <span className="text-success text-sm">Saved</span>}
        </div>

        <Card>
          <h2 className="text-foreground mb-4 font-medium">Data Export</h2>
          <div className="flex gap-3">
            <Button variant="secondary" size="sm" onClick={() => handleExport("json")}>
              <ArrowDownTrayIcon className="mr-1 h-4 w-4" /> Export JSON
            </Button>
            <Button variant="secondary" size="sm" onClick={() => handleExport("csv")}>
              <ArrowDownTrayIcon className="mr-1 h-4 w-4" /> Export CSV
            </Button>
          </div>
        </Card>

        <Card className="border-error/30">
          <h2 className="text-error mb-2 font-medium">Danger Zone</h2>
          <p className="text-description mb-4 text-sm">
            Permanently delete all audit data, logs, and cached scan results. This action cannot be
            undone.
          </p>
          <Button variant="danger" size="sm" onClick={() => setShowDelete(true)}>
            <TrashIcon className="mr-1 h-4 w-4" /> Delete All Data
          </Button>
        </Card>
      </div>

      <ConfirmDialog
        open={showDelete}
        title="Delete All Data"
        message="This will permanently delete all audit logs, scan results, and cached data. This action cannot be undone."
        confirmLabel={deleting ? "Deleting..." : "Delete Everything"}
        variant="danger"
        onConfirm={handleDeleteAll}
        onCancel={() => setShowDelete(false)}
      />
    </div>
  );
}
