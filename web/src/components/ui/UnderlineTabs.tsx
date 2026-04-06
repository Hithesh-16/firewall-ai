import { cn } from "../../utils/cn";

interface Tab {
  id: string;
  label: string;
}

interface UnderlineTabsProps {
  tabs: Tab[];
  activeTab: string;
  onChange: (id: string) => void;
  className?: string;
}

export function UnderlineTabs({
  tabs,
  activeTab,
  onChange,
  className,
}: UnderlineTabsProps) {
  return (
    <div
      className={cn("border-border flex border-b", className)}
      role="tablist"
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTab;
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.id)}
            className={cn(
              "relative px-4 py-2 text-sm font-medium transition-colors",
              isActive
                ? "text-primary"
                : "text-description hover:text-foreground",
            )}
          >
            {tab.label}
            {isActive && (
              <span className="bg-primary absolute inset-x-0 bottom-0 h-0.5" />
            )}
          </button>
        );
      })}
    </div>
  );
}
