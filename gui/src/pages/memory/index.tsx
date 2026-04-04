/**
 * Memory Page — browse and manage persistent memories.
 * Web-only route: /memory
 */

import { useState, useEffect, useCallback } from "react";
import { MemoryIndex } from "../../components/memory/MemoryIndex";
import { MemoryEditor } from "../../components/memory/MemoryEditor";
import { useProxyApi } from "../../hooks/useProxyApi";

interface MemoryEntry {
  fileName: string;
  frontmatter: {
    name: string;
    description: string;
    type: "user" | "feedback" | "project" | "reference";
  };
  body: string;
  updatedAt: number;
  sizeBytes: number;
}

type ViewMode = "list" | "edit" | "create";

export default function MemoryPage() {
  const api = useProxyApi();
  const [memories, setMemories] = useState<MemoryEntry[]>([]);
  const [selected, setSelected] = useState<MemoryEntry | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [loading, setLoading] = useState(true);

  const fetchMemories = useCallback(async () => {
    try {
      const data = await api.get<{ memories: MemoryEntry[] }>("/api/memory");
      setMemories(data.memories);
    } catch {
      // Proxy may not be running
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    fetchMemories();
  }, [fetchMemories]);

  const handleSelect = useCallback((memory: MemoryEntry) => {
    setSelected(memory);
    setViewMode("edit");
  }, []);

  const handleCreate = useCallback(() => {
    setSelected(null);
    setViewMode("create");
  }, []);

  const handleCancel = useCallback(() => {
    setSelected(null);
    setViewMode("list");
  }, []);

  const handleSave = useCallback(
    async (data: {
      name: string;
      description: string;
      type: string;
      body: string;
      fileName?: string;
    }) => {
      try {
        await api.post("/api/memory", data);
        setViewMode("list");
        setSelected(null);
        fetchMemories();
      } catch {
        // Show error
      }
    },
    [api, fetchMemories],
  );

  const handleDelete = useCallback(
    async (fileName: string) => {
      try {
        await api.del(`/api/memory/${fileName}`);
        fetchMemories();
      } catch {
        // ignore
      }
    },
    [api, fetchMemories],
  );

  return (
    <div className="mx-auto max-w-3xl p-4">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-foreground text-lg font-semibold">Memory</h2>
          <p className="text-description-muted text-xs">
            Persistent knowledge across sessions
          </p>
        </div>
        {viewMode !== "list" && (
          <button
            onClick={handleCancel}
            className="border-border text-description hover:bg-list-hover rounded border px-3 py-1 text-xs transition-colors"
          >
            {"\u2190"} Back to list
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-description-muted py-8 text-center text-sm">
          Loading memories...
        </div>
      ) : viewMode === "list" ? (
        <MemoryIndex
          memories={memories}
          onSelect={handleSelect}
          onDelete={handleDelete}
          onCreate={handleCreate}
        />
      ) : (
        <MemoryEditor
          memory={viewMode === "edit" ? selected : null}
          onSave={handleSave}
          onCancel={handleCancel}
        />
      )}
    </div>
  );
}
