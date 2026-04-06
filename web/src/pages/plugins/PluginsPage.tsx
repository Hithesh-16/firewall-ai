import { useState, useEffect } from "react";
import { apiClient } from "../../api/client";
import { Card } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { Toggle } from "../../components/ui/Toggle";
import { LoadingSpinner } from "../../components/ui/LoadingSpinner";
import { ErrorBanner } from "../../components/ui/ErrorBanner";
import { EmptyState } from "../../components/ui/EmptyState";
import { PuzzlePieceIcon } from "@heroicons/react/24/outline";

interface Plugin {
  id: string;
  name: string;
  version: string;
  description: string;
  enabled: boolean;
}

export function PluginsPage() {
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiClient.get<{ plugins: Plugin[] }>("/api/plugins");
        setPlugins(res.plugins ?? []);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Failed to load plugins");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleToggle = async (plugin: Plugin) => {
    try {
      setToggling(plugin.id);
      const endpoint = plugin.enabled
        ? `/api/plugins/${plugin.id}/disable`
        : `/api/plugins/${plugin.id}/enable`;
      await apiClient.post(endpoint);
      setPlugins((prev) =>
        prev.map((p) =>
          p.id === plugin.id ? { ...p, enabled: !p.enabled } : p,
        ),
      );
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to toggle plugin");
    } finally {
      setToggling(null);
    }
  };

  const enabledCount = plugins.filter((p) => p.enabled).length;

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-foreground text-xl font-semibold">
          Plugins{" "}
          <span className="text-description text-sm font-normal">
            ({enabledCount}/{plugins.length} enabled)
          </span>
        </h1>
      </div>

      {error && (
        <ErrorBanner message={error} onDismiss={() => setError(null)} />
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <LoadingSpinner />
        </div>
      ) : plugins.length === 0 ? (
        <EmptyState
          icon={<PuzzlePieceIcon className="h-12 w-12" />}
          title="No plugins installed"
          description="Plugins extend AI Firewall with additional scanners, adapters, and features"
        />
      ) : (
        <div className="space-y-3">
          {plugins.map((p) => (
            <Card
              key={p.id}
              className="flex items-center justify-between gap-4"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-foreground font-medium">{p.name}</span>
                  <span className="text-description-muted text-xs">
                    v{p.version}
                  </span>
                  <Badge variant={p.enabled ? "success" : "default"}>
                    {p.enabled ? "Enabled" : "Disabled"}
                  </Badge>
                </div>
                <p className="text-description mt-1 text-sm">{p.description}</p>
              </div>
              <Toggle
                enabled={p.enabled}
                onChange={() => handleToggle(p)}
                label={toggling === p.id ? "..." : undefined}
              />
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
