import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ROUTES } from "../../util/navigation";
import { AuditTab } from "./AuditTab";
import { CreditsTab } from "./CreditsTab";
import { ProvidersTab } from "./ProvidersTab";
import { UsersTab } from "./UsersTab";

const TABS = [
  { id: "providers" as const, label: "Providers" },
  { id: "users" as const, label: "Users & Roles" },
  { id: "credits" as const, label: "Credits" },
  { id: "audit" as const, label: "Audit Log" },
];

type TabId = (typeof TABS)[number]["id"];

function OrgSettingsPage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabId>("providers");

  return (
    <div className="flex flex-col h-full overflow-y-auto p-4 gap-4">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate(ROUTES.HOME)}
          className="text-description hover:text-foreground transition-colors focus-visible:ring-2 focus-visible:ring-border-focus focus-visible:outline-none"
          aria-label="Back to chat"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 12H5" /><path d="m12 19-7-7 7-7" />
          </svg>
        </button>
        <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
        </div>
        <div>
          <h1 className="text-lg font-semibold text-foreground">
            Organization Settings
          </h1>
          <p className="text-xs text-description">
            Manage providers, users, credits, and audit trail
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border pb-1">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-1.5 text-sm rounded-t transition-colors ${
              activeTab === tab.id
                ? "bg-primary-background text-primary-foreground"
                : "text-description hover:text-foreground hover:bg-secondary-background"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "providers" && <ProvidersTab />}
      {activeTab === "users" && <UsersTab />}
      {activeTab === "credits" && <CreditsTab />}
      {activeTab === "audit" && <AuditTab />}
    </div>
  );
}

export default OrgSettingsPage;
