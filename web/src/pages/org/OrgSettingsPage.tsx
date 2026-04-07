import { useState } from "react";
import { UnderlineTabs } from "../../components/ui/UnderlineTabs";
import { ProvidersTab } from "./tabs/ProvidersTab";
import { UsersTab } from "./tabs/UsersTab";
import { CreditsTab } from "./tabs/CreditsTab";
import { AuditTab } from "./tabs/AuditTab";

const tabs = [
  { id: "providers", label: "Providers" },
  { id: "users", label: "Users" },
  { id: "credits", label: "Credits" },
  { id: "audit", label: "Audit Log" },
];

export function OrgSettingsPage() {
  const [activeTab, setActiveTab] = useState("providers");

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-foreground text-2xl font-bold">Organization Settings</h1>
      <UnderlineTabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />

      {activeTab === "providers" && <ProvidersTab />}
      {activeTab === "users" && <UsersTab />}
      {activeTab === "credits" && <CreditsTab />}
      {activeTab === "audit" && <AuditTab />}
    </div>
  );
}
