import { useState, useEffect } from "react";
import { apiClient } from "../../api/client";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { LoadingSpinner } from "../../components/ui/LoadingSpinner";
import { ErrorBanner } from "../../components/ui/ErrorBanner";
import { EmptyState } from "../../components/ui/EmptyState";
import { SearchInput } from "../../components/ui/SearchInput";
import { CommandLineIcon, PlayIcon } from "@heroicons/react/24/outline";

interface Command {
  name: string;
  aliases?: string[];
  description: string;
  type: "action" | "local";
  source: string;
}

export function CommandsPage() {
  const [commands, setCommands] = useState<Command[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [executing, setExecuting] = useState<string | null>(null);
  const [execInput, setExecInput] = useState("");
  const [execResult, setExecResult] = useState<{
    output: string;
    success: boolean;
  } | null>(null);
  const [execLoading, setExecLoading] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiClient.get<{ commands: Command[] }>(
          "/api/commands",
        );
        setCommands(res.commands ?? []);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Failed to load commands");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = commands.filter(
    (c) =>
      !search ||
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.description.toLowerCase().includes(search.toLowerCase()),
  );

  const handleExecute = async () => {
    try {
      setExecLoading(true);
      setExecResult(null);
      const res = await apiClient.post<{
        result?: { output: string; success: boolean };
        prompt?: string;
      }>("/api/commands/execute", { input: execInput });
      setExecResult(
        res.result ?? {
          output: res.prompt ?? "Command executed",
          success: true,
        },
      );
    } catch (e: unknown) {
      setExecResult({
        output: e instanceof Error ? e.message : "Failed",
        success: false,
      });
    } finally {
      setExecLoading(false);
    }
  };

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-foreground text-xl font-semibold">
          Commands{" "}
          <span className="text-description text-sm font-normal">
            ({commands.length})
          </span>
        </h1>
        <SearchInput
          placeholder="Search commands..."
          value={search}
          onChange={setSearch}
          className="w-64"
        />
      </div>

      {error && (
        <ErrorBanner message={error} onDismiss={() => setError(null)} />
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <LoadingSpinner />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<CommandLineIcon className="h-12 w-12" />}
          title="No commands found"
          description="Built-in slash commands for diagnostics, scanning, and management"
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((c) => (
            <Card key={c.name}>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-foreground font-mono font-medium">
                      /{c.name}
                    </span>
                    <Badge variant={c.type === "action" ? "info" : "success"}>
                      {c.type}
                    </Badge>
                    {c.aliases?.map((a) => (
                      <span key={a} className="text-description-muted text-xs">
                        /{a}
                      </span>
                    ))}
                  </div>
                  <p className="text-description mt-1 text-sm">
                    {c.description}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setExecuting(executing === c.name ? null : c.name);
                    setExecInput(`/${c.name}`);
                    setExecResult(null);
                  }}
                >
                  <PlayIcon className="mr-1 h-3.5 w-3.5" /> Execute
                </Button>
              </div>
              {executing === c.name && (
                <div className="border-border mt-3 border-t pt-3">
                  <div className="flex gap-2">
                    <input
                      value={execInput}
                      onChange={(e) => setExecInput(e.target.value)}
                      className="border-input-border bg-input text-input-foreground flex-1 rounded border px-3 py-1.5 font-mono text-sm"
                    />
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={handleExecute}
                      loading={execLoading}
                    >
                      Run
                    </Button>
                  </div>
                  {execResult && (
                    <pre
                      className={`mt-2 max-h-64 overflow-auto rounded p-3 text-xs ${execResult.success ? "bg-editor text-editor-foreground" : "bg-error/10 text-error"}`}
                    >
                      {execResult.output}
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
