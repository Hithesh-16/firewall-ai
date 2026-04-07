import { ServerIcon } from "@heroicons/react/24/outline";
import type { Provider } from "../../../api/types";
import { Card } from "../../../components/ui/Card";
import { Badge } from "../../../components/ui/Badge";
import { EmptyState } from "../../../components/ui/EmptyState";

export function ProvidersTab({ providers }: { providers: Provider[] }) {
  if (providers.length === 0) {
    return (
      <EmptyState
        icon={<ServerIcon className="h-12 w-12" />}
        title="No providers configured"
        description="Add an AI provider in the proxy configuration to get started."
      />
    );
  }

  return (
    <div className="space-y-3">
      {providers.map((p) => (
        <Card key={p.id} className="flex items-center justify-between">
          <div>
            <p className="text-foreground font-medium">{p.name}</p>
            <p className="text-description text-xs">{p.baseUrl || "Default endpoint"}</p>
          </div>
          <Badge variant={p.enabled ? "success" : "default"}>
            {p.enabled ? "Enabled" : "Disabled"}
          </Badge>
        </Card>
      ))}
    </div>
  );
}
