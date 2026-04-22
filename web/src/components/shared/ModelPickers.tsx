import { Listbox, Transition } from "@headlessui/react";
import { CheckIcon, ChevronUpDownIcon, MagnifyingGlassIcon } from "@heroicons/react/24/outline";
import { Fragment, useState } from "react";

import {
  OTHER_PROVIDERS,
  POPULAR_PROVIDERS,
  type CatalogueModel,
  type CatalogueProvider,
} from "../../data/providerCatalogue";

/**
 * Theme-aware provider + model pickers used by:
 *   - /settings/models (self-serve add)
 *   - Org Settings > Model Access (admin assign)
 *
 * Built on Headless UI Listbox (the same primitive ConfirmDialog +
 * SidebarOrgSwitcher use) and styled with the design-system Tailwind
 * tokens — bg-input / text-input-foreground / border-border / etc. —
 * so they work in every editor theme.
 *
 * Keeping both pickers co-located means a change to the look of the
 * "Add a model" UX updates admin and self-serve surfaces at once, no
 * drift.
 */

// ─── ProviderPicker ───────────────────────────────────────────────────────

interface ProviderPickerProps {
  selected: CatalogueProvider;
  onSelect: (p: CatalogueProvider) => void;
  disabled?: boolean;
}

export function ProviderPicker({ selected, onSelect, disabled }: ProviderPickerProps) {
  const [query, setQuery] = useState("");
  const filter = (list: CatalogueProvider[]) => {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (p) => p.title.toLowerCase().includes(q) || p.slug.toLowerCase().includes(q),
    );
  };
  const popular = filter(POPULAR_PROVIDERS);
  const other = filter(OTHER_PROVIDERS);

  return (
    <Listbox value={selected} onChange={onSelect} disabled={disabled}>
      <div className="relative">
        <Listbox.Button className="border-input-border bg-input text-input-foreground hover:bg-list-hover focus:border-border-focus focus:ring-border-focus relative w-full cursor-pointer rounded-md border py-2 pl-3 pr-10 text-left text-sm focus:outline-none focus:ring-1 disabled:cursor-not-allowed disabled:opacity-50">
          <div className="flex flex-col">
            <span className="text-foreground truncate font-medium">{selected.title}</span>
            {selected.description && (
              <span className="text-description-muted truncate text-[11px]">
                {selected.description}
              </span>
            )}
          </div>
          <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
            <ChevronUpDownIcon className="text-description h-4 w-4" />
          </span>
        </Listbox.Button>
        <Transition
          as={Fragment}
          leave="transition ease-in duration-100"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <Listbox.Options className="border-border bg-editor absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-md border py-1 text-sm shadow-lg focus:outline-none">
            {/* Search pinned to top */}
            <div className="border-border bg-editor sticky top-0 z-10 border-b px-2 py-1.5">
              <div className="relative">
                <MagnifyingGlassIcon className="text-description-muted absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search providers…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.stopPropagation()}
                  className="border-input-border bg-input text-input-foreground placeholder:text-input-placeholder focus:border-border-focus focus:ring-border-focus w-full rounded border py-1 pl-7 pr-2 text-xs focus:outline-none focus:ring-1"
                />
              </div>
            </div>

            {popular.length > 0 && (
              <div className="text-description-muted px-3 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wide">
                Popular
              </div>
            )}
            {popular.map((p) => (
              <ProviderOption key={p.slug} provider={p} />
            ))}

            {other.length > 0 && (
              <div className="text-description-muted px-3 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wide">
                Other
              </div>
            )}
            {other.map((p) => (
              <ProviderOption key={p.slug} provider={p} />
            ))}

            {popular.length === 0 && other.length === 0 && (
              <div className="text-description-muted px-3 py-4 text-center text-xs">
                No providers match "{query}"
              </div>
            )}
          </Listbox.Options>
        </Transition>
      </div>
    </Listbox>
  );
}

function ProviderOption({ provider }: { provider: CatalogueProvider }) {
  return (
    <Listbox.Option
      value={provider}
      className={({ active }) =>
        `relative cursor-pointer select-none py-2 pl-8 pr-4 ${
          active ? "bg-list-hover text-foreground" : "text-foreground"
        }`
      }
    >
      {({ selected: isSel }) => (
        <>
          <div className="font-medium">{provider.title}</div>
          {provider.description && (
            <div className="text-description-muted truncate text-[11px]">
              {provider.description}
            </div>
          )}
          {isSel && (
            <span className="text-success absolute inset-y-0 left-0 flex items-center pl-2">
              <CheckIcon className="h-4 w-4" />
            </span>
          )}
        </>
      )}
    </Listbox.Option>
  );
}

// ─── ModelPicker ──────────────────────────────────────────────────────────

interface ModelPickerProps {
  models: CatalogueModel[];
  selected: CatalogueModel;
  onSelect: (m: CatalogueModel) => void;
  /** Whether to show the "Auto-detect" pseudo-option as the first entry.
   *  Enabled in self-serve where the user wants a key-only config; admin
   *  assigns tend to pin a specific model. */
  includeAutoDetect?: boolean;
  disabled?: boolean;
}

const AUTODETECT_OPTION: CatalogueModel = {
  model: "AUTODETECT",
  displayName: "Auto-detect",
  description: "Use any model this key supports",
  roles: ["chat", "edit", "apply"],
};

export function ModelPicker({
  models,
  selected,
  onSelect,
  includeAutoDetect = false,
  disabled,
}: ModelPickerProps) {
  const list = includeAutoDetect ? [AUTODETECT_OPTION, ...models] : models;
  return (
    <Listbox value={selected} onChange={onSelect} disabled={disabled}>
      <div className="relative">
        <Listbox.Button className="border-input-border bg-input text-input-foreground hover:bg-list-hover focus:border-border-focus focus:ring-border-focus relative w-full cursor-pointer rounded-md border py-2 pl-3 pr-10 text-left text-sm focus:outline-none focus:ring-1 disabled:cursor-not-allowed disabled:opacity-50">
          <div className="flex flex-col">
            <span className="text-foreground truncate font-medium">{selected.displayName}</span>
            <span className="text-description-muted truncate font-mono text-[11px]">
              {selected.model}
            </span>
          </div>
          <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2">
            <ChevronUpDownIcon className="text-description h-4 w-4" />
          </span>
        </Listbox.Button>
        <Transition
          as={Fragment}
          leave="transition ease-in duration-100"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <Listbox.Options className="border-border bg-editor absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-md border py-1 text-sm shadow-lg focus:outline-none">
            {list.map((m) => (
              <Listbox.Option
                key={m.model}
                value={m}
                className={({ active }) =>
                  `relative cursor-pointer select-none py-2 pl-8 pr-4 ${
                    active ? "bg-list-hover text-foreground" : "text-foreground"
                  }`
                }
              >
                {({ selected: isSel }) => (
                  <>
                    <div className="font-medium">{m.displayName}</div>
                    <div className="text-description-muted font-mono text-[11px]">{m.model}</div>
                    {m.description && (
                      <div className="text-description-muted truncate text-[10px]">
                        {m.description}
                      </div>
                    )}
                    {isSel && (
                      <span className="text-success absolute inset-y-0 left-0 flex items-center pl-2">
                        <CheckIcon className="h-4 w-4" />
                      </span>
                    )}
                  </>
                )}
              </Listbox.Option>
            ))}
          </Listbox.Options>
        </Transition>
      </div>
    </Listbox>
  );
}
