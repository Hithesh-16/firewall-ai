/**
 * Plugins Page — manage installed plugins (enable/disable/view details).
 * Web-only route: /plugins
 */

import { useState, useEffect, useCallback } from "react";
import { useProxyApi } from "../../hooks/useProxyApi";

interface Plugin {
  id: string;
  name: string;
  version: string;
  description: string;
  enabled: boolean;
  source: string;
  installedAt: number;
}

export default function PluginsPage() {
  const api = useProxyApi();
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPlugins = useCallback(async () => {
    try {
      const data = await api.get<{ plugins: Plugin[] }>("/api/plugins");
      setPlugins(data.plugins ?? []);
    } catch {
      // Proxy may not be running
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    fetchPlugins();
  }, [fetchPlugins]);

  const handleToggle = useCallback(
    async (pluginId: string, enabled: boolean) => {
      try {
        const endpoint = enabled
          ? `/api/plugins/${pluginId}/disable`
          : `/api/plugins/${pluginId}/enable`;
        await api.post(endpoint, {});
        fetchPlugins();
      } catch {
        // ignore
      }
    },
    [api, fetchPlugins],
  );

  const enabledCount = plugins.filter((p) => p.enabled).length;

  return (
    <div className="mx-auto max-w-3xl p-4">
      <div className="mb-4">
        <h2 className="text-foreground text-lg font-semibold">Plugins</h2>
        <p className="text-description-muted text-xs">
          {enabledCount} enabled, {plugins.length} installed
        </p>
      </div>

      {loading ? (
        <div className="text-description-muted py-8 text-center text-sm">
          Loading plugins...
        </div>
      ) : plugins.length === 0 ? (
        <div className="text-description-muted py-8 text-center text-sm">
          No plugins installed. Plugins extend AI Firewall with custom scanners,
          commands, and integrations.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {plugins.map((plugin) => (
            <div
              key={plugin.id}
              className="border-border flex items-center gap-3 rounded border p-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-foreground text-sm font-medium">
                    {plugin.name}
                  </p>
                  <span className="text-description-muted text-2xs">
                    v{plugin.version}
                  </span>
                  <span
                    className={`text-2xs rounded px-1.5 py-0.5 font-semibold ${
                      plugin.enabled
                        ? "bg-success/10 text-success"
                        : "bg-secondary-background text-description-muted"
                    }`}
                  >
                    {plugin.enabled ? "enabled" : "disabled"}
                  </span>
                </div>
                <p className="text-description-muted text-2xs mt-0.5">
                  {plugin.description}
                </p>
              </div>
              <button
                onClick={() => handleToggle(plugin.id, plugin.enabled)}
                className={`rounded px-3 py-1 text-xs transition-colors ${
                  plugin.enabled
                    ? "border-border text-description hover:bg-list-hover border"
                    : "bg-primary text-primary-foreground hover:bg-primary-hover"
                }`}
              >
                {plugin.enabled ? "Disable" : "Enable"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
