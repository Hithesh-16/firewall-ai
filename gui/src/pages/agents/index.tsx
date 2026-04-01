import { useNavigate } from "react-router-dom";
import { UnderlineTabs } from "../../components/ui/UnderlineTabs";
import { useAppSelector } from "../../redux/hooks";
import { ROUTES } from "../../util/navigation";
import { ActiveAgentCard } from "./ActiveAgentCard";
import { ApprovalCard } from "./ApprovalCard";
import { useState } from "react";

const TABS = [
  { id: "active" as const, label: "Active Agents" },
  { id: "approvals" as const, label: "Pending Approvals" },
  { id: "history" as const, label: "History" },
];

type TabId = (typeof TABS)[number]["id"];

function AgentManagerPage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<TabId>("active");
  const activeAgents = useAppSelector((s) => s.agent.activeAgents);
  const pendingApprovals = useAppSelector((s) => s.agent.pendingApprovals);
  const approvalHistory = useAppSelector((s) => s.agent.approvalHistory);

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
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary-foreground">
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
            <line x1="8" y1="21" x2="16" y2="21" />
            <line x1="12" y1="17" x2="12" y2="21" />
          </svg>
        </div>
        <div>
          <h1 className="text-lg font-semibold text-foreground">
            Agent Manager
          </h1>
          <p className="text-xs text-description">
            Active agents, approvals, and task history
          </p>
        </div>
      </div>

      {/* Tabs */}
      <UnderlineTabs
        tabs={TABS}
        activeTab={activeTab}
        onTabClick={(id) => setActiveTab(id as TabId)}
      />

      {/* Active Agents */}
      {activeTab === "active" && (
        <div className="flex flex-col gap-3">
          {activeAgents.length === 0 ? (
            <p className="text-sm text-description text-center py-8">
              No active agents. Start a task to see agents here.
            </p>
          ) : (
            activeAgents.map((agent) => (
              <ActiveAgentCard key={agent.id} agent={agent} />
            ))
          )}
        </div>
      )}

      {/* Pending Approvals */}
      {activeTab === "approvals" && (
        <div className="flex flex-col gap-3">
          {pendingApprovals.length === 0 ? (
            <p className="text-sm text-description text-center py-8">
              No pending approvals.
            </p>
          ) : (
            pendingApprovals.map((approval) => (
              <ApprovalCard key={approval.requestId} approval={approval} />
            ))
          )}
        </div>
      )}

      {/* History */}
      {activeTab === "history" && (
        <div className="flex flex-col gap-2">
          {approvalHistory.length === 0 ? (
            <p className="text-sm text-description text-center py-8">
              No approval history yet.
            </p>
          ) : (
            approvalHistory.map((item) => (
              <div
                key={item.requestId}
                className="flex items-center gap-3 bg-secondary-background rounded-lg px-4 py-3"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground">{item.actionType}</p>
                  <p className="text-xs text-description font-mono truncate">
                    {item.resource}
                  </p>
                </div>
                <span className="text-xs text-description">
                  {new Date(item.createdAt).toLocaleTimeString()}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default AgentManagerPage;
