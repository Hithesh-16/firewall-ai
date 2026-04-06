import { useState, useEffect, Fragment } from "react";
import { Listbox, Transition } from "@headlessui/react";
import { ChevronUpDownIcon, CheckIcon } from "@heroicons/react/24/outline";
import { cn } from "../../utils/cn";
import { useAppDispatch, useAppSelector } from "../../store/hooks";
import { setSelectedModel } from "../../store/slices/chatSlice";
import { apiClient } from "../../api/client";
import { formatTokens, formatCost } from "../../utils/format";
import type { Provider, Model } from "../../api/types";

interface ProviderWithModels {
  provider: Provider;
  models: Model[];
}

export function ModelPicker() {
  const dispatch = useAppDispatch();
  const selectedModel = useAppSelector((s) => s.chat.selectedModel);
  const [groups, setGroups] = useState<ProviderWithModels[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function fetchModels() {
      try {
        const providers = await apiClient.get<Provider[]>("/api/providers");
        const result: ProviderWithModels[] = [];

        for (const provider of providers) {
          if (!provider.enabled) continue;
          try {
            const models = await apiClient.get<Model[]>(
              `/api/providers/${provider.id}/models`,
            );
            if (models.length > 0) {
              result.push({
                provider,
                models: models.filter((m) => m.enabled),
              });
            }
          } catch {
            // skip providers with no models endpoint
          }
        }

        if (!cancelled) {
          setGroups(result);
        }
      } catch {
        // If providers endpoint fails, use fallback defaults
        if (!cancelled) {
          setGroups([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void fetchModels();
    return () => {
      cancelled = true;
    };
  }, []);

  // Flatten all models for the Listbox
  const allModels = groups.flatMap((g) => g.models);
  const selectedModelObj = allModels.find((m) => m.modelName === selectedModel);

  // Fallback display name
  const displayName = selectedModelObj?.displayName ?? selectedModel;

  function handleChange(modelName: string) {
    dispatch(setSelectedModel(modelName));
  }

  if (loading) {
    return (
      <div className="bg-secondary text-description-muted flex h-8 items-center rounded-lg px-3 text-xs">
        Loading models...
      </div>
    );
  }

  // If no models loaded, show a simple text input-style display
  if (allModels.length === 0) {
    return (
      <div className="bg-secondary text-foreground flex h-8 items-center rounded-lg px-3 text-xs">
        {selectedModel}
      </div>
    );
  }

  return (
    <Listbox value={selectedModel} onChange={handleChange}>
      <div className="relative">
        <Listbox.Button className="bg-secondary text-foreground hover:bg-secondary-hover flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs transition-colors">
          <span className="truncate">{displayName}</span>
          <ChevronUpDownIcon className="text-description-muted h-3.5 w-3.5" />
        </Listbox.Button>

        <Transition
          as={Fragment}
          leave="transition ease-in duration-100"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <Listbox.Options className="border-border bg-editor thin-scrollbar absolute bottom-full left-0 z-50 mb-1 max-h-72 w-72 overflow-auto rounded-lg border py-1 shadow-xl focus:outline-none">
            {groups.map((group) => (
              <div key={group.provider.id}>
                <div className="text-description-muted px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider">
                  {group.provider.name}
                </div>
                {group.models.map((model) => (
                  <Listbox.Option
                    key={model.id}
                    value={model.modelName}
                    className={({ active }) =>
                      cn(
                        "flex cursor-pointer items-center justify-between px-3 py-2",
                        active && "bg-list-hover",
                      )
                    }
                  >
                    {({ selected }) => (
                      <>
                        <div className="flex flex-col">
                          <span
                            className={cn(
                              "text-sm",
                              selected
                                ? "text-foreground font-medium"
                                : "text-foreground",
                            )}
                          >
                            {model.displayName}
                          </span>
                          <span className="text-description-muted text-[11px]">
                            {formatTokens(model.maxContextTokens)} ctx
                            {model.inputCostPer1k > 0 && (
                              <>
                                {" "}
                                {"\u00B7"} {formatCost(model.inputCostPer1k)}/1k
                                in
                              </>
                            )}
                          </span>
                        </div>
                        {selected && (
                          <CheckIcon className="text-primary h-4 w-4 shrink-0" />
                        )}
                      </>
                    )}
                  </Listbox.Option>
                ))}
              </div>
            ))}
          </Listbox.Options>
        </Transition>
      </div>
    </Listbox>
  );
}
