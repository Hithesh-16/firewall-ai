import { useState, useEffect, useCallback } from "react";
import { apiClient } from "../../api/client";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { LoadingSpinner } from "../../components/ui/LoadingSpinner";
import { ErrorBanner } from "../../components/ui/ErrorBanner";
import { EmptyState } from "../../components/ui/EmptyState";
import { UnderlineTabs } from "../../components/ui/UnderlineTabs";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import {
  PlusIcon,
  PencilSquareIcon,
  TrashIcon,
  ArrowLeftIcon,
  DocumentTextIcon,
} from "@heroicons/react/24/outline";
import type { Memory } from "../../api/types";

const MEMORY_TYPES = [
  "all",
  "user",
  "feedback",
  "project",
  "reference",
] as const;

const TYPE_COLORS: Record<string, "info" | "success" | "warning" | "error"> = {
  user: "info",
  feedback: "success",
  project: "warning",
  reference: "error",
};

export function MemoryPage() {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeType, setActiveType] = useState("all");
  const [view, setView] = useState<"list" | "edit">("list");
  const [editingMemory, setEditingMemory] = useState<Memory | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Memory | null>(null);

  // Form state
  const [formName, setFormName] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formType, setFormType] = useState<Memory["type"]>("project");
  const [formBody, setFormBody] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchMemories = useCallback(async () => {
    try {
      setLoading(true);
      const res = await apiClient.get<{ memories: Memory[] }>("/api/memory");
      setMemories(res.memories ?? []);
      setError(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load memories");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMemories();
  }, [fetchMemories]);

  const filtered =
    activeType === "all"
      ? memories
      : memories.filter((m) => m.type === activeType);

  const openCreate = () => {
    setEditingMemory(null);
    setFormName("");
    setFormDesc("");
    setFormType("project");
    setFormBody("");
    setView("edit");
  };

  const openEdit = (m: Memory) => {
    setEditingMemory(m);
    setFormName(m.name);
    setFormDesc(m.description);
    setFormType(m.type);
    setFormBody(m.body);
    setView("edit");
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      await apiClient.post("/api/memory", {
        name: formName,
        description: formDesc,
        type: formType,
        body: formBody,
        ...(editingMemory ? { fileName: editingMemory.fileName } : {}),
      });
      setView("list");
      fetchMemories();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await apiClient.del(`/api/memory/${deleteTarget.fileName}`);
      setDeleteTarget(null);
      fetchMemories();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to delete");
    }
  };

  if (view === "edit") {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <button
          onClick={() => setView("list")}
          className="text-description hover:text-foreground mb-4 flex items-center gap-1 text-sm"
        >
          <ArrowLeftIcon className="h-4 w-4" /> Back to list
        </button>
        <h1 className="text-foreground mb-6 text-xl font-semibold">
          {editingMemory ? "Edit Memory" : "Create Memory"}
        </h1>
        <div className="space-y-4">
          <div>
            <label className="text-description mb-1 block text-sm">Name</label>
            <input
              value={formName}
              onChange={(e) => setFormName(e.target.value)}
              className="border-input-border bg-input text-input-foreground w-full rounded-lg border px-3 py-2"
              placeholder="Memory name"
            />
          </div>
          <div>
            <label className="text-description mb-1 block text-sm">
              Description
            </label>
            <input
              value={formDesc}
              onChange={(e) => setFormDesc(e.target.value)}
              className="border-input-border bg-input text-input-foreground w-full rounded-lg border px-3 py-2"
              placeholder="One-line description"
            />
          </div>
          <div>
            <label className="text-description mb-1 block text-sm">Type</label>
            <select
              value={formType}
              onChange={(e) => setFormType(e.target.value as Memory["type"])}
              className="border-input-border bg-input text-input-foreground w-full rounded-lg border px-3 py-2"
            >
              <option value="user">User</option>
              <option value="feedback">Feedback</option>
              <option value="project">Project</option>
              <option value="reference">Reference</option>
            </select>
          </div>
          <div>
            <label className="text-description mb-1 block text-sm">Body</label>
            <textarea
              value={formBody}
              onChange={(e) => setFormBody(e.target.value)}
              rows={12}
              className="border-input-border bg-input text-input-foreground w-full rounded-lg border px-3 py-2 font-mono text-sm"
              placeholder="Memory content..."
            />
          </div>
          <div className="flex gap-3">
            <Button
              variant="primary"
              onClick={handleSave}
              loading={saving}
              disabled={!formName.trim()}
            >
              Save
            </Button>
            <Button variant="secondary" onClick={() => setView("list")}>
              Cancel
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-foreground text-xl font-semibold">Memory</h1>
        <Button variant="primary" size="sm" onClick={openCreate}>
          <PlusIcon className="mr-1 h-4 w-4" /> Create
        </Button>
      </div>

      {error && (
        <ErrorBanner message={error} onDismiss={() => setError(null)} />
      )}

      <UnderlineTabs
        tabs={MEMORY_TYPES.map((t) => ({
          id: t,
          label: t.charAt(0).toUpperCase() + t.slice(1),
        }))}
        activeTab={activeType}
        onChange={setActiveType}
      />

      <div className="mt-4">
        {loading ? (
          <div className="flex justify-center py-12">
            <LoadingSpinner />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={<DocumentTextIcon className="h-12 w-12" />}
            title="No memories"
            description="Create persistent memories to help AI understand your context"
            actionLabel="Create Memory"
            onAction={openCreate}
          />
        ) : (
          <div className="space-y-3">
            {filtered.map((m) => (
              <Card
                key={m.fileName}
                className="flex items-start justify-between gap-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-foreground font-medium">
                      {m.name}
                    </span>
                    <Badge variant={TYPE_COLORS[m.type] ?? "info"}>
                      {m.type}
                    </Badge>
                  </div>
                  <p className="text-description mt-1 text-sm">
                    {m.description}
                  </p>
                  <p className="text-description-muted mt-1 line-clamp-2 text-xs">
                    {m.body}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    onClick={() => openEdit(m)}
                    className="text-description hover:bg-list-hover hover:text-foreground rounded p-1"
                  >
                    <PencilSquareIcon className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => setDeleteTarget(m)}
                    className="text-description hover:bg-list-hover hover:text-error rounded p-1"
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete Memory"
        message={`Delete "${deleteTarget?.name}"? This cannot be undone.`}
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
