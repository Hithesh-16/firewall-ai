import { useState, useEffect, useCallback } from "react";
import {
  CpuChipIcon,
  PlusIcon,
  XMarkIcon,
  PaperAirplaneIcon,
  CheckCircleIcon,
  ClockIcon,
  ShieldExclamationIcon,
} from "@heroicons/react/24/outline";
import { apiClient } from "../../api/client";
import { ENDPOINTS } from "../../api/endpoints";
import { formatRelativeTime } from "../../utils/format";
import { Card } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { UnderlineTabs } from "../../components/ui/UnderlineTabs";
import { DataTable } from "../../components/ui/DataTable";
import { EmptyState } from "../../components/ui/EmptyState";
import { ErrorBanner } from "../../components/ui/ErrorBanner";
import { LoadingSpinner } from "../../components/ui/LoadingSpinner";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

interface Agent {
  taskId: string;
  description: string;
  model?: string;
  status: string;
  progress?: number;
  startedAt?: string;
  background?: boolean;
}

interface Approval {
  id: string;
  actionType: string;
  resource: string;
  context?: string;
  createdAt: string;
}

interface ApprovalHistory {
  id: string;
  actionType: string;
  resource: string;
  decision: string;
  resolvedAt: string;
}

/* ------------------------------------------------------------------ */
/*  Tabs                                                              */
/* ------------------------------------------------------------------ */

const TABS = [
  { id: "active", label: "Active Agents" },
  { id: "approvals", label: "Approvals" },
  { id: "history", label: "History" },
];

/* ------------------------------------------------------------------ */
/*  Status helpers                                                    */
/* ------------------------------------------------------------------ */

function statusVariant(status: string): "success" | "warning" | "error" | "info" | "default" {
  switch (status) {
    case "running":
      return "success";
    case "pending":
      return "warning";
    case "failed":
    case "killed":
      return "error";
    case "completed":
      return "info";
    default:
      return "default";
  }
}

/* ------------------------------------------------------------------ */
/*  SpawnForm                                                         */
/* ------------------------------------------------------------------ */

