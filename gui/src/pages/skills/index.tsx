/**
 * Skills Page — browse and invoke available skills.
 * Web-only route: /skills
 */

import { useState, useEffect, useCallback } from "react";
import { useProxyApi } from "../../hooks/useProxyApi";

interface Skill {
  name: string;
  description: string;
  source: "bundled" | "project" | "workspace" | "plugin";
  tags: string[];
}

export default function SkillsPage() {
  const api = useProxyApi();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "bundled" | "project">("all");

  const fetchSkills = useCallback(async () => {
    try {
      const data = await api.get<{ skills: Skill[] }>("/api/skills");
      setSkills(data.skills ?? []);
    } catch {
      // Proxy may not be running
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    fetchSkills();
  }, [fetchSkills]);

  const filtered =
    filter === "all" ? skills : skills.filter((s) => s.source === filter);

  return (
    <div className="mx-auto max-w-3xl p-4">
      <div className="mb-4">
        <h2 className="text-foreground text-lg font-semibold">Skills</h2>
        <p className="text-description-muted text-xs">
          {skills.length} skills available
        </p>
      </div>

      {/* Filter tabs */}
      <div className="border-border mb-4 flex gap-1 border-b pb-2">
        {(["all", "bundled", "project"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded px-3 py-1 text-xs capitalize transition-colors ${
              filter === f
                ? "bg-list-active text-list-active-foreground"
                : "text-description hover:bg-list-hover"
            }`}
          >
            {f}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-description-muted py-8 text-center text-sm">
          Loading skills...
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-description-muted py-8 text-center text-sm">
          {filter === "all"
            ? "No skills available. Add SKILL.md files to your project or install plugins with skills."
            : `No ${filter} skills found.`}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {filtered.map((skill) => (
            <div
              key={skill.name}
              className="border-border hover:bg-list-hover rounded border p-3 transition-colors"
            >
              <div className="flex items-center gap-2">
                <p className="text-foreground text-sm font-medium">
                  /{skill.name}
                </p>
                <span
                  className={`text-2xs rounded px-1.5 py-0.5 font-semibold ${
                    skill.source === "bundled"
                      ? "bg-info/10 text-info"
                      : "bg-success/10 text-success"
                  }`}
                >
                  {skill.source}
                </span>
              </div>
              <p className="text-description-muted text-2xs mt-1">
                {skill.description}
              </p>
              {skill.tags.length > 0 && (
                <div className="mt-1.5 flex gap-1">
                  {skill.tags.map((tag) => (
                    <span
                      key={tag}
                      className="bg-secondary-background text-description-muted text-2xs rounded px-1.5 py-0.5"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
