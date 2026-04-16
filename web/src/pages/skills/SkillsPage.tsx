import { useState, useEffect } from "react";
import { apiClient } from "../../api/client";
import { ENDPOINTS } from "../../api/endpoints";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { LoadingSpinner } from "../../components/ui/LoadingSpinner";
import { ErrorBanner } from "../../components/ui/ErrorBanner";
import { EmptyState } from "../../components/ui/EmptyState";
import { UnderlineTabs } from "../../components/ui/UnderlineTabs";
import { SearchInput } from "../../components/ui/SearchInput";
import { BoltIcon, PlayIcon } from "@heroicons/react/24/outline";

interface Skill {
  name: string;
  description: string;
  source: "bundled" | "project";
  tags?: string[];
  trigger?: string;
}

export function SkillsPage() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [invoking, setInvoking] = useState<string | null>(null);
  const [invokeArgs, setInvokeArgs] = useState("");
  const [invokeResult, setInvokeResult] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiClient.get<{ skills: Skill[] }>(ENDPOINTS.skills.list);
        setSkills(res.skills ?? []);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Failed to load skills");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = skills
    .filter((s) => filter === "all" || s.source === filter)
    .filter(
      (s) =>
        !search ||
        s.name.toLowerCase().includes(search.toLowerCase()) ||
        s.description.toLowerCase().includes(search.toLowerCase()),
    );

  const handleInvoke = async (name: string) => {
    try {
      setInvokeResult(null);
      const res = await apiClient.post<{ prompt: string }>(ENDPOINTS.skills.invoke, {
        name,
        args: invokeArgs,
      });
      setInvokeResult(res.prompt ?? "Skill invoked successfully");
    } catch (e: unknown) {
      setInvokeResult(`Error: ${e instanceof Error ? e.message : "Failed"}`);
    }
  };

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-foreground text-xl font-semibold">
          Skills <span className="text-description text-sm font-normal">({skills.length})</span>
        </h1>
      </div>

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <UnderlineTabs
          tabs={[
            { id: "all", label: "All" },
            { id: "bundled", label: "Bundled" },
            { id: "project", label: "Project" },
          ]}
          activeTab={filter}
          onChange={setFilter}
        />
        <SearchInput
          placeholder="Search skills..."
          value={search}
          onChange={setSearch}
          className="sm:ml-auto sm:w-64"
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <LoadingSpinner />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<BoltIcon className="h-12 w-12" />}
          title="No skills found"
          description="Skills extend AI capabilities with specialized prompts"
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((s) => (
            <Card key={s.name}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-foreground font-mono font-medium">/{s.name}</span>
                    <Badge variant={s.source === "bundled" ? "info" : "success"}>{s.source}</Badge>
                  </div>
                  <p className="text-description mt-1 text-sm">{s.description}</p>
                  {s.tags && s.tags.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {s.tags.map((t) => (
                        <span
                          key={t}
                          className="bg-secondary text-secondary-foreground rounded px-2 py-0.5 text-xs"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setInvoking(invoking === s.name ? null : s.name)}
                >
                  <PlayIcon className="mr-1 h-3.5 w-3.5" /> Invoke
                </Button>
              </div>
              {invoking === s.name && (
                <div className="border-border mt-3 border-t pt-3">
                  <div className="flex gap-2">
                    <input
                      value={invokeArgs}
                      onChange={(e) => setInvokeArgs(e.target.value)}
                      placeholder="Arguments (optional)"
                      className="border-input-border bg-input text-input-foreground flex-1 rounded border px-3 py-1.5 text-sm"
                    />
                    <Button variant="primary" size="sm" onClick={() => handleInvoke(s.name)}>
                      Run
                    </Button>
                  </div>
                  {invokeResult && (
                    <pre className="bg-editor text-editor-foreground mt-2 max-h-48 overflow-auto rounded p-3 text-xs">
                      {invokeResult}
                    </pre>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
