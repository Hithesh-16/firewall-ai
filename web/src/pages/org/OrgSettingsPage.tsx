import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { UnderlineTabs } from "../../components/ui/UnderlineTabs";
import { ProvidersTab } from "./tabs/ProvidersTab";
import { UsersTab } from "./tabs/UsersTab";
import { UserModelsTab } from "./tabs/UserModelsTab";
import { CreditsTab } from "./tabs/CreditsTab";
import { AuditTab } from "./tabs/AuditTab";
import { OrgCatalogueTab } from "./tabs/OrgCatalogueTab";

const tabs = [
  { id: "providers", label: "Providers" },
  { id: "users", label: "Users" },
  { id: "user-models", label: "Model Access" },
  { id: "rules", label: "Rules" },
  { id: "skills", label: "Skills" },
  { id: "credits", label: "Credits" },
  { id: "audit", label: "Audit Log" },
];

const VALID_TAB_IDS = new Set(tabs.map((t) => t.id));

export function OrgSettingsPage() {
  // Tab selection is URL-driven so `/org?tab=user-models` deep-links
  // directly into the Model Access tab — the sidebar's "Model Access"
  // entry uses that exact URL. Falls back to "providers" when the
  // query param is missing or points at an unknown tab.
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = useMemo(() => {
    const raw = searchParams.get("tab");
    return raw && VALID_TAB_IDS.has(raw) ? raw : "providers";
  }, [searchParams]);

  const handleTabChange = useCallback(
    (id: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (id === "providers") next.delete("tab");
          else next.set("tab", id);
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-foreground text-2xl font-bold">Organization Settings</h1>
      <UnderlineTabs tabs={tabs} activeTab={activeTab} onChange={handleTabChange} />

      {activeTab === "providers" && <ProvidersTab />}
      {activeTab === "users" && <UsersTab />}
      {activeTab === "user-models" && <UserModelsTab />}
      {activeTab === "rules" && <OrgCatalogueTab kind="rule" />}
      {activeTab === "skills" && <OrgCatalogueTab kind="skill" />}
      {activeTab === "credits" && <CreditsTab />}
      {activeTab === "audit" && <AuditTab />}
    </div>
  );
}
