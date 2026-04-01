interface Tab {
  id: string;
  label: string;
}

interface UnderlineTabsProps {
  tabs: Tab[];
  activeTab: string;
  onTabClick: (tabId: string) => void;
  className?: string;
}

/**
 * Horizontal underline-style tabs matching the VS Code native tab pattern.
 * Active tab gets a bottom accent border; inactive tabs are muted text.
 */
export function UnderlineTabs({
  tabs,
  activeTab,
  onTabClick,
  className = "",
}: UnderlineTabsProps) {
  return (
    <div
      className={`flex gap-0 border-b border-border ${className}`}
      role="tablist"
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          aria-selected={activeTab === tab.id}
          onClick={() => onTabClick(tab.id)}
          className={`px-3 py-2 text-sm font-medium transition-colors
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus
            ${
              activeTab === tab.id
                ? "text-foreground border-b-2 border-b-primary -mb-px"
                : "text-description hover:text-foreground"
            }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
