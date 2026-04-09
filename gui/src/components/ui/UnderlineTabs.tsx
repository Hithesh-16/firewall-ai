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
 *
 * Uses <span> instead of <button> to avoid VS Code webview's default
 * button styling (white/grey backgrounds).
 */
export function UnderlineTabs({
  tabs,
  activeTab,
  onTabClick,
  className = "",
}: UnderlineTabsProps) {
  return (
    <div
      className={`border-border flex gap-0 border-b ${className}`}
      role="tablist"
    >
      {tabs.map((tab) => (
        <span
          key={tab.id}
          role="tab"
          tabIndex={0}
          aria-selected={activeTab === tab.id}
          onClick={() => onTabClick(tab.id)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onTabClick(tab.id);
            }
          }}
          className={`focus-visible:ring-border-focus cursor-pointer select-none px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 ${
            activeTab === tab.id
              ? "text-foreground border-b-primary -mb-px border-b-2 border-solid"
              : "text-description hover:text-foreground"
          }`}
        >
          {tab.label}
        </span>
      ))}
    </div>
  );
}
