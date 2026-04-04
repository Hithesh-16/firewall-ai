/**
 * Privacy Settings Page — telemetry controls, data retention, export.
 * Web-only route: /privacy
 */

import { useState, useCallback } from "react";
import { useProxyApi } from "../../hooks/useProxyApi";

interface PrivacySettings {
  telemetryEnabled: boolean;
  retentionDays: number;
  anonymizeLogsEnabled: boolean;
}

export default function PrivacyPage() {
  const api = useProxyApi();
  const [settings, setSettings] = useState<PrivacySettings>({
    telemetryEnabled: false,
    retentionDays: 30,
    anonymizeLogsEnabled: true,
  });
  const [exporting, setExporting] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = useCallback(async () => {
    try {
      await api.post("/api/privacy/settings", settings);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      // ignore
    }
  }, [api, settings]);

  const handleExport = useCallback(
    async (format: "json" | "csv") => {
      setExporting(true);
      try {
        const blob = await api.get<Blob>(`/api/export/${format}`);
        const url = URL.createObjectURL(
          new Blob([JSON.stringify(blob)], { type: "application/json" }),
        );
        const a = document.createElement("a");
        a.href = url;
        a.download = `ai-firewall-data.${format}`;
        a.click();
        URL.revokeObjectURL(url);
      } catch {
        // ignore
      } finally {
        setExporting(false);
      }
    },
    [api],
  );

  const handleDeleteData = useCallback(async () => {
    if (
      !window.confirm(
        "This will permanently delete all audit logs and usage data. Continue?",
      )
    ) {
      return;
    }
    try {
      await api.del("/api/privacy/data");
    } catch {
      // ignore
    }
  }, [api]);

  return (
    <div className="mx-auto max-w-3xl p-4">
      <div className="mb-6">
        <h2 className="text-foreground text-lg font-semibold">
          Privacy Settings
        </h2>
        <p className="text-description-muted text-xs">
          Control telemetry, data retention, and export your data
        </p>
      </div>

      {/* Telemetry */}
      <section className="border-border mb-4 rounded border p-4">
        <h3 className="text-foreground mb-3 text-sm font-semibold">
          Telemetry
        </h3>
        <label className="flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={settings.telemetryEnabled}
            onChange={(e) =>
              setSettings({ ...settings, telemetryEnabled: e.target.checked })
            }
            className="accent-primary h-4 w-4 rounded"
          />
          <div>
            <p className="text-foreground text-sm">
              Send anonymous usage telemetry
            </p>
            <p className="text-description-muted text-2xs">
              Helps improve AI Firewall. No PII, secrets, or prompt content is
              ever sent.
            </p>
          </div>
        </label>
      </section>

      {/* Data Retention */}
      <section className="border-border mb-4 rounded border p-4">
        <h3 className="text-foreground mb-3 text-sm font-semibold">
          Data Retention
        </h3>
        <label className="flex items-center gap-3">
          <span className="text-foreground text-sm">Keep audit logs for</span>
          <select
            value={settings.retentionDays}
            onChange={(e) =>
              setSettings({
                ...settings,
                retentionDays: parseInt(e.target.value, 10),
              })
            }
            className="bg-input text-input-foreground border-border rounded border px-2 py-1 text-sm"
          >
            <option value={7}>7 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
            <option value={365}>1 year</option>
            <option value={0}>Forever</option>
          </select>
        </label>

        <label className="mt-3 flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={settings.anonymizeLogsEnabled}
            onChange={(e) =>
              setSettings({
                ...settings,
                anonymizeLogsEnabled: e.target.checked,
              })
            }
            className="accent-primary h-4 w-4 rounded"
          />
          <div>
            <p className="text-foreground text-sm">Anonymize stored logs</p>
            <p className="text-description-muted text-2xs">
              Strip user IDs and IP addresses from audit logs after retention
              period
            </p>
          </div>
        </label>
      </section>

      {/* Save */}
      <div className="mb-6">
        <button
          onClick={handleSave}
          className="bg-primary text-primary-foreground hover:bg-primary-hover rounded px-4 py-1.5 text-sm transition-colors"
        >
          {saved ? "Saved" : "Save Settings"}
        </button>
      </div>

      {/* Data Export */}
      <section className="border-border mb-4 rounded border p-4">
        <h3 className="text-foreground mb-3 text-sm font-semibold">
          Data Export
        </h3>
        <p className="text-description-muted mb-3 text-xs">
          Download all your data including audit logs, scan results, and usage
          records.
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => handleExport("json")}
            disabled={exporting}
            className="border-border text-description hover:bg-list-hover rounded border px-3 py-1 text-xs transition-colors disabled:opacity-50"
          >
            {exporting ? "Exporting..." : "Export JSON"}
          </button>
          <button
            onClick={() => handleExport("csv")}
            disabled={exporting}
            className="border-border text-description hover:bg-list-hover rounded border px-3 py-1 text-xs transition-colors disabled:opacity-50"
          >
            Export CSV
          </button>
        </div>
      </section>

      {/* Danger Zone */}
      <section className="border-error/30 rounded border p-4">
        <h3 className="text-error mb-3 text-sm font-semibold">Danger Zone</h3>
        <p className="text-description-muted mb-3 text-xs">
          Permanently delete all audit logs, usage data, and scan cache. This
          action cannot be undone.
        </p>
        <button
          onClick={handleDeleteData}
          className="text-error border-error/30 hover:bg-error/10 rounded border px-3 py-1 text-xs transition-colors"
        >
          Delete All Data
        </button>
      </section>
    </div>
  );
}
