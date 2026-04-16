import { useState, useEffect } from "react";
import { apiClient } from "../../api/client";
import { ENDPOINTS } from "../../api/endpoints";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { LoadingSpinner } from "../../components/ui/LoadingSpinner";
import { ErrorBanner } from "../../components/ui/ErrorBanner";
import { EmptyState } from "../../components/ui/EmptyState";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { BellIcon, TrashIcon, PlusIcon } from "@heroicons/react/24/outline";

interface Channel {
  id: string;
  channelType: "webhook" | "slack" | "email" | "webpush";
  config: Record<string, string>;
  createdAt?: string;
}

const CHANNEL_TYPES = ["webhook", "slack", "email", "webpush"] as const;

export function NotificationsPage() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [addType, setAddType] = useState<Channel["channelType"]>("webhook");
  const [addUrl, setAddUrl] = useState("");
  const [addEmail, setAddEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Channel | null>(null);
  const [testing, setTesting] = useState(false);

  const fetchChannels = async () => {
    try {
      setLoading(true);
      const res = await apiClient.get<{ channels: Channel[] }>(ENDPOINTS.notifications.channels);
      setChannels(res.channels ?? []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchChannels();
  }, []);

  const handleAdd = async () => {
    try {
      setSaving(true);
      const config: Record<string, string> = {};
      if (addType === "webhook" || addType === "slack") config.url = addUrl;
      if (addType === "email") config.email = addEmail;
      await apiClient.post(ENDPOINTS.notifications.channels, {
        channelType: addType,
        config,
      });
      setShowAdd(false);
      setAddUrl("");
      setAddEmail("");
      fetchChannels();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to add channel");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await apiClient.del(ENDPOINTS.notifications.channel(String(deleteTarget.id)));
      setDeleteTarget(null);
      fetchChannels();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to delete");
    }
  };

  const handleTest = async () => {
    try {
      setTesting(true);
      await apiClient.post(ENDPOINTS.notifications.test);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Test failed");
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-foreground text-xl font-semibold">Notification Channels</h1>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={handleTest} loading={testing}>
            Test All
          </Button>
          <Button variant="primary" size="sm" onClick={() => setShowAdd(true)}>
            <PlusIcon className="mr-1 h-4 w-4" /> Add Channel
          </Button>
        </div>
      </div>

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {loading ? (
        <div className="flex justify-center py-12">
          <LoadingSpinner />
        </div>
      ) : channels.length === 0 ? (
        <EmptyState
          icon={<BellIcon className="h-12 w-12" />}
          title="No channels configured"
          description="Add notification channels to receive alerts for approvals, blocks, and security events"
          actionLabel="Add Channel"
          onAction={() => setShowAdd(true)}
        />
      ) : (
        <div className="space-y-3">
          {channels.map((ch) => (
            <Card key={ch.id} className="flex items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <Badge variant="info">{ch.channelType}</Badge>
                  <span className="text-description text-sm">
                    {ch.config.url || ch.config.email || "Configured"}
                  </span>
                </div>
              </div>
              <button
                onClick={() => setDeleteTarget(ch)}
                className="text-description hover:text-error rounded p-1"
              >
                <TrashIcon className="h-4 w-4" />
              </button>
            </Card>
          ))}
        </div>
      )}

      {showAdd && (
        <Card className="mt-6">
          <h2 className="text-foreground mb-4 font-medium">Add Channel</h2>
          <div className="space-y-3">
            <div>
              <label className="text-description mb-1 block text-sm">Type</label>
              <select
                value={addType}
                onChange={(e) => setAddType(e.target.value as Channel["channelType"])}
                className="border-input-border bg-input text-input-foreground w-full rounded-lg border px-3 py-2"
              >
                {CHANNEL_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            {(addType === "webhook" || addType === "slack") && (
              <div>
                <label className="text-description mb-1 block text-sm">URL</label>
                <input
                  value={addUrl}
                  onChange={(e) => setAddUrl(e.target.value)}
                  placeholder="https://..."
                  className="border-input-border bg-input text-input-foreground w-full rounded-lg border px-3 py-2"
                />
              </div>
            )}
            {addType === "email" && (
              <div>
                <label className="text-description mb-1 block text-sm">Email</label>
                <input
                  value={addEmail}
                  onChange={(e) => setAddEmail(e.target.value)}
                  placeholder="admin@example.com"
                  className="border-input-border bg-input text-input-foreground w-full rounded-lg border px-3 py-2"
                />
              </div>
            )}
            <div className="flex gap-2">
              <Button variant="primary" size="sm" onClick={handleAdd} loading={saving}>
                Add
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setShowAdd(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </Card>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Channel"
        message="Remove this notification channel?"
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
