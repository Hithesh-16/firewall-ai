import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ServerIcon,
  TrashIcon,
  PlusIcon,
  ChevronDownIcon,
  ChevronRightIcon,
} from "@heroicons/react/24/outline";
import { apiClient } from "../../../api/client";
import { useAppDispatch } from "../../../store/hooks";
import { ROUTES } from "../../../utils/routes";
import { showToast } from "../../../store/slices/uiSlice";
import type { Provider } from "../../../api/types";
import { Card } from "../../../components/ui/Card";
import { Button } from "../../../components/ui/Button";
import { Badge } from "../../../components/ui/Badge";
import { LoadingSpinner } from "../../../components/ui/LoadingSpinner";
import { ErrorBanner } from "../../../components/ui/ErrorBanner";
import { EmptyState } from "../../../components/ui/EmptyState";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";

interface ProviderModel {
  id: string;
  modelName: string;
  displayName: string;
  inputCostPer1k: number;
  outputCostPer1k: number;
}

interface ProviderWithModels extends Provider {
  models?: ProviderModel[];
}

export function ProvidersTab() {
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [providers, setProviders] = useState<ProviderWithModels[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProviderWithModels | null>(null);

  useEffect(() => {
    loadProviders();
  }, []);

  async function loadProviders() {
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.get<ProviderWithModels[]>("/api/providers");
      setProviders(data);
    } catch (err: unknown) {
      if (err instanceof Error) setError(err.message);
      else setError("Failed to load providers");
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(provider: ProviderWithModels) {
    try {
      await apiClient.del(`/api/providers/${provider.id}`);
      setProviders((prev) => prev.filter((p) => p.id !== provider.id));
      dispatch(
        showToast({
          id: `prov-del-${Date.now()}`,
          type: "success",
          message: `${provider.name} removed`,
        }),
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to delete provider";
      dispatch(
        showToast({
          id: `prov-err-${Date.now()}`,
          type: "error",
          message: msg,
        }),
      );
    }
    setDeleteTarget(null);
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <LoadingSpinner size="lg" />
      </div>
    );
  }

  if (error) return <ErrorBanner message={error} />;

  if (providers.length === 0) {
    return (
      <div className="space-y-4">
        <EmptyState
          icon={<ServerIcon className="h-12 w-12" />}
          title="No providers"
          description="Configure AI providers to start routing requests."
        />
        <div className="flex justify-center">
          <Button onClick={() => navigate(ROUTES.ADD_PROVIDER)}>
            <PlusIcon className="h-4 w-4" />
            Add Provider
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="mb-3 flex justify-end">
        <Button size="sm" onClick={() => navigate(ROUTES.ADD_PROVIDER)}>
          <PlusIcon className="h-4 w-4" />
          Add Provider
        </Button>
      </div>
      <div className="space-y-3">
        {providers.map((p) => (
          <Card key={p.id} padding={false}>
            <div className="flex items-center justify-between px-4 py-3">
              <button
                className="flex flex-1 items-center gap-3 text-left"
                onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}
              >
                {expandedId === p.id ? (
                  <ChevronDownIcon className="text-description h-4 w-4" />
                ) : (
                  <ChevronRightIcon className="text-description h-4 w-4" />
                )}
                <div>
                  <p className="text-foreground text-sm font-medium">{p.name}</p>
                  <p className="text-description text-xs">{p.baseUrl || "Default endpoint"}</p>
                </div>
              </button>
              <div className="flex items-center gap-2">
                <Badge variant={p.enabled ? "success" : "default"}>
                  {p.enabled ? "Enabled" : "Disabled"}
                </Badge>
                {p.models && (
                  <span className="text-description text-xs">
                    {p.models.length} model{p.models.length !== 1 ? "s" : ""}
                  </span>
                )}
                <Button
                  variant="icon"
                  onClick={() => setDeleteTarget(p)}
                  aria-label={`Delete ${p.name}`}
                >
                  <TrashIcon className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {expandedId === p.id && p.models && p.models.length > 0 && (
              <div className="border-border border-t px-4 py-3">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-description-muted text-left">
                      <th className="pb-1 font-medium">Model</th>
                      <th className="pb-1 font-medium">Input $/1K</th>
                      <th className="pb-1 font-medium">Output $/1K</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.models.map((m) => (
                      <tr key={m.id} className="text-foreground">
                        <td className="py-0.5">{m.displayName || m.modelName}</td>
                        <td className="py-0.5">${m.inputCostPer1k.toFixed(4)}</td>
                        <td className="py-0.5">${m.outputCostPer1k.toFixed(4)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        ))}
      </div>

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={() => deleteTarget && handleDelete(deleteTarget)}
        title="Remove Provider"
        message={`Are you sure you want to remove ${deleteTarget?.name}? This cannot be undone.`}
        confirmLabel="Remove"
        variant="danger"
      />
    </>
  );
}
