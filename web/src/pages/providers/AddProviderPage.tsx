import { useNavigate } from "react-router-dom";
import { ArrowLeftIcon } from "@heroicons/react/24/outline";
import { apiClient } from "../../api/client";
import { ENDPOINTS } from "../../api/endpoints";
import { ROUTES } from "../../utils/routes";
import { useAppDispatch } from "../../store/hooks";
import { showToast } from "../../store/slices/uiSlice";
import { UnifiedModelForm } from "../../components/shared/UnifiedModelForm";

export function AddProviderPage() {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();

  async function handleSave(values: any) {
    try {
      // 1. Create the provider (Org-wide)
      const provider = await apiClient.post<{ id: number }>(ENDPOINTS.providers.root, {
        kind: values.providerSlug,
        name: values.name || values.providerSlug,
        apiKey: values.apiKey,
        baseUrl: values.apiBase || undefined,
      });

      // 2. Add the model to this provider
      await apiClient.post(ENDPOINTS.providers.models(String(provider.id)), {
        modelName: values.modelSlug,
        displayName: values.name || values.modelSlug,
        inputCostPer1k: 0,
        outputCostPer1k: 0,
      });

      // 3. Also add to personal models so it shows up in CLI/IDE immediately
      await apiClient.post(ENDPOINTS.me.modelsAdd, {
        providerSlug: values.providerSlug,
        modelSlug: values.modelSlug,
        displayName: values.name || values.modelSlug,
        apiKey: values.apiKey,
        apiBase: values.apiBase,
        roles: ["chat", "edit", "apply"],
      });

      dispatch(
        showToast({
          id: `prov-${Date.now()}`,
          type: "success",
          message: `${values.name || values.modelSlug} added to organization and granted to you`,
        }),
      );
      navigate(ROUTES.ORG);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to add provider";
      dispatch(
        showToast({
          id: `prov-err-${Date.now()}`,
          type: "error",
          message: msg,
        }),
      );
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate(ROUTES.ORG)}
          className="text-description hover:bg-list-hover hover:text-foreground rounded p-1"
          aria-label="Go back"
        >
          <ArrowLeftIcon className="h-5 w-5" />
        </button>
        <div>
          <h1 className="text-foreground text-2xl font-bold">Add Organization Provider</h1>
          <p className="text-description text-sm">
            Configure a new AI provider and its first model for your organization.
          </p>
        </div>
      </div>

      <UnifiedModelForm
        title="Provider Configuration"
        submitLabel="Add to Organization"
        onCancel={() => navigate(ROUTES.ORG)}
        onSave={handleSave}
      />
    </div>
  );
}
