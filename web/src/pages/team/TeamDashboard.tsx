import { useState } from "react";
import { UnderlineTabs } from "../../components/ui/UnderlineTabs";
import { OverviewTab } from "./tabs/OverviewTab";
import { MembersTab } from "./tabs/MembersTab";
import { UsageTab } from "./tabs/UsageTab";

const tabs = [
  { id: "overview", label: "Overview" },
  { id: "members", label: "Members" },
  { id: "usage", label: "Usage" },
];

export function TeamDashboard() {
  const [activeTab, setActiveTab] = useState("overview");

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-foreground text-2xl font-bold">Team</h1>
      <UnderlineTabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />

      {activeTab === "overview" && <OverviewTab />}
      {activeTab === "members" && <MembersTab />}
      {activeTab === "usage" && <UsageTab />}
    </div>
  );
}