function SpawnForm({ onSpawn, onCancel }: { onSpawn: () => void; onCancel: () => void }) {
  const [description, setDescription] = useState("");
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState("gpt-4");
  const [background, setBackground] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!description.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await apiClient.post(ENDPOINTS.agents.spawn, {
        description: description.trim(),
        prompt: prompt.trim(),
        model,
        background,
      });
      onSpawn();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to spawn agent");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="mb-4">
      <form onSubmit={handleSubmit} className="space-y-3">
        <h3 className="text-foreground text-sm font-semibold">Spawn Agent</h3>
        {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
        <input
          type="text"
          placeholder="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="border-input-border bg-input text-input-foreground placeholder:text-input-placeholder focus:border-border-focus focus:ring-border-focus w-full rounded-md border px-3 py-1.5 text-sm focus:outline-none focus:ring-1"
          required
        />
        <textarea
          placeholder="Prompt (instructions for the agent)"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={4}
          className="border-input-border bg-input text-input-foreground placeholder:text-input-placeholder focus:border-border-focus focus:ring-border-focus w-full rounded-md border px-3 py-1.5 text-sm focus:outline-none focus:ring-1"
        />
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="border-input-border bg-input text-input-foreground focus:border-border-focus focus:ring-border-focus rounded-md border px-3 py-1.5 text-sm focus:outline-none focus:ring-1"
          >
            <option value="gpt-4">GPT-4</option>
            <option value="gpt-4o">GPT-4o</option>
            <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
            <option value="claude-3-opus">Claude 3 Opus</option>
            <option value="claude-3-sonnet">Claude 3 Sonnet</option>
            <option value="gemini-pro">Gemini Pro</option>
          </select>
          <label className="text-foreground flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={background}
              onChange={(e) => setBackground(e.target.checked)}
              className="border-input-border rounded"
            />
            Background
          </label>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" type="button" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" type="submit" loading={submitting}>
            Spawn
          </Button>
        </div>
      </form>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/*  MessageForm                                                       */
/* ------------------------------------------------------------------ */

function MessageForm({ taskId, onSent }: { taskId: string; onSent: () => void }) {
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  async function handleSend() {
    if (!message.trim()) return;
    setSending(true);
    try {
      await apiClient.post(ENDPOINTS.agents.message(String(taskId)), {
        message: message.trim(),
      });
      setMessage("");
      onSent();
    } catch {
      // silently fail for message send
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="mt-2 flex gap-2">
      <input
        type="text"
        placeholder="Send message..."
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && handleSend()}
        className="border-input-border bg-input text-input-foreground placeholder:text-input-placeholder focus:border-border-focus flex-1 rounded-md border px-3 py-1 text-sm focus:outline-none"
      />
      <Button variant="icon" onClick={handleSend} disabled={sending} aria-label="Send message">
        <PaperAirplaneIcon className="h-4 w-4" />
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  AgentManagerPage                                                  */
/* ------------------------------------------------------------------ */

export function AgentManagerPage() {
  const [tab, setTab] = useState("active");
  const [agents, setAgents] = useState<Agent[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [history, setHistory] = useState<ApprovalHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSpawnForm, setShowSpawnForm] = useState(false);
  const [killTarget, setKillTarget] = useState<string | null>(null);
  const [messagingAgent, setMessagingAgent] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (tab === "active") {
        const data = await apiClient.get<{ agents: Agent[] } | Agent[]>(
          `${ENDPOINTS.agents.list}?active=true`,
        );
        setAgents(Array.isArray(data) ? data : (data.agents ?? []));
      } else if (tab === "approvals") {
        const data = await apiClient.get<{ approvals: Approval[] } | Approval[]>(
          ENDPOINTS.approvals.pending,
        );
        setApprovals(Array.isArray(data) ? data : (data.approvals ?? []));
      } else {
        const data = await apiClient.get<{ history: ApprovalHistory[] } | ApprovalHistory[]>(
          ENDPOINTS.approvals.history,
        );
        setHistory(Array.isArray(data) ? data : (data.history ?? []));
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  }, [tab]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function handleKill(taskId: string) {
    try {
      await apiClient.del(ENDPOINTS.agents.one(String(taskId)));
      setKillTarget(null);
      fetchData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to kill agent");
    }
  }

  async function handleResolve(id: string, decision: string) {
    try {
      await apiClient.post(ENDPOINTS.approvals.resolve(String(id)), { decision });
      fetchData();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to resolve approval");
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <CpuChipIcon className="text-primary h-6 w-6" />
          <h1 className="text-foreground text-xl font-bold">Agent Manager</h1>
          {agents.length > 0 && tab === "active" && (
            <Badge variant="info">{agents.length} active</Badge>
          )}
        </div>
        {tab === "active" && (
          <Button variant="primary" size="sm" onClick={() => setShowSpawnForm(true)}>
            <PlusIcon className="h-4 w-4" />
            Spawn Agent
          </Button>
        )}
      </div>

      <UnderlineTabs tabs={TABS} activeTab={tab} onChange={setTab} />

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      {showSpawnForm && tab === "active" && (
        <SpawnForm
          onSpawn={() => {
            setShowSpawnForm(false);
            fetchData();
          }}
          onCancel={() => setShowSpawnForm(false)}
        />
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <LoadingSpinner size="lg" />
        </div>
      ) : (
        <>
          {/* Active Agents */}
          {tab === "active" &&
            (agents.length === 0 ? (
              <EmptyState
                icon={<CpuChipIcon className="h-10 w-10" />}
                title="No Active Agents"
                description="Spawn an agent to get started with autonomous tasks."
                actionLabel="Spawn Agent"
                onAction={() => setShowSpawnForm(true)}
              />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {agents.map((agent) => (
                  <Card key={agent.taskId} className="space-y-2">
                    <div className="flex items-start justify-between">
                      <div className="min-w-0 flex-1">
                        <p className="text-foreground truncate text-sm font-medium">
                          {agent.description}
                        </p>
                        <p className="text-description mt-0.5 text-xs">ID: {agent.taskId}</p>
                      </div>
                      <Badge variant={statusVariant(agent.status)}>{agent.status}</Badge>
                    </div>
                    {agent.model && (
                      <p className="text-description text-xs">
                        Model: <span className="text-foreground">{agent.model}</span>
                      </p>
                    )}
                    {typeof agent.progress === "number" && (
                      <div className="space-y-1">
                        <div className="bg-secondary h-1.5 w-full rounded-full">
                          <div
                            className="bg-primary h-1.5 rounded-full transition-all"
                            style={{
                              width: `${Math.min(agent.progress, 100)}%`,
                            }}
                          />
                        </div>
                        <p className="text-description text-xs">{agent.progress}%</p>
                      </div>
                    )}
                    {agent.startedAt && (
                      <p className="text-description-muted text-xs">
                        Started {formatRelativeTime(agent.startedAt)}
                      </p>
                    )}
                    <div className="flex gap-2 pt-1">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setMessagingAgent(messagingAgent === agent.taskId ? null : agent.taskId)
                        }
                      >
                        <PaperAirplaneIcon className="h-3.5 w-3.5" />
                        Message
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => setKillTarget(agent.taskId)}
                      >
                        <XMarkIcon className="h-3.5 w-3.5" />
                        Kill
                      </Button>
                    </div>
                    {messagingAgent === agent.taskId && (
                      <MessageForm taskId={agent.taskId} onSent={fetchData} />
                    )}
                  </Card>
                ))}
              </div>
            ))}

          {/* Approvals */}
          {tab === "approvals" &&
            (approvals.length === 0 ? (
              <EmptyState
                icon={<ShieldExclamationIcon className="h-10 w-10" />}
                title="No Pending Approvals"
                description="All agent actions are approved. New requests will appear here."
              />
            ) : (
              <div className="space-y-3">
                {approvals.map((a) => (
                  <Card key={a.id} className="space-y-2">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-foreground text-sm font-medium">{a.actionType}</p>
                        <p className="text-description mt-0.5 text-xs">{a.resource}</p>
                      </div>
                      <span className="text-description-muted text-xs">
                        {formatRelativeTime(a.createdAt)}
                      </span>
                    </div>
                    {a.context && <p className="text-description text-xs">{a.context}</p>}
                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => handleResolve(a.id, "allow_once")}
                      >
                        <CheckCircleIcon className="h-3.5 w-3.5" />
                        Allow Once
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleResolve(a.id, "allow_always")}
                      >
                        Allow Always
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => handleResolve(a.id, "deny")}>
                        Deny
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => handleResolve(a.id, "deny_always")}
                      >
                        Deny Always
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
            ))}

          {/* History */}
          {tab === "history" &&
            (history.length === 0 ? (
              <EmptyState
                icon={<ClockIcon className="h-10 w-10" />}
                title="No Approval History"
                description="Past approval decisions will appear here."
              />
            ) : (
              <DataTable
                columns={[
                  { key: "actionType", label: "Action", sortable: true },
                  { key: "resource", label: "Resource", sortable: true },
                  {
                    key: "decision",
                    label: "Decision",
                    render: (_value: unknown, row: Record<string, unknown>) => (
                      <Badge variant={String(row.decision).includes("allow") ? "success" : "error"}>
                        {String(row.decision)}
                      </Badge>
                    ),
                  },
                  {
                    key: "resolvedAt",
                    label: "Timestamp",
                    sortable: true,
                    render: (_value: unknown, row: Record<string, unknown>) =>
                      formatRelativeTime(row.resolvedAt as string),
                  },
                ]}
                data={history as unknown as Record<string, unknown>[]}
              />
            ))}
        </>
      )}

      <ConfirmDialog
        open={killTarget !== null}
        onClose={() => setKillTarget(null)}
        onConfirm={() => killTarget && handleKill(killTarget)}
        title="Kill Agent"
        message="Are you sure you want to kill this agent? This action cannot be undone."
        confirmLabel="Kill"
        variant="danger"
      />
    </div>
  );
}
