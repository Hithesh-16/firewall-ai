/**
 * MemoryEditor — view and edit a single memory file.
 * Shows frontmatter fields + markdown body editor.
 */

import { useState, useCallback } from "react";

interface MemoryFrontmatter {
  name: string;
  description: string;
  type: "user" | "feedback" | "project" | "reference";
}

interface MemoryEntry {
  fileName: string;
  frontmatter: MemoryFrontmatter;
  body: string;
  updatedAt: number;
  sizeBytes: number;
}

interface MemoryEditorProps {
  memory: MemoryEntry | null;
  onSave: (data: {
    name: string;
    description: string;
    type: string;
    body: string;
    fileName?: string;
  }) => void;
  onCancel: () => void;
}

const MEMORY_TYPES = [
  { value: "user", label: "User", description: "Role, goals, preferences" },
  {
    value: "feedback",
    label: "Feedback",
    description: "Corrections and confirmations",
  },
  {
    value: "project",
    label: "Project",
    description: "Goals, deadlines, initiatives",
  },
  {
    value: "reference",
    label: "Reference",
    description: "External system pointers",
  },
] as const;

export function MemoryEditor({ memory, onSave, onCancel }: MemoryEditorProps) {
  const [name, setName] = useState(memory?.frontmatter.name ?? "");
  const [description, setDescription] = useState(
    memory?.frontmatter.description ?? "",
  );
  const [type, setType] = useState<string>(memory?.frontmatter.type ?? "user");
  const [body, setBody] = useState(memory?.body ?? "");

  const handleSave = useCallback(() => {
    if (!name.trim() || !description.trim() || !body.trim()) return;
    onSave({
      name: name.trim(),
      description: description.trim(),
      type,
      body: body.trim(),
      fileName: memory?.fileName,
    });
  }, [name, description, type, body, memory?.fileName, onSave]);

  const isValid = name.trim() && description.trim() && body.trim();

  return (
    <div className="bg-editor border-border max-w-2xl rounded-lg border p-4">
      <h3 className="text-foreground mb-3 text-sm font-semibold">
        {memory ? "Edit Memory" : "New Memory"}
      </h3>

      {/* Name */}
      <div className="mb-3">
        <label className="text-2xs text-description-muted mb-1 block uppercase tracking-wide">
          Name
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Short descriptive name"
          className="bg-input text-input-foreground placeholder:text-input-placeholder border-border focus:border-border-focus w-full rounded border px-3 py-1.5 text-sm focus:outline-none"
        />
      </div>

      {/* Description */}
      <div className="mb-3">
        <label className="text-2xs text-description-muted mb-1 block uppercase tracking-wide">
          Description (used for relevance matching)
        </label>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="One-line description of when this memory is useful"
          className="bg-input text-input-foreground placeholder:text-input-placeholder border-border focus:border-border-focus w-full rounded border px-3 py-1.5 text-sm focus:outline-none"
        />
      </div>

      {/* Type */}
      <div className="mb-3">
        <label className="text-2xs text-description-muted mb-1 block uppercase tracking-wide">
          Type
        </label>
        <div className="flex flex-wrap gap-2">
          {MEMORY_TYPES.map((mt) => (
            <button
              key={mt.value}
              onClick={() => setType(mt.value)}
              className={`rounded border px-3 py-1.5 text-xs transition-colors ${
                type === mt.value
                  ? "bg-primary/20 border-primary/40 text-primary-foreground font-semibold"
                  : "border-border text-description hover:bg-list-hover"
              }`}
              title={mt.description}
            >
              {mt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Body */}
      <div className="mb-4">
        <label className="text-2xs text-description-muted mb-1 block uppercase tracking-wide">
          Content
        </label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={8}
          placeholder="Memory content (markdown supported)"
          className="bg-input text-input-foreground placeholder:text-input-placeholder border-border focus:border-border-focus w-full resize-y rounded border px-3 py-2 font-mono text-sm focus:outline-none"
        />
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-2">
        <button
          onClick={onCancel}
          className="border-border text-description hover:bg-list-hover rounded border px-3 py-1.5 text-xs transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={!isValid}
          className={`rounded px-4 py-1.5 text-xs font-semibold transition-colors ${
            isValid
              ? "bg-primary text-primary-foreground hover:bg-primary-hover"
              : "bg-primary/30 text-primary-foreground/50 cursor-not-allowed"
          }`}
        >
          Save Memory
        </button>
      </div>
    </div>
  );
}
