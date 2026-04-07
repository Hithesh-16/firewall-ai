import { Badge } from "../../components/ui/Badge";
import type { CatalogProvider } from "../../data/providers";

export interface ProviderCardProps {
  provider: CatalogProvider;
  onClick: () => void;
}

export function ProviderCard({ provider, onClick }: ProviderCardProps) {
  return (
    <button
      onClick={onClick}
      className="border-border bg-editor hover:border-border-focus hover:bg-list-hover flex items-start gap-3 rounded-xl border p-4 text-left transition-colors"
    >
      <img
        src={`/logos/${provider.icon}`}
        alt=""
        className="h-8 w-8 shrink-0 rounded-lg object-contain"
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = "none";
        }}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-foreground text-sm font-semibold">{provider.name}</p>
          {provider.isLocal && <Badge variant="success">Local</Badge>}
        </div>
        <p className="text-description mt-0.5 text-xs">{provider.description}</p>
        <p className="text-description-muted mt-1 text-xs">
          {provider.models.length} model
          {provider.models.length !== 1 ? "s" : ""}
        </p>
      </div>
    </button>
  );
}
