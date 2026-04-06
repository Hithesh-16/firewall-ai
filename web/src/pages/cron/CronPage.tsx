import { useState, useEffect } from "react";
import { apiClient } from "../../api/client";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { Toggle } from "../../components/ui/Toggle";
import { LoadingSpinner } from "../../components/ui/LoadingSpinner";
import { ErrorBanner } from "../../components/ui/ErrorBanner";
import { EmptyState } from "../../components/ui/EmptyState";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { ClockIcon, PlusIcon, TrashIcon } from "@heroicons/react/24/outline";

interface CronJob {
  id: string;
  name: string;
  schedule: string;
  enabled: boolean;
  lastRunAt?: string;
  nextRunAt?: string;
  agentConfig?: { description: string; prompt: string; model?: string };
}

const SCHEDULE_OPTIONS = [
  { value: "5m", label: "Every 5 minutes" },
  { value: "15m", label: "Every 15 minutes" },
  { value: "1h", label: "Every hour" },
  { value: "6h", label: "Every 6 hours" },
  { value: "24h", label: "Every 24 hours" },
];

export function CronPage() {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CronJob | null>(null);

  // Create form
  const [formName, setFormName] = useState("");
  const [formSchedule, setFormSchedule] = useState("1h");
  const [formDesc, setFormDesc] = useState("");
  const [formPrompt, setFormPrompt] = useState("");
  const [creating, setCreating] = useState(false);

  const fetchJobs = async () => {
    try {
      setLoading(true);
      const res = await apiClient.get<{ jobs: CronJob[] }>("/api/cron");
      setJobs(res.jobs ?? []);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJobs();
  }, []);

  const handleToggle = async (job: CronJob) => {
    try {
      const endpoint = job.enabled
        ? `/api/cron/${job.id}/disable`
        : `/api/cron/${job.id}/enable`;
      await apiClient.post(endpoint);
      setJobs((prev) =>
        prev.map((j) => (j.id === job.id ? { ...j, enabled: !j.enabled } : j)),
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to toggle");
    }
  };

  const handleCreate = async () => {
    try {
      setCreating(true);
      await apiClient.post("/api/cron", {
        name: formName,
        schedule: formSchedule,
        agentConfig: { description: formDesc, prompt: formPrompt },
      });
      setShowCreate(false);
      setFormName("");
      setFormDesc("");
      setFormPrompt("");
      fetchJobs();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to create");
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await apiClient.del(`/api/cron/${deleteTarget.id}`);
      setDeleteTarget(null);
      fetchJobs();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to delete");
    }
  };

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-foreground text-xl font-semibold">
          Scheduled Jobs
        </h1>
        <Button variant="primary" size="sm" onClick={() => setShowCreate(true)}>
          <PlusIcon className="mr-1 h-4 w-4" /> Create Job
        </Button>
      </div>

      {error && (
        <ErrorBanner message={error} onDismiss={() => setError(null)} />
      )}

      {showCreate && (
        <Card className="mb-6">
          <h2 className="text-foreground mb-4 font-medium">
            New Scheduled Job
          </h2>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-description mb-1 block text-sm">
                  Name
                </label>
                <input
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="Job name"
                  className="border-input-border bg-input text-input-foreground w-full rounded-lg border px-3 py-2"
                />
              </div>
              <div>
                <label className="text-description mb-1 block text-sm">
                  Schedule
                </label>
                <select
                  value={formSchedule}
                  onChange={(e) => setFormSchedule(e.target.value)}
                  className="border-input-border bg-input text-input-foreground w-full rounded-lg border px-3 py-2"
                >
                  {SCHEDULE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="text-description mb-1 block text-sm">
                Description
              </label>
              <input
                value={formDesc}
                onChange={(e) => setFormDesc(e.target.value)}
                placeholder="What this job does"
                className="border-input-border bg-input text-input-foreground w-full rounded-lg border px-3 py-2"
              />
            </div>
            <div>
              <label className="text-description mb-1 block text-sm">
                Agent Prompt
              </label>
              <textarea
                value={formPrompt}
                onChange={(e) => setFormPrompt(e.target.value)}
                rows={4}
                placeholder="Prompt for the scheduled agent..."
                className="border-input-border bg-input text-input-foreground w-full rounded-lg border px-3 py-2 text-sm"
              />
            </div>
            <div className="flex gap-2">
              <Button
                variant="primary"
                size="sm"
                onClick={handleCreate}
                loading={creating}
                disabled={!formName.trim()}
              >
                Create
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowCreate(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        </Card>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <LoadingSpinner />
        </div>
      ) : jobs.length === 0 ? (
        <EmptyState
          icon={<ClockIcon className="h-12 w-12" />}
          title="No scheduled jobs"
          description="Schedule recurring agent tasks for security audits, compliance checks, and more"
          actionLabel="Create Job"
          onAction={() => setShowCreate(true)}
        />
      ) : (
        <div className="space-y-3">
          {jobs.map((j) => (
            <Card
              key={j.id}
              className="flex items-center justify-between gap-4"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-foreground font-medium">{j.name}</span>
                  <Badge variant={j.enabled ? "success" : "default"}>
                    {j.enabled ? "Active" : "Paused"}
                  </Badge>
                  <span className="text-description-muted text-xs">
                    {j.schedule}
                  </span>
                </div>
                {j.agentConfig && (
                  <p className="text-description mt-1 text-sm">
                    {j.agentConfig.description}
                  </p>
                )}
                {j.lastRunAt && (
                  <p className="text-description-muted mt-1 text-xs">
                    Last run: {new Date(j.lastRunAt).toLocaleString()}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Toggle enabled={j.enabled} onChange={() => handleToggle(j)} />
                <button
                  onClick={() => setDeleteTarget(j)}
                  className="text-description hover:text-error rounded p-1"
                >
                  <TrashIcon className="h-4 w-4" />
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Job"
        message={`Delete "${deleteTarget?.name}"?`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
