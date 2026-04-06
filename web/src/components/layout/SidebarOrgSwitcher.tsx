import { Fragment } from "react";
import { Listbox, Transition } from "@headlessui/react";
import {
  ChevronUpDownIcon,
  ShieldCheckIcon,
} from "@heroicons/react/24/outline";
import { cn } from "../../utils/cn";
import { useAppSelector, useAppDispatch } from "../../store/hooks";
import { setCurrentOrg } from "../../store/slices/orgSlice";

interface SidebarOrgSwitcherProps {
  collapsed: boolean;
}

export function SidebarOrgSwitcher({ collapsed }: SidebarOrgSwitcherProps) {
  const dispatch = useAppDispatch();
  const organizations = useAppSelector((s) => s.org.organizations);
  const currentOrgId = useAppSelector((s) => s.org.currentOrgId);

  const currentOrg = organizations.find((o) => o.id === currentOrgId);
  const displayName = currentOrg?.name ?? "AI Firewall";

  if (collapsed) {
    return (
      <div className="flex items-center justify-center px-2 py-3">
        <ShieldCheckIcon className="text-primary h-6 w-6" />
      </div>
    );
  }

  if (organizations.length <= 1) {
    return (
      <div className="flex items-center gap-2 px-4 py-3">
        <ShieldCheckIcon className="text-primary h-5 w-5" />
        <span className="text-foreground truncate text-sm font-semibold">
          {displayName}
        </span>
      </div>
    );
  }

  return (
    <Listbox
      value={currentOrgId ?? ""}
      onChange={(id: string) => dispatch(setCurrentOrg(id))}
    >
      <div className="relative px-2 py-2">
        <Listbox.Button className="hover:bg-list-hover flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left">
          <ShieldCheckIcon className="text-primary h-5 w-5 shrink-0" />
          <span className="text-foreground flex-1 truncate text-sm font-semibold">
            {displayName}
          </span>
          <ChevronUpDownIcon className="text-description-muted h-4 w-4" />
        </Listbox.Button>

        <Transition
          as={Fragment}
          leave="transition ease-in duration-100"
          leaveFrom="opacity-100"
          leaveTo="opacity-0"
        >
          <Listbox.Options className="border-border bg-editor absolute left-2 right-2 z-20 mt-1 max-h-48 overflow-auto rounded-md border py-1 shadow-lg">
            {organizations.map((org) => (
              <Listbox.Option
                key={org.id}
                value={org.id}
                className={({ active }) =>
                  cn(
                    "cursor-pointer px-3 py-1.5 text-sm",
                    active
                      ? "bg-list-hover text-foreground"
                      : "text-description",
                  )
                }
              >
                {org.name}
              </Listbox.Option>
            ))}
          </Listbox.Options>
        </Transition>
      </div>
    </Listbox>
  );
}
