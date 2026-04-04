/**
 * MemoryIndex — lists all memories with type filtering and CRUD actions.
 */

import { useState, useCallback } from "react";

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

interface MemoryIndexProps {
  memories: MemoryEntry[];
  onSelect: (memory: MemoryEntry) => void;
  onDelete: (fileName: string) => void;
  onCreate: () => void;
}

const TYPE_BADGES: Record<string, { bg: string; text: string }> = {
  user: { bg: "bg-info/10", text: "text-info" },
  feedback: { bg: "bg-warning/10", text: "text-warning" },
  project: { bg: "bg-success/10", text: "text-success" },
  reference: { bg: "bg-primary/10", text: "text-primary-foreground" },
};

type FilterType = "all" | "user" | "feedback" | "project" | "reference";

export function MemoryIndex({
  memories,
  onSelect,
  onDelete,
  onCreate,
}: MemoryIndexProps) {
  const [filter, setFilter] = useState<FilterType>("all");

  const filtered =
    filter === "all"
      ? memories
      : memories.filter((m) => m.frontmatter.type === filter);

  const formatDate = useCallback((ts: number) => {
    return new Date(ts).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }, []);

  return (
    <div>
      {/* Header */}
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-foreground text-sm font-semibold">
          Memories ({filtered.length})
        </h3>
        <button
          onClick={onCreate}
          className="bg-primary text-primary-foreground hover:bg-primary-hover rounded px-3 py-1 text-xs transition-colors"
        >
          + New Memory
        </button>
      </div>

      {/* Type filter tabs */}
      <div className="border-border mb-3 flex gap-1 border-b pb-2">
        {(["all", "user", "feedback", "project", "reference"] as const).map(
          (t) => (
            <button
              key={t}
              onClick={() => setFilter(t)}
              className={`text-2xs rounded px-2 py-1 capitalize transition-colors ${
                filter === t
                  ? "bg-list-active text-list-active-foreground"
                  : "text-description hover:bg-list-hover"
              }`}
            >
              {t}
            </button>
          ),
        )}
      </div>

      {/* Memory list */}
      {filtered.length === 0 ? (
        <div className="text-description-muted py-8 text-center text-sm">
          {filter === "all"
            ? "No memories yet. They'll be created as you work."
            : `No ${filter} memories.`}
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {filtered.map((memory) => {
            const badge =
              TYPE_BADGES[memory.frontmatter.type] ?? TYPE_BADGES.user;
            return (
              <div
                key={memory.fileName}
                className="border-border hover:bg-list-hover group flex cursor-pointer items-center gap-2 rounded border p-2 transition-colors"
                onClick={() => onSelect(memory)}
              >
                <span
                  className={`text-2xs rounded px-1.5 py-0.5 ${badge.bg} ${badge.text} font-semibold capitalize`}
                >
                  {memory.frontmatter.type}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-foreground truncate text-sm">
                    {memory.frontmatter.name}
                  </p>
                  <p className="text-2xs text-description-muted truncate">
                    {memory.frontmatter.description}
                  </p>
                </div>
                <span className="text-2xs text-description-muted whitespace-nowrap">
                  {formatDate(memory.updatedAt)}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(memory.fileName);
                  }}
                  className="text-2xs text-error px-1 opacity-0 transition-opacity group-hover:opacity-100"
                  title="Delete memory"
                >
                  {"\u2715"}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
